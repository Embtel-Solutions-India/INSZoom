const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const controller = require("./petition.controller");

// Mirrors form-generation's role-gate conventions exactly (see
// formGenerationRoutes.js): case_manager+ for generate/update-style actions,
// team_lead+ for approve-style actions (finalize/unlock), admin+ for
// definition edits, read-only routes permission-gated only. Reuses the
// existing forms:* permission resource — no permissions.registry.js change
// needed.
router.use(authenticate);

router.post("/cases/:caseId/assemble", authorizeRoles("super_admin", "admin", "team_lead", "case_manager"), authorizePermissions("forms:update"), controller.assemble);
router.get("/cases/:caseId/packages", authorizePermissions("forms:read"), controller.listPackages);

router.get("/packages/:id", authorizePermissions("forms:read"), controller.getPackage);
router.get("/packages/:id/validation", authorizePermissions("forms:read"), controller.getValidation);
router.get("/packages/:id/preview", authorizePermissions("forms:read"), controller.preview);
router.get("/packages/:id/download", authorizePermissions("forms:read"), controller.download);
router.patch("/packages/:id/letters/:sectionKey", authorizeRoles("super_admin", "admin", "team_lead", "case_manager"), authorizePermissions("forms:update"), controller.saveLetter);
router.patch("/packages/:id/exhibits/order", authorizeRoles("super_admin", "admin", "team_lead", "case_manager"), authorizePermissions("forms:update"), controller.reorderExhibits);
router.post("/packages/:id/finalize", authorizeRoles("super_admin", "admin", "team_lead"), authorizePermissions("forms:approve"), controller.finalize);
router.post("/packages/:id/unlock", authorizeRoles("super_admin", "admin", "team_lead"), authorizePermissions("forms:approve"), controller.unlock);
router.post("/packages/:id/filing", authorizeRoles("super_admin", "admin", "team_lead", "case_manager"), authorizePermissions("forms:update"), controller.recordFiling);
router.post("/packages/:id/receipt", authorizeRoles("super_admin", "admin", "team_lead", "case_manager"), authorizePermissions("forms:update"), controller.recordReceipt);

router.get("/definitions", authorizeRoles("super_admin", "admin"), authorizePermissions("forms:read"), controller.listDefinitions);
router.get("/definitions/:key", authorizeRoles("super_admin", "admin"), authorizePermissions("forms:read"), controller.getDefinition);
router.put("/definitions/:key", authorizeRoles("super_admin", "admin"), authorizePermissions("forms:update"), controller.upsertDefinition);

module.exports = router;
