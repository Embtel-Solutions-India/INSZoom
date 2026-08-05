const router = require("express").Router();
const { body, query } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const authorizePermissions = require("../../middleware/authorizePermissions");
const authorizeRoles = require("../../middleware/authorizeRoles");
const validate = require("../../middleware/validate");
const ctrl = require("./beneficiary.controller");

const staffRoles = ["super_admin", "admin", "team_lead", "case_manager"];
const writeRoles = ["super_admin", "admin", "case_manager"];
const readRoles = [...staffRoles, "client"];

const beneficiaryRules = [
  body("email").optional().isEmail().normalizeEmail().withMessage("Valid email required"),
  body("status").optional().isIn(["lead", "active", "inactive", "on_hold", "archived"]).withMessage("Invalid beneficiary status"),
  body("type").optional().isIn(["principal", "dependent", "employee", "family", "other"]).withMessage("Invalid beneficiary type"),
];

router.get("/dashboard", authenticate, authorizeRoles(...readRoles), authorizePermissions("beneficiaries:read"), ctrl.getDashboard);
router.get("/me", authenticate, authorizeRoles(...readRoles), authorizePermissions("beneficiaries:read"), ctrl.getMyBeneficiary);
router.put("/me", authenticate, authorizeRoles(...readRoles), authorizePermissions("beneficiaries:update"), beneficiaryRules, validate, ctrl.saveMyBeneficiary);

router.get(
  "/",
  authenticate,
  authorizeRoles(...readRoles),
  authorizePermissions("beneficiaries:read"),
  query("status").optional().isIn(["lead", "active", "inactive", "on_hold", "archived"]),
  query("type").optional().isIn(["principal", "dependent", "employee", "family", "other"]),
  validate,
  ctrl.getBeneficiaries
);
router.post("/", authenticate, authorizeRoles(...writeRoles), authorizePermissions("beneficiaries:create"), beneficiaryRules, validate, ctrl.createBeneficiary);
router.get("/:id", authenticate, authorizeRoles(...readRoles), authorizePermissions("beneficiaries:read"), ctrl.getBeneficiary);
router.put("/:id", authenticate, authorizeRoles(...readRoles), authorizePermissions("beneficiaries:update"), beneficiaryRules, validate, ctrl.updateBeneficiary);
router.put("/:id/status", authenticate, authorizeRoles(...writeRoles), authorizePermissions("beneficiaries:update"), ctrl.updateStatus);
router.delete("/:id", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("beneficiaries:delete"), ctrl.deleteBeneficiary);

router.post("/:id/notes", authenticate, authorizeRoles(...staffRoles), authorizePermissions("beneficiaries:update"), body("note").notEmpty(), validate, ctrl.addNote);
router.get("/:id/timeline", authenticate, authorizeRoles(...readRoles), authorizePermissions("beneficiaries:read"), ctrl.getTimeline);
router.get("/:id/related", authenticate, authorizeRoles(...readRoles), authorizePermissions("beneficiaries:read"), ctrl.getRelated);

module.exports = router;
