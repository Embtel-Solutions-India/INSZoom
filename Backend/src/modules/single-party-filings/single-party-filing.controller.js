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

    const caseNumber = await generateCaseNumber(req.body.legacySource === "INSZoom" ? "INS" : "BAIS");
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
      legacySource: req.body.legacySource || "BAIS",
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
