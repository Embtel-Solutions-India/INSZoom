const router = require("express").Router();
const { body, query } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const validate = require("../../middleware/validate");
const User = require("../../models/User");
const ctrl = require("./user.controller");

const adminRoles = ["super_admin", "admin"];
const staffRoles = ["super_admin", "admin", "team_lead", "case_manager"];

const roleRule = body("role").isIn(User.roles).withMessage("Valid role required");
const createRules = [
  body("email").isEmail().normalizeEmail().withMessage("Valid email required"),
  body("password").isLength({ min: 8 }).withMessage("Password must be at least 8 characters"),
  roleRule,
  body("name").optional().trim().isLength({ min: 2 }).withMessage("Name too short"),
  body("displayName").optional().trim().isLength({ min: 2 }).withMessage("Display name too short"),
  body("permissions").optional().isArray().withMessage("Permissions must be an array"),
];
const updateRules = [
  body("email").optional().isEmail().normalizeEmail().withMessage("Valid email required"),
  body("password").optional().isLength({ min: 8 }).withMessage("Password must be at least 8 characters"),
  body("role").optional().isIn(User.roles).withMessage("Valid role required"),
  body("name").optional().trim().isLength({ min: 2 }).withMessage("Name too short"),
  body("displayName").optional().trim().isLength({ min: 2 }).withMessage("Display name too short"),
  body("permissions").optional().isArray().withMessage("Permissions must be an array"),
];

router.get(
  "/",
  authenticate,
  authorizeRoles(...adminRoles),
  authorizePermissions("users:read"),
  query("isActive").optional().isBoolean(),
  validate,
  ctrl.getUsers
);
router.get("/dashboard", authenticate, authorizeRoles(...adminRoles), authorizePermissions("users:read"), ctrl.getDashboard);
router.get("/assignable", authenticate, authorizeRoles(...staffRoles), authorizePermissions("users:read"), ctrl.getAssignableUsers);
router.get("/case-managers", authenticate, authorizeRoles(...staffRoles), authorizePermissions("users:read"), ctrl.getCaseManagers);
// Online/last-seen status — not role-gated beyond being logged in, since
// both staff and clients need to read each other's presence in a shared
// conversation, and it exposes nothing more sensitive than a boolean + a
// timestamp for user ids the caller already knows about.
router.get("/presence", authenticate, ctrl.getPresence);
router.get("/:id/activity", authenticate, authorizeRoles(...staffRoles), authorizePermissions("users:read"), ctrl.getUserActivity);
router.get("/:id/performance", authenticate, authorizeRoles(...staffRoles), authorizePermissions("users:read"), ctrl.getUserPerformance);
router.get("/:id", authenticate, authorizePermissions("users:read"), ctrl.getUser);
router.post("/", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("users:create"), createRules, validate, ctrl.createUser);
router.put("/:id", authenticate, authorizeRoles(...adminRoles), authorizePermissions("users:update"), updateRules, validate, ctrl.updateUser);
router.put("/:id/status", authenticate, authorizeRoles(...adminRoles), authorizePermissions("users:update"), ctrl.updateStatus);
router.delete("/:id", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("users:delete"), ctrl.deleteUser);

module.exports = router;
