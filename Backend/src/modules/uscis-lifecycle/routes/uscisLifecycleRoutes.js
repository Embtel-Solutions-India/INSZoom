const router = require("express").Router();
const authenticate = require("../../../middleware/authenticate");
const authorizePermissions = require("../../../middleware/authorizePermissions");
const authorizeRoles = require("../../../middleware/authorizeRoles");
const controller = require("../controllers/USCISLifecycleController");

router.use(authenticate);

router.get("/forms", authorizePermissions("forms:read"), controller.listForms);
router.get("/forms/:formType/versions", authorizePermissions("forms:read"), controller.getVersions);
router.get("/forms/:formType/compare/:version", authorizePermissions("forms:read"), controller.compareVersion);
router.post("/forms/import", authorizeRoles("super_admin", "admin"), authorizePermissions("forms:create"), controller.importForm);
router.post("/forms/scan", authorizeRoles("super_admin", "admin"), authorizePermissions("forms:update"), controller.scan);
router.post("/forms/:version/approve", authorizeRoles("super_admin", "admin"), authorizePermissions("forms:update"), controller.approve);
router.post("/forms/:version/activate", authorizeRoles("super_admin", "admin"), authorizePermissions("forms:update"), controller.activate);
router.post("/forms/:version/retire", authorizeRoles("super_admin", "admin"), authorizePermissions("forms:update"), controller.retire);

module.exports = router;
