const router = require("express").Router();
const { body, query } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const validate = require("../../middleware/validate");
const ctrl = require("./client.controller");

const staffRoles = ["super_admin", "admin", "team_lead", "case_manager"];
const readRoles = [...staffRoles, "client"];

const clientRules = [
  body("email").optional().isEmail().normalizeEmail().withMessage("Valid email required"),
  body("status").optional().isIn(["lead", "active", "inactive", "on_hold", "archived"]).withMessage("Invalid client status"),
];

router.get("/dashboard", authenticate, authorizeRoles(...readRoles), authorizePermissions("clients:read"), ctrl.getDashboard);
router.get("/me", authenticate, authorizeRoles(...readRoles), authorizePermissions("clients:read"), ctrl.getMyProfile);
router.put("/me", authenticate, authorizeRoles(...readRoles), authorizePermissions("clients:update"), ctrl.saveMyProfile);

router.get(
  "/",
  authenticate,
  authorizeRoles(...readRoles),
  authorizePermissions("clients:read"),
  query("status").optional().isIn(["lead", "active", "inactive", "on_hold", "archived"]),
  validate,
  ctrl.getClients
);
router.post("/", authenticate, authorizeRoles(...staffRoles), authorizePermissions("clients:create"), clientRules, validate, ctrl.createClient);
router.get("/:id", authenticate, authorizeRoles(...readRoles), authorizePermissions("clients:read"), ctrl.getClient);
router.put("/:id", authenticate, authorizeRoles(...readRoles), authorizePermissions("clients:update"), clientRules, validate, ctrl.updateClient);
router.put("/:id/status", authenticate, authorizeRoles(...staffRoles), authorizePermissions("clients:update"), ctrl.updateStatus);
router.delete("/:id", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("clients:delete"), ctrl.deleteClient);

router.post("/:id/notes", authenticate, authorizeRoles(...staffRoles), authorizePermissions("clients:update"), body("note").notEmpty(), validate, ctrl.addNote);
router.get("/:id/timeline", authenticate, authorizeRoles(...readRoles), authorizePermissions("clients:read"), ctrl.getTimeline);
router.get("/:id/related", authenticate, authorizeRoles(...readRoles), authorizePermissions("clients:read"), ctrl.getRelated);

module.exports = router;
