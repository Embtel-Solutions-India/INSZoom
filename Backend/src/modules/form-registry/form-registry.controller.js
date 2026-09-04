const Case = require("../../models/Case");
const VisaFormMapping = require("../../models/VisaFormMapping");
const caseService = require("../cases/case.service");
const visaFormMappingService = require("./visaFormMapping.service");

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
