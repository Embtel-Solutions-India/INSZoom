const router = require("express").Router();
const { param } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const validate = require("../../middleware/validate");
const ctrl = require("./task.controller");

const taskRoles = ["super_admin", "admin", "team_lead", "case_manager"];
const validateTaskId = [param("id").isMongoId().withMessage("Valid task ID is required"), validate];

router.get("/stats/dashboard", authenticate, authorizePermissions("tasks:read"), ctrl.stats);
router.get("/calendar", authenticate, authorizeRoles(...taskRoles), authorizePermissions("tasks:read"), ctrl.calendar);
router.get("/my-tasks", authenticate, authorizePermissions("tasks:read"), ctrl.myTasks);
router.get("/team-tasks", authenticate, authorizeRoles("super_admin", "admin", "team_lead"), authorizePermissions("tasks:read"), ctrl.teamTasks);
router.put("/bulk-status", authenticate, authorizeRoles("super_admin", "admin", "team_lead"), authorizePermissions("tasks:update"), ctrl.bulkStatus);
router.get("/", authenticate, authorizeRoles(...taskRoles), authorizePermissions("tasks:read"), ctrl.list);
router.get("/:id", authenticate, authorizePermissions("tasks:read"), ...validateTaskId, ctrl.get);
// "attorney" added here too — resolveAssignment (task.controller.js)
// defaults assignedTo to self when omitted, and outright REJECTS (403,
// "Staff members may only create tasks assigned to themselves") any
// explicit assignedTo other than the caller for any role not in
// ["super_admin", "admin", "team_lead"] — so an attorney can only ever
// create a task assigned to themselves, never to someone else, regardless
// of what this route allows.
router.post("/", authenticate, authorizeRoles("super_admin", "admin", "team_lead", "case_manager", "attorney"), authorizePermissions("tasks:create"), ctrl.create);
// "attorney" added here (not to taskRoles generally — /calendar, /,
// /team-tasks, /bulk-status stay staff-only) so an attorney can update the
// status of a task actually assigned to them. canAccessTask's default-role
// branch (assignedTo === self) is the real scope; this only gets them past
// the route gate.
router.put("/:id", authenticate, authorizeRoles(...taskRoles, "attorney"), authorizePermissions("tasks:update"), ...validateTaskId, ctrl.update);
router.delete("/:id", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("tasks:delete"), ...validateTaskId, ctrl.remove);
router.post("/:id/comments", authenticate, authorizePermissions("tasks:update"), ...validateTaskId, ctrl.addComment);

module.exports = router;
