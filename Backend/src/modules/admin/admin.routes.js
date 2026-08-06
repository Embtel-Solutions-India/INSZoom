const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const ctrl = require("./admin.controller");

router.use(authenticate, authorizeRoles("admin", "super_admin"));

router.get("/overview", ctrl.getOverview);
router.get("/users", ctrl.getAllUsers);
router.get("/users/:userId", ctrl.getUserDetail);
router.put("/users/:userId/toggle-status", ctrl.toggleUserStatus);
router.get("/documents", ctrl.getDocumentOverview);
router.delete("/demo-data", authorizeRoles("super_admin"), ctrl.purgeDemoData);

module.exports = router;
