const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const ctrl = require("./settings.controller");

router.get("/", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("settings:read"), ctrl.getSettings);
router.put("/", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("settings:update"), ctrl.updateSettings);

module.exports = router;
