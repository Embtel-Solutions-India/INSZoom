// Single-party individual filings — COS / Extension / EAD / Reinstatement
// (see Backend/src/config/filingTypes.js). Exactly ONE checklist role (the
// applicant themselves): no second party, no invite, no employer/family
// two-party machinery is read from or written to here. Mirrors
// family-workflow.controller.js's/employment-workflow.controller.js's own
// lightweight `Case.create(...)` + `addTimelineEvent` shape for case
// creation, but with no petitioner/beneficiary or employer/employee fields
// at all — this is the simplest of the three patterns by design.
const Case = require("../../models/Case");
const Questionnaire = require("../../models/Questionnaire");
const generateCaseNumber = require("../cases/caseId");
const caseService = require("../cases/case.service");
const questionnaireService = require("../questionnaires/questionnaire.service");
const uscisFormService = require("../uscis-forms/uscis-form.service");
const { getFilingType, resolveTransitionFilingType, groupedForSelection } = require("../../config/filingTypes");

exports.getFilingTypes = async (req, res, next) => {
  try {
    res.json({ success: true, ...groupedForSelection() });
  } catch (error) {
    next(error);
  }
};

// Selecting a filing type creates the case AND auto-assigns its single
// applicant checklist in one atomic request — no manual "send questionnaire"
// step. Accepts EITHER an explicit `filingTypeKey` (named/standalone
// options) or a `fromStatus`/`toStatus` pair (the transition picker),
// resolved server-side via the same registry the picker's own options come
// from, so the client and server can never disagree about the mapping.
exports.createFiling = async (req, res, next) => {
  try {
    const filingType = req.body.filingTypeKey
      ? getFilingType(req.body.filingTypeKey)
      : resolveTransitionFilingType(req.body.fromStatus, req.body.toStatus);
    if (!filingType) {
      return res.status(400).json({ success: false, message: "Unknown or unresolved filing type" });
    }

    // "INS" is the pre-existing case-number prefix scheme for staff-created
    // filings — kept as-is (a numbering-scheme change is a separate decision
    // from the INSZoom->Admin app rename); only the comparison value is
    // updated to match the renamed legacySource enum (models/*.js).
    const caseNumber = await generateCaseNumber(req.body.legacySource === "Admin" ? "INS" : "Immiglance");
    const caseData = await Case.create({
      caseNumber,
      caseId: caseNumber,
      visaType: filingType.visaType,
      visaCategory: filingType.category,
      caseType: "individual_filing",
      petitionType: filingType.label,
      petitionSubType: filingType.key,
      clientName: req.body.clientName || req.user.name || req.user.displayName,
      clientEmail: req.body.clientEmail || req.user.email,
      user: req.user._id,
      // Optional/nullable — see Case.js's principalCaseRef comment. Never
      // required; every filing type (including H-4 Extension/+EAD) works
      // fully without it.
      principalCaseRef: req.body.principalCaseRef || null,
      status: "pending_assignment",
      stage: "intake",
      createdBy: req.user._id,
      lastModifiedBy: req.user._id,
      legacySource: req.body.legacySource || "Immiglance",
    });
    caseService.addTimelineEvent(
      caseData,
      "case",
      "Filing Case Created",
      `${req.user.name || req.user.displayName || "Applicant"} started a ${filingType.label} filing.`,
      req.user,
      { filingTypeKey: filingType.key, category: filingType.category }
    );
    await caseData.save();

    // Auto-assign the single applicant checklist. ensureDefaultVisaTemplates
    // provisions the scaffold template on first use (idempotent, non-
    // destructive — same shared provisioning path every other visa/filing
    // checklist in this codebase uses).
    await questionnaireService.ensureDefaultVisaTemplates();
    const questionnaire = await Questionnaire.findOne({ key: filingType.questionnaireKey, latestVersion: true });
    let assignment = null;
    if (questionnaire) {
      assignment = await questionnaireService.assignQuestionnaire(
        questionnaire,
        {
          caseId: caseData._id,
          assignedTo: req.user._id,
          message: `Auto-assigned on filing creation (${filingType.label}).`,
        },
        req.user,
        req
      );
    }

    res.status(201).json({
      success: true,
      case: assignment?.case || caseData,
      filingType,
      questionnaire: questionnaire ? { key: questionnaire.key, title: questionnaire.title } : null,
      responseId: assignment?.responseId || null,
    });
  } catch (error) {
    next(error);
  }
};

// Selection-change path (task spec §17) — e.g. an H-4 Extension-only case
// later adds EAD, or vice versa. Never deletes/archives the client's
// existing completed checklist answers or uploaded documents: the OLD
// questionnaireReferences entry is marked `active: false` (so it stops
// counting toward checklist-completion UI) but is left in the array,
// exactly like every other "checklist superseded, not destroyed" path in
// this codebase (assignQuestionnaireIfNotActive's own dedup guard relies on
// this same `active` flag). Form provisioning reuses ensureAssignedForms's
// own idempotency — switching H4EXTENSION -> H4EXTENSIONEAD adds I-765
// without touching the already-provisioned I-539 CaseForm, and switching
// back away from EAD never deletes an already-provisioned I-765 (no
// existing lifecycle rule authorizes destructive removal — see §17/§8 of
// the task spec).
exports.changeFilingType = async (req, res, next) => {
  try {
    const caseData = await Case.findById(req.params.caseId);
    if (!caseData) {
      return res.status(404).json({ success: false, message: "Case not found" });
    }
    if (!caseService.canAccessCase(req.user, caseData)) {
      return res.status(403).json({ success: false, message: "Not authorized to modify this case" });
    }
    const filingType = getFilingType(req.body.filingTypeKey);
    if (!filingType) {
      return res.status(400).json({ success: false, message: "Unknown filing type" });
    }
    const previousFilingTypeKey = caseData.petitionSubType;
    if (previousFilingTypeKey === filingType.key) {
      return res.json({ success: true, case: caseData, filingType, unchanged: true });
    }

    caseData.visaType = filingType.visaType;
    caseData.visaCategory = filingType.category;
    caseData.petitionType = filingType.label;
    caseData.petitionSubType = filingType.key;
    const previousQuestionnaireKey = previousFilingTypeKey ? getFilingType(previousFilingTypeKey)?.questionnaireKey : null;
    if (previousQuestionnaireKey) {
      const previousQuestionnaire = await Questionnaire.findOne({ key: previousQuestionnaireKey, latestVersion: true });
      if (previousQuestionnaire) {
        (caseData.questionnaireReferences || []).forEach((reference) => {
          if (String(reference.questionnaireId) === String(previousQuestionnaire._id) && reference.active !== false) {
            reference.active = false;
          }
        });
      }
    }
    caseService.addTimelineEvent(
      caseData,
      "case",
      "Filing Type Changed",
      `${req.user.name || req.user.displayName || "Staff"} changed the filing type from ${previousFilingTypeKey || "none"} to ${filingType.label}.`,
      req.user,
      { previousFilingTypeKey, filingTypeKey: filingType.key }
    );
    await caseData.save();

    await questionnaireService.ensureDefaultVisaTemplates();
    const questionnaire = await Questionnaire.findOne({ key: filingType.questionnaireKey, latestVersion: true });
    let assignment = null;
    if (questionnaire) {
      assignment = await questionnaireService.assignQuestionnaireIfNotActive(
        questionnaire,
        { caseData, assignedTo: req.user._id, message: `Auto-assigned on filing type change (${filingType.label}).` },
        req.user,
        req
      );
    }
    const createdForms = await uscisFormService.ensureAssignedForms(assignment?.case || caseData, req.user, req);

    res.json({
      success: true,
      case: assignment?.case || caseData,
      filingType,
      questionnaire: questionnaire ? { key: questionnaire.key, title: questionnaire.title } : null,
      createdForms: createdForms.map((form) => form.formCode),
    });
  } catch (error) {
    next(error);
  }
};
