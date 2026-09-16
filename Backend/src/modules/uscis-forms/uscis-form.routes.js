const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const ctrl = require("./uscis-form.controller");
const accessService = require("./uscis-form-access.service");

router.get("/", authenticate, authorizePermissions("forms:read"), ctrl.list);
router.post("/", authenticate, authorizeRoles("super_admin"), authorizePermissions("forms:create"), ctrl.create);
router.get("/registry", authenticate, authorizePermissions("forms:read"), ctrl.listRegistry);
router.get("/registry/active", authenticate, authorizePermissions("forms:read"), ctrl.listActiveEditions);
router.get("/registry/archived", authenticate, authorizePermissions("forms:read"), ctrl.listArchivedEditions);
// Registry-wide health sweep (§30) — declared before /registry/:formCode so
// "health" is never captured as a formCode param.
router.get("/registry/health", authenticate, authorizePermissions("forms:read"), ctrl.getRegistryHealth);
// Canonical visa vocabulary for the mapping editor (§32/§33).
router.get("/registry/visa-registry", authenticate, authorizePermissions("forms:read"), ctrl.getVisaRegistry);
router.get("/registry/:formCode/versions", authenticate, authorizePermissions("forms:read"), ctrl.getVersions);
router.get("/sync/history", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("forms:check_updates"), ctrl.getSyncHistory);
router.post("/sync", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("forms:check_updates"), ctrl.syncForms);
router.post("/definitions/validate", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("forms:create"), ctrl.validateDefinition);
router.post("/definitions/import", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("forms:create"), ctrl.importDefinition);
router.post("/check-updates", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("forms:check_updates"), ctrl.checkUpdates);
router.get("/case", authenticate, authorizePermissions("forms:read"), ctrl.getAllCaseForms);
router.get("/case/:caseId", authenticate, authorizePermissions("forms:read"), ctrl.getCaseForms);
router.post("/case/:caseId", authenticate, authorizePermissions("forms:create"), ctrl.createCaseForm);
router.get("/case/:caseId/:formId/render", authenticate, authorizePermissions("forms:read"), ctrl.renderCaseForm);
router.post("/case/:caseId/:formId/autofill", authenticate, authorizePermissions("forms:update"), ctrl.autofillCaseForm);
router.get("/case/:caseId/:formId/validation", authenticate, authorizePermissions("forms:read"), ctrl.validateCaseForm);
router.get("/case/:caseId/:formId/comparison", authenticate, authorizePermissions("forms:read"), ctrl.compareCaseForm);
router.put("/case/:caseId/:formId/draft", authenticate, authorizePermissions("forms:update"), ctrl.saveDraft);
router.put("/case/:caseId/:formId/autosave", authenticate, authorizePermissions("forms:update"), ctrl.autoSave);
router.put("/case/:caseId/:formId/section", authenticate, authorizePermissions("forms:update"), ctrl.saveSection);
router.post("/case/:caseId/:formId/review", authenticate, authorizePermissions("forms:update"), ctrl.reviewCaseForm);
router.get("/case/:caseId/:formId/workspace", authenticate, authorizePermissions("forms:read"), ctrl.openInteractiveForm);
router.patch("/case/:caseId/:formId/workspace/field", authenticate, authorizePermissions("forms:update"), ctrl.saveInteractiveField);
router.put("/case/:caseId/:formId/workspace/section", authenticate, authorizePermissions("forms:update"), ctrl.saveInteractiveSection);
router.post("/case/:caseId/:formId/workspace/field/review", authenticate, authorizePermissions("forms:update"), ctrl.reviewInteractiveField);
router.post("/case/:caseId/:formId/workspace/section/review", authenticate, authorizePermissions("forms:update"), ctrl.reviewInteractiveSection);
router.post("/case/:caseId/:formId/workspace/decision", authenticate, authorizePermissions("forms:approve"), ctrl.decideInteractiveForm);
router.post("/case/:caseId/:formId/workspace/lock", authenticate, authorizePermissions("forms:approve"), ctrl.lockInteractiveForm);
router.post("/case/:caseId/:formId/workspace/refresh", authenticate, authorizePermissions("forms:update"), ctrl.refreshInteractiveForm);
router.post("/case/:caseId/:formId/workspace/reset", authenticate, authorizePermissions("forms:update"), ctrl.resetInteractiveForm);
router.post("/case/:caseId/:formId/workspace/conflict", authenticate, authorizePermissions("forms:update"), ctrl.resolveInteractiveConflict);
// Phase 3 (§I.4): resolves a Phase-2 per-field sync-state CONFLICT
// (sourceAttribution[fieldName].syncState) - deliberately a separate route
// from /workspace/conflict above, which resolves the older canonical-merge
// conflict type. Same auth chain as saveInteractiveField (PATCH .../field).
router.post("/case/:caseId/:formId/workspace/field/resolve-conflict", authenticate, authorizePermissions("forms:update"), ctrl.resolveInteractiveFieldConflict);
router.post("/case/:caseId/:formId/workspace/history/:historyId/rollback", authenticate, authorizePermissions("forms:update"), ctrl.rollbackInteractiveField);
router.get("/case/:caseId/:formId/workspace/validation", authenticate, authorizePermissions("forms:read"), ctrl.getInteractiveValidation);
router.get("/case/:caseId/:formId/workspace/comments", authenticate, authorizePermissions("forms:read"), ctrl.getInteractiveComments);
router.post("/case/:caseId/:formId/workspace/comments", authenticate, authorizePermissions("forms:update"), ctrl.addInteractiveComment);
router.patch("/case/:caseId/:formId/workspace/comments/:commentId/resolve", authenticate, authorizePermissions("forms:update"), ctrl.resolveInteractiveComment);
router.post("/case/:caseId/:formId/workspace/tasks", authenticate, authorizePermissions("tasks:create"), ctrl.createInteractiveTask);
router.get("/case/:caseId/:formId/workspace/history", authenticate, authorizePermissions("forms:read"), ctrl.getInteractiveHistory);
router.get("/case/:caseId/:formId/workspace/sources", authenticate, authorizePermissions("forms:read"), ctrl.getInteractiveSources);
router.get("/case/:caseId/:formId/workspace/comparison", authenticate, authorizePermissions("forms:read"), ctrl.getInteractiveComparison);
router.get("/case/:caseId/:formId/workspace/search", authenticate, authorizePermissions("forms:read"), ctrl.searchInteractiveFields);
// Two accepted credentials, never both optional: a normal authenticated
// session, OR a short-lived signed grant minted by GET /:id/url. The signed
// path exists because a PDF viewer/iframe cannot attach an Authorization
// header — without it the caller's bearer token would have to be put in a
// URL, which is strictly worse. An absent/!valid token falls through to the
// normal authenticate + forms:read chain, so this widens nothing.
function authenticateOrSignedGrant(req, res, next) {
  if (req.query.token) {
    try {
      accessService.verifyFormAccessToken(String(req.query.token), req.params.id);
      return next();
    } catch (error) {
      return next(error);
    }
  }
  return authenticate(req, res, (authError) => {
    if (authError) return next(authError);
    return authorizePermissions("forms:read")(req, res, next);
  });
}

router.get("/:id/pdf", authenticateOrSignedGrant, ctrl.getTemplatePdf);
// §40 GET /:id/url — mint a short-lived signed link to the official PDF.
router.get("/:id/url", authenticate, authorizePermissions("forms:read"), ctrl.getTemplatePdfUrl);
// §30 per-form health (?deep=true additionally verifies the stored SHA-256).
router.get("/:id/health", authenticate, authorizePermissions("forms:read"), ctrl.getTemplateHealth);
// §32 visa mapping management — read for any forms:read holder; mutations
// restricted to registry administrators, matching the activate/archive gate
// above (case managers/team leads hold forms:update for CASE forms, which is
// why the role allowlist, not the permission alone, is the binding check).
router.get("/:id/mappings", authenticate, authorizePermissions("forms:read"), ctrl.listFormMappings);
router.post("/:id/mappings", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("forms:update"), ctrl.createFormMapping);
router.patch("/:id/mappings/:mappingId", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("forms:update"), ctrl.updateFormMapping);
router.delete("/:id/mappings/:mappingId", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("forms:update"), ctrl.deleteFormMapping);
router.get("/:id", authenticate, authorizePermissions("forms:read"), ctrl.get);
router.put("/:id", authenticate, authorizeRoles("super_admin"), authorizePermissions("forms:update"), ctrl.update);
router.delete("/:id", authenticate, authorizeRoles("super_admin"), authorizePermissions("forms:delete"), ctrl.remove);
router.put("/:id/approve", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("forms:approve"), ctrl.approveTemplate);
router.put("/:id/activate", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("forms:approve"), ctrl.activateTemplate);
router.put("/:id/archive", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("forms:update"), ctrl.archiveTemplate);
router.put("/:id/rollback", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("forms:approve"), ctrl.rollbackTemplate);
// Any forms:read holder may request a mapping review (no state change);
// only an admin can act on it (existing Approve/Activate gate above).
router.post("/:id/mapping-review-request", authenticate, authorizePermissions("forms:read"), ctrl.requestMappingReview);

module.exports = router;
