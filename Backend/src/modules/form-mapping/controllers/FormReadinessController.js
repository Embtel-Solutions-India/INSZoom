const FormReadinessService = require("../services/FormReadinessService");
const CaseForm = require("../../../models/CaseForm");
const Case = require("../../../models/Case");
const caseService = require("../../cases/case.service");

function send(res, payload) {
  res.json({ success: true, ...payload });
}

// Same case-access gate MappingGraphController.autofillPreview already
// applies for a caseId-scoped read - a case_manager/team_lead only gated by
// authorizePermissions("forms:read") could otherwise read readiness
// diagnostics (including filledData-derived values) for a case they aren't
// assigned to.
async function assertCaseFormAccess(req, caseFormId) {
  const caseForm = await CaseForm.findById(caseFormId).select("caseId").lean();
  if (!caseForm) throw Object.assign(new Error("CaseForm not found"), { status: 404 });
  const caseData = await Case.findById(caseForm.caseId)
    .select("_id user assignedCaseManager assignedTeamLead companyId employerUser attorney assignedAttorney")
    .lean();
  if (!caseData) throw Object.assign(new Error("Case not found"), { status: 404 });
  if (!caseService.canAccessCase(req.user, caseData)) throw Object.assign(new Error("Not authorized to access this case"), { status: 403 });
}

// GET /form-mappings/case-forms/:caseFormId/readiness - read-only readiness
// diagnostics for one CaseForm (a specific case's specific form instance).
// Never mutates the CaseForm, the mapping graph, or anything else.
exports.readiness = async (req, res, next) => {
  try {
    await assertCaseFormAccess(req, req.params.caseFormId);
    const result = await FormReadinessService.computeReadiness(req.params.caseFormId);
    send(res, result);
  } catch (error) {
    next(error);
  }
};

// GET /form-mappings/case-forms/:caseFormId/readiness/fields/:targetFieldId/trace
// Read-only: why is this specific field missing/needing-review, traced back
// through canonical -> checklist question -> participant/role.
exports.traceMissingField = async (req, res, next) => {
  try {
    await assertCaseFormAccess(req, req.params.caseFormId);
    const result = await FormReadinessService.traceMissingField(req.params.caseFormId, req.params.targetFieldId);
    send(res, result);
  } catch (error) {
    next(error);
  }
};
