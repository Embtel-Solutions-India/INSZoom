const router = require("express").Router();
const authenticate = require("../../../middleware/authenticate");
const authorizePermissions = require("../../../middleware/authorizePermissions");
const authorizeRoles = require("../../../middleware/authorizeRoles");
const controller = require("../controllers/FormGenerationController");

router.use(authenticate);

router.post("/packages/generate", authorizeRoles("super_admin", "admin", "team_lead", "case_manager"), authorizePermissions("forms:update"), controller.generatePackage);
router.get("/:caseFormId/validation", authorizeRoles("super_admin", "admin", "team_lead", "case_manager"), authorizePermissions("forms:read"), controller.validate);
router.post("/:caseFormId/validate", authorizeRoles("super_admin", "admin", "team_lead", "case_manager"), authorizePermissions("forms:read"), controller.validate);
router.post("/:caseFormId/generate", authorizeRoles("super_admin", "admin", "team_lead", "case_manager"), authorizePermissions("forms:update"), controller.generate);
router.get("/:caseFormId/preview", authorizePermissions("forms:read"), controller.preview);
router.get("/:caseFormId/download", authorizePermissions("forms:read"), controller.download);
router.post("/:caseFormId/approve", authorizeRoles("super_admin", "admin", "team_lead"), authorizePermissions("forms:approve"), controller.approve);
router.post("/:caseFormId/regenerate", authorizeRoles("super_admin", "admin", "team_lead", "case_manager"), authorizePermissions("forms:update"), controller.regenerate);

module.exports = router;
