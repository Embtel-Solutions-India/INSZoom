const CaseForm = require("../../../models/CaseForm");
const Case = require("../../../models/Case");
const caseService = require("../../cases/case.service");
const { isDatabaseUnavailableError } = require("../../../middleware/errorHandler");

// Every route in formGenerationRoutes.js is keyed by :caseFormId, not
// :caseId - unlike uscis-form.service.js (which calls getAccessibleCase()
// on every case-touching function), nothing here ever checked that the
// requesting user is actually assigned to the case a caseFormId belongs to.
// authorizePermissions() is a ROLE check only (does this user's role have
// "forms:read"/"update"/"approve" at all), not a per-case grant - so any
// case_manager/team_lead/admin could preview, download, generate, or
// approve the official USCIS PDF (SSNs, alien numbers, passport numbers,
// employer financials) for ANY case in the system, not just one they're
// assigned to, simply by knowing or enumerating a caseFormId. This closes
// that gap the same way uscis-form.service.js already does it correctly.
async function requireCaseFormAccess(req, res, next) {
  try {
    let caseForm;
    try {
      caseForm = await CaseForm.findById(req.params.caseFormId).select("caseId").maxTimeMS(Number(process.env.CASE_FORM_ACCESS_READ_TIMEOUT_MS || 5000));
    } catch (error) {
      if (!isDatabaseUnavailableError(error)) throw error;
      caseForm = await CaseForm.findById(req.params.caseFormId).select("caseId").read("secondaryPreferred");
    }
    if (!caseForm) return res.status(404).json({ success: false, message: "Case form not found" });
    let caseData;
    try {
      caseData = await Case.findById(caseForm.caseId).maxTimeMS(Number(process.env.CASE_FORM_ACCESS_READ_TIMEOUT_MS || 5000));
    } catch (error) {
      if (!isDatabaseUnavailableError(error)) throw error;
      caseData = await Case.findById(caseForm.caseId).read("secondaryPreferred");
    }
    if (!caseData || !caseService.canAccessCase(req.user, caseData)) {
      return res.status(403).json({ success: false, message: "Not authorized to access this case form" });
    }
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = requireCaseFormAccess;
