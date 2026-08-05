const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const ctrl = require("./audit.controller");

const auditRoles = ["super_admin", "admin", "team_lead"];

router.get("/summary", authenticate, authorizeRoles(...auditRoles), authorizePermissions("audit:read"), ctrl.summary);
router.get("/export", authenticate, authorizeRoles(...auditRoles), authorizePermissions("audit:export"), ctrl.exportCsv);
router.get("/user/:userId", authenticate, authorizeRoles(...auditRoles), authorizePermissions("audit:read"), ctrl.byUser);
router.get("/entity/:entityType/:entityId", authenticate, authorizeRoles(...auditRoles), authorizePermissions("audit:read"), ctrl.byEntity);
router.get("/:id", authenticate, authorizeRoles(...auditRoles), authorizePermissions("audit:read"), ctrl.getById);
router.get("/", authenticate, authorizeRoles(...auditRoles), authorizePermissions("audit:read"), ctrl.list);

module.exports = router;
