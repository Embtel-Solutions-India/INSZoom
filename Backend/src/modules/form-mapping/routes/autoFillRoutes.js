const router = require("express").Router();
const authenticate = require("../../../middleware/authenticate");
const authorizePermissions = require("../../../middleware/authorizePermissions");
const controller = require("../controllers/AutoFillController");

router.use(authenticate);

router.post("/:caseId/forms/:formType/autofill", authorizePermissions("forms:update"), controller.autofill);
router.get("/:caseId/forms/:formType/preview", authorizePermissions("forms:read"), controller.preview);
router.get("/:caseId/forms/:formType/validation", authorizePermissions("forms:read"), controller.validation);
router.post("/:caseId/forms/:formType/regenerate", authorizePermissions("forms:update"), controller.regenerate);
router.post("/:caseId/forms/:formType/refresh", authorizePermissions("forms:update"), controller.refresh);
router.post("/:caseId/forms/:formType/repopulate-fields", authorizePermissions("forms:update"), controller.repopulateFields);
router.post("/:caseId/forms/:formType/reset-auto-filled", authorizePermissions("forms:update"), controller.resetAutoFilledFields);
router.post("/:caseId/forms/:formType/rollback/:versionNumber", authorizePermissions("forms:update"), controller.rollback);
router.patch("/:caseId/forms/:formType/fields/:fieldId/override", authorizePermissions("forms:update"), controller.overrideField);
router.patch("/:caseId/forms/:formType/fields/:fieldId/review", authorizePermissions("forms:update"), controller.reviewField);

module.exports = router;
