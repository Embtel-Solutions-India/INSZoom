const router = require("express").Router();
const { body } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const validate = require("../../middleware/validate");
const ctrl = require("./family-workflow.controller");

// Mirrors employment-workflow.routes.js's shape exactly, under separate
// petitioner/beneficiary roles — "client" is the common petitioner account
// (applicantType stays "individual"); "beneficiary" is the invited second
// party, who can never initiate (createFamilyCase blocks it internally via
// isFamilyCapable, mirroring the employee-can-never-initiate rule).
router.get("/me", authenticate, authorizeRoles("client", "beneficiary"), ctrl.getMyWorkspace);
router.post(
  "/cases",
  authenticate,
  authorizeRoles("client"),
  body("beneficiaryEmail").optional().isEmail().normalizeEmail(),
  body("beneficiary.email").optional().isEmail().normalizeEmail(),
  validate,
  ctrl.createFamilyCase
);
router.post(
  "/:id/invite-beneficiary",
  authenticate,
  authorizeRoles("client", "admin", "super_admin", "team_lead", "case_manager"),
  body("email").optional().isEmail().normalizeEmail(),
  body("name").notEmpty().withMessage("Beneficiary name is required"),
  body("phone").notEmpty().withMessage("Beneficiary mobile number is required"),
  validate,
  ctrl.inviteBeneficiary
);
router.post("/:id/submit", authenticate, authorizeRoles("client", "beneficiary"), ctrl.submitParticipantInfo);

module.exports = router;
