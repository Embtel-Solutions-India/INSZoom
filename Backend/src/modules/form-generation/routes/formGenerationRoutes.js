const router = require("express").Router();
const authenticate = require("../../../middleware/authenticate");
const authorizePermissions = require("../../../middleware/authorizePermissions");
const authorizeRoles = require("../../../middleware/authorizeRoles");
const requireCaseFormAccess = require("../middleware/requireCaseFormAccess");
const controller = require("../controllers/FormGenerationController");
const upload = require("../../uploads/upload.middleware");

router.use(authenticate);

router.post("/packages/generate", authorizeRoles("super_admin", "admin", "team_lead", "case_manager"), authorizePermissions("forms:update"), controller.generatePackage);
router.get("/:caseFormId/validation", authorizeRoles("super_admin", "admin", "team_lead", "case_manager"), authorizePermissions("forms:read"), requireCaseFormAccess, controller.validate);
router.post("/:caseFormId/validate", authorizeRoles("super_admin", "admin", "team_lead", "case_manager"), authorizePermissions("forms:read"), requireCaseFormAccess, controller.validate);
router.post("/:caseFormId/generate", authorizeRoles("super_admin", "admin", "team_lead", "case_manager"), authorizePermissions("forms:update"), requireCaseFormAccess, controller.generate);
router.get("/:caseFormId/preview", authorizePermissions("forms:read"), requireCaseFormAccess, controller.preview);
router.get("/:caseFormId/download", authorizePermissions("forms:read"), requireCaseFormAccess, controller.download);
router.get("/:caseFormId/download-form", authorizePermissions("forms:read"), requireCaseFormAccess, controller.downloadForm);
// Save back a form that was edited outside the system (the downloaded, autofilled PDF opened in the user's own PDF viewer).
router.post("/:caseFormId/external-edit", authorizeRoles("super_admin", "admin", "team_lead", "case_manager"), authorizePermissions("forms:update"), requireCaseFormAccess, upload.single("file"), controller.uploadExternalEdit);
router.post("/:caseFormId/approve", authorizeRoles("super_admin", "admin", "team_lead"), authorizePermissions("forms:approve"), requireCaseFormAccess, controller.approve);
router.post("/:caseFormId/regenerate", authorizeRoles("super_admin", "admin", "team_lead", "case_manager"), authorizePermissions("forms:update"), requireCaseFormAccess, controller.regenerate);

module.exports = router;
