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
router.post("/", authenticate, authorizeRoles("super_admin", "admin", "team_lead", "case_manager"), authorizePermissions("tasks:create"), ctrl.create);
router.put("/:id", authenticate, authorizeRoles(...taskRoles), authorizePermissions("tasks:update"), ...validateTaskId, ctrl.update);
router.delete("/:id", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("tasks:delete"), ...validateTaskId, ctrl.remove);
router.post("/:id/comments", authenticate, authorizePermissions("tasks:update"), ...validateTaskId, ctrl.addComment);

module.exports = router;
