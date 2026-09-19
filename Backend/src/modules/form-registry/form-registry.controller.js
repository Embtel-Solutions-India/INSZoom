const Case = require("../../models/Case");
const CaseForm = require("../../models/CaseForm");
const VisaFormMapping = require("../../models/VisaFormMapping");
const caseService = require("../cases/case.service");
const visaFormMappingService = require("./visaFormMapping.service");
const OnDemandFormAcquisitionService = require("../uscis-form-import/services/OnDemandFormAcquisitionService");

function handleError(error, next) {
  if (error.status) return next(error);
  next(Object.assign(error, { status: 500 }));
}

async function loadAuthorizedCase(req) {
  const caseData = await Case.findById(req.params.id);
  if (!caseData) throw Object.assign(new Error("Case not found"), { status: 404 });
  if (!caseService.canAccessCase(req.user, caseData)) throw Object.assign(new Error("Not authorized to access forms for this case"), { status: 403 });
  return caseData;
}

// GET /api/cases/:id/form-mappings - full resolved registry state for a
// case (auto-create/conditional/later-stage/reference + which auto-create
// entries are actually renderable right now + diagnostics for the ones
// that aren't). Server-authoritative, read-only.
exports.getCaseFormMappings = async (req, res, next) => {
  try {
    const caseData = await loadAuthorizedCase(req);
    const resolved = await visaFormMappingService.resolveApplicableMappings(caseData);
    const provisioned = (caseData.uscisFormReferences || []).map((ref) => ref.label);
    res.json({
      success: true,
      data: {
        autoCreate: resolved.autoCreate,
        conditional: resolved.conditional,
        laterStage: resolved.laterStage,
        reference: resolved.reference,
        provisioned,
        diagnostics: visaFormMappingService.templateDiagnostics(resolved.autoCreate),
      },
    });
  } catch (error) {
    handleError(error, next);
  }
};

// GET /api/cases/:id/form-mappings/conditional - conditional-only view for
// the future "Additional Forms Available" UI.
exports.getConditionalFormMappings = async (req, res, next) => {
  try {
    const caseData = await loadAuthorizedCase(req);
    const { conditional } = await visaFormMappingService.resolveApplicableMappings(caseData);
    res.json({ success: true, data: conditional });
  } catch (error) {
    handleError(error, next);
  }
};

// POST /api/cases/:id/form-mappings/:mappingId/decision - the ONLY thing a
// client may send is {decision, reason}. Any client-supplied "which forms
// are required" field is explicitly rejected, never merely ignored.
exports.decideConditionalFormMapping = async (req, res, next) => {
  try {
    visaFormMappingService.assertNoClientProvidedForms(req.body);
    const caseData = await loadAuthorizedCase(req);
    const result = await visaFormMappingService.recordConditionalDecision(
      caseData,
      req.params.mappingId,
      req.body.decision,
      req.user,
      req.body.reason,
      req
    );
    res.json({ success: true, data: result });
  } catch (error) {
    handleError(error, next);
  }
};

// GET /api/form-registry/visa/:visaType - raw registry lookup, answers
// "what forms belong to X" (§23 of the spec). Not case-scoped, no
// authorization beyond authenticate (registry content is not sensitive).
exports.getMappingsForVisa = async (req, res, next) => {
  try {
    const mappings = await VisaFormMapping.find({ visaType: req.params.visaType, active: true }).sort({ displayOrder: 1, formNumber: 1 }).lean();
    res.json({ success: true, data: mappings });
  } catch (error) {
    handleError(error, next);
  }
};

// Derives the single status chip the Forms tab renders per row from a
// registry mapping entry + whatever CaseForm (if any) already exists for
// it. Never mutates anything — read-only projection over
// resolveApplicableMappings' own output.
//
// agency !== "USCIS" (DOS's DS-160/DS-156E, DOL's ETA-9035/ETA-790, ...)
// deliberately never resolves to ACQUIRE_FROM_USCIS - confirmed live
// against this DB's real K-1 registry mappings: DS-160 is a DOS online
// application with no downloadable PDF at all, so offering "Fetch from
// USCIS" for it would always fail (OnDemandFormAcquisitionService only
// ever fetches from *.uscis.gov, per Constraint #5). NOT_FETCHABLE_HERE
// tells the UI to explain that instead of offering a doomed button.
function deriveUiStatus({ bucket, templateStatus, decision, caseForm, agency }) {
  if (caseForm) {
    if (caseForm.status === "archived") return "CONDITIONAL_PENDING"; // condition no longer met, see reconcileConditionalForms
    // Biographic Activation tier (BiographicMappingService): the CaseForm's
    // template never reached full production "active" status - a distinct
    // chip so the workspace makes clear this form still needs a curated
    // mapping review before it's ready for filing, never conflated with a
    // fully-activated AUTOFILLED form.
    if (caseForm.formTemplateId?.mappingStatus === "biographic_active") return "BIOGRAPHIC_READY";
    return (caseForm.completion?.percent || 0) > 0 || caseForm.status !== "pending" ? "AUTOFILLED" : "PROVISIONED";
  }
  if (bucket === "conditional") {
    if (decision === "NOT_APPLICABLE") return "REFERENCE";
    // Approved (decision "ADD") but no CaseForm exists yet: recordConditionalDecision
    // only provisions a CaseForm when a fully-active template is already on
    // file (ensureAssignedForms' single-template path never routes a
    // status:"review"/mappingStatus:"biographic_active" template - see
    // OnDemandFormAcquisitionService.acquireForCase's own comment on why
    // that's a deliberate, separate path). A freshly-registered form like
    // I-131 will commonly be in exactly this state right after approval -
    // offer the same "Acquire from USCIS" action the autoCreate bucket
    // already uses (same endpoint, same agency gate) rather than leaving
    // the Case Manager with an "Approved" chip and no way to actually get
    // the form provisioned.
    if (decision === "ADD" && agency === "USCIS") return "ACQUIRE_FROM_USCIS";
    return "CONDITIONAL_PENDING";
  }
  if (bucket === "laterStage") return "LATER_STAGE";
  if (bucket === "reference") return "REFERENCE";
  // bucket === "autoCreate"
  if (templateStatus === "TEMPLATE_AVAILABLE") return "AVAILABLE_TO_PROVISION";
  if (templateStatus === "TEMPLATE_RULE_CONFLICT") return "RULE_CONFLICT";
  if (agency !== "USCIS") return "NOT_FETCHABLE_HERE"; // TEMPLATE_MISSING, but not a USCIS form
  return "ACQUIRE_FROM_USCIS"; // TEMPLATE_MISSING
}

function toOverviewEntry(bucket, entry, caseFormsByCode) {
  const mapping = entry.mapping;
  const formCode = String(mapping.formTemplateFormCode || mapping.formNumber || "").toUpperCase();
  const caseForm = caseFormsByCode.get(formCode) || null;
  return {
    mappingId: mapping._id,
    formNumber: mapping.formNumber,
    formName: mapping.formName,
    agency: mapping.agency,
    componentType: mapping.componentType,
    provisioningType: mapping.provisioningType,
    displayOrder: mapping.displayOrder || 0,
    // Best-effort convenience link built from USCIS's own URL convention
    // (see OnDemandFormAcquisitionService.guessedFormPageUrl) - not a
    // network call, so this can never be wrong in a way that blocks
    // anything; "Fetch from USCIS" does the real, verified resolution. Only
    // offered for USCIS-agency forms - a guessed uscis.gov link for a DOS/
    // DOL form (DS-160, ETA-9035, ...) would point at the wrong agency's
    // site entirely.
    officialPageUrl: mapping.agency === "USCIS" ? OnDemandFormAcquisitionService.guessedFormPageUrl(mapping.formNumber) : null,
    templateStatus: entry.templateStatus || null,
    decision: entry.decision || null,
    caseForm: caseForm
      ? {
          id: caseForm._id,
          status: caseForm.status,
          editionDate: caseForm.formEditionDate,
          completionPct: caseForm.completion?.percent || 0,
          mappingStatus: caseForm.formTemplateId?.mappingStatus || null,
        }
      : null,
    uiStatus: deriveUiStatus({ bucket, templateStatus: entry.templateStatus, decision: entry.decision, caseForm, agency: mapping.agency }),
  };
}

// GET /api/cases/:id/forms-overview - Phase 1: the full registry-resolved
// form set for this case's visa, provisioned or not, one row per applicable
// VisaFormMapping - not just the CaseForms that already happen to exist
// (that's listCaseForms' narrower job, still used as-is by the interactive
// workspace/renderCaseForm). Read-only; provisioning/acquisition are
// separate POST actions below and in uscis-form-import.
exports.getFormsOverview = async (req, res, next) => {
  try {
    const caseData = await loadAuthorizedCase(req);
    const resolved = await visaFormMappingService.resolveApplicableMappings(caseData);
    const existingForms = await CaseForm.find({ caseId: caseData._id })
      .select("formCode status formEditionDate completion formTemplateId")
      .populate({ path: "formTemplateId", select: "mappingStatus" })
      .lean();
    const caseFormsByCode = new Map(existingForms.map((form) => [String(form.formCode).toUpperCase(), form]));

    const items = [
      ...resolved.autoCreate.map((entry) => toOverviewEntry("autoCreate", entry, caseFormsByCode)),
      ...resolved.conditional.map((entry) => toOverviewEntry("conditional", entry, caseFormsByCode)),
      ...resolved.laterStage.map((entry) => toOverviewEntry("laterStage", entry, caseFormsByCode)),
      ...resolved.reference.map((entry) => toOverviewEntry("reference", entry, caseFormsByCode)),
    ].sort((left, right) => (left.displayOrder || 0) - (right.displayOrder || 0) || String(left.formNumber).localeCompare(String(right.formNumber)));

    res.json({
      success: true,
      data: {
        items,
        diagnostics: visaFormMappingService.templateDiagnostics(resolved.autoCreate),
        // Bulk "provision + curated-autofill everything available right
        // now" already exists as its own well-tested endpoint
        // (CaseLifecycleOrchestrator.generateForms, wired to the Forms
        // tab's existing "Generate USCIS Forms"/"Refresh Auto Fill"
        // button) - surfaced here so the frontend never has to hardcode
        // this path, rather than this endpoint duplicating that logic.
        bulkProvisionEndpoint: `/cases/${caseData._id}/workflow/generate-forms`,
      },
    });
  } catch (error) {
    handleError(error, next);
  }
};

// POST /api/cases/:id/forms/acquire {formNumber} - Phase 2: on-demand live
// fetch for a mapped form whose template is TEMPLATE_MISSING. Delegates
// entirely to OnDemandFormAcquisitionService; this controller only handles
// input validation + the case-authorization boundary all other case-scoped
// routes in this file already use.
exports.acquireCaseForm = async (req, res, next) => {
  try {
    const caseData = await loadAuthorizedCase(req);
    const formNumber = String(req.body?.formNumber || "").trim();
    if (!formNumber) {
      const error = new Error("formNumber is required");
      error.status = 400;
      throw error;
    }
    const result = await OnDemandFormAcquisitionService.acquireForCase(caseData._id, formNumber, req.user, req);
    res.json({ success: true, data: result });
  } catch (error) {
    handleError(error, next);
  }
};
