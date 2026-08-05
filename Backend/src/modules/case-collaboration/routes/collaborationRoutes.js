const router = require("express").Router();
const authenticate = require("../../../middleware/authenticate");
const authorizePermissions = require("../../../middleware/authorizePermissions");
const authorizeRoles = require("../../../middleware/authorizeRoles");
const controller = require("../controllers/CollaborationController");

router.get("/cases/:caseId/timeline", authenticate, authorizePermissions("cases:read"), controller.timeline);
router.post("/cases/:caseId/comments", authenticate, authorizePermissions("messages:create"), controller.addComment);
router.post("/cases/:caseId/tasks", authenticate, authorizeRoles("super_admin", "admin", "team_lead", "case_manager", "paralegal"), authorizePermissions("tasks:create"), controller.createTask);
router.post("/cases/:caseId/requests", authenticate, authorizeRoles("super_admin", "admin", "team_lead", "case_manager", "paralegal"), authorizePermissions("documents:create"), controller.createRequest);
router.get("/cases/:caseId/readiness", authenticate, authorizePermissions("cases:read"), controller.readiness);
router.post("/cases/:caseId/assignments", authenticate, authorizeRoles("super_admin", "admin", "team_lead", "case_manager"), authorizePermissions("cases:assign"), controller.assign);

module.exports = router;
