// Case Manager control over which USCIS forms a case has. Mounted at /api/case-forms (see routes/index.js).
//   GET  /catalog                               the catalogue of selectable USCIS forms (search by number / title / keyword / category)
//   GET  /resolve?name=                         what a typed form name resolves to (one form, or the candidates)
//   GET  /cases/:caseId/selection               the case's selections, removed forms, readiness, revision
//   PUT  /cases/:caseId/selection               add / remove forms atomically (expectedRevision required; typed names accepted)
//   GET  /cases/:caseId/selection/coverage      which of the case's checklists (and any checklistKeys being considered) feed a form
//   POST /cases/:caseId/selection/autofill      re-fill forms from the case's data
// Roles and case access are enforced again inside the service - the routes are not the only guard.

const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const catalog = require("./case-form-catalog.service");
const manager = require("./case-form-selection-manager.service");

const staff = authorizeRoles(...manager.MANAGE_ROLES);
const wrap = (handler) => async (req, res, next) => {
  try {
    const data = await handler(req);
    res.json({ success: true, data });
  } catch (error) {
    // 409s carry a machine-readable code and details (stale revision, confirmation required, ambiguous name ...) the page acts on
    if (error.status && error.code) return res.status(error.status).json({ success: false, message: error.message, code: error.code, details: error.details });
    next(error);
  }
};

router.get("/catalog", authenticate, staff, authorizePermissions("forms:read"), wrap((req) => catalog.listCatalog(req.query)));
router.get("/resolve", authenticate, staff, authorizePermissions("forms:read"), wrap((req) => catalog.resolveTypedForm(req.query.name)));
router.get("/cases/:caseId/selection", authenticate, staff, authorizePermissions("forms:read"), wrap((req) => manager.getSelection(req.params.caseId, { targetCaseId: req.query.targetCaseId }, req.user)));
router.get("/cases/:caseId/selection/coverage", authenticate, staff, authorizePermissions("forms:read"), wrap((req) => manager.getFormChecklistCoverage(req.params.caseId, { targetCaseId: req.query.targetCaseId, formCode: req.query.formCode, componentCode: req.query.componentCode, checklistKeys: req.query.checklistKeys }, req.user)));
router.put("/cases/:caseId/selection", authenticate, staff, authorizePermissions("forms:create"), wrap((req) => manager.updateSelection(req.params.caseId, req.body || {}, req.user, req)));
router.post("/cases/:caseId/selection/autofill", authenticate, staff, authorizePermissions("forms:create"), wrap((req) => manager.autofillSelected(req.params.caseId, req.body || {}, req.user, req)));

module.exports = router;
