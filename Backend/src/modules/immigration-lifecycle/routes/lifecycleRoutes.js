const router = require("express").Router();
const authenticate = require("../../../middleware/authenticate");
const authorizePermissions = require("../../../middleware/authorizePermissions");
const authorizeRoles = require("../../../middleware/authorizeRoles");
const controller = require("../controllers/LifecycleController");

const managerRoles = ["super_admin", "admin", "team_lead", "case_manager", "attorney", "paralegal"];
const reviewRoles = ["super_admin", "admin", "team_lead", "case_manager", "attorney"];

router.post("/cases/:caseId/file", authenticate, authorizeRoles(...reviewRoles), authorizePermissions("cases:update"), controller.file);
router.post("/cases/:caseId/receipt", authenticate, authorizeRoles(...managerRoles), authorizePermissions("cases:update"), controller.receipt);
router.post("/cases/:caseId/rfe", authenticate, authorizeRoles(...reviewRoles), authorizePermissions("cases:update"), controller.rfe);
router.post("/cases/:caseId/approval", authenticate, authorizeRoles(...reviewRoles), authorizePermissions("cases:update"), controller.approval);
router.post("/cases/:caseId/denial", authenticate, authorizeRoles(...reviewRoles), authorizePermissions("cases:update"), controller.denial);
router.post("/cases/:caseId/status", authenticate, authorizeRoles(...managerRoles), authorizePermissions("cases:update"), controller.status);
router.get("/cases/:caseId/timeline", authenticate, authorizePermissions("cases:read"), controller.timeline);
router.get("/cases/:caseId/status", authenticate, authorizePermissions("cases:read"), controller.status);
router.get("/cases/:caseId/deadlines", authenticate, authorizePermissions("cases:read"), controller.deadlines);
router.get("/cases/:caseId/tracking", authenticate, authorizePermissions("cases:read"), controller.tracking);
router.put("/cases/:caseId/tracking", authenticate, authorizeRoles(...managerRoles), authorizePermissions("cases:update"), controller.tracking);
router.get("/dashboard", authenticate, authorizePermissions("cases:read"), controller.dashboard);

module.exports = router;
