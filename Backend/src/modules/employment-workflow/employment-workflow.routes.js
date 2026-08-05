const router = require("express").Router();
const { body } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const validate = require("../../middleware/validate");
const ctrl = require("./employment-workflow.controller");

// "client" is included alongside "employer" throughout: an employer-sponsored
// case is usually driven by a plain "client" account that selected "employer"
// during intake (see BAIS's resolveApplicableChecklistRoles), not a distinct
// "employer" account type — only a real invited employee (role "employee")
// is excluded, per the employer-centric rule that employees never initiate.
router.get("/me", authenticate, authorizeRoles("employer", "employee", "client"), ctrl.getMyWorkspace);
router.put("/company", authenticate, authorizeRoles("employer", "client"), authorizePermissions("companies:update"), ctrl.saveCompanyProfile);
router.post(
  "/cases",
  authenticate,
  authorizeRoles("employer", "client"),
  authorizePermissions("cases:create"),
  body("employeeEmail").optional().isEmail().normalizeEmail(),
  body("employee.email").optional().isEmail().normalizeEmail(),
  validate,
  ctrl.createEmployerCase
);
router.post(
  "/:id/invite-employee",
  authenticate,
  authorizeRoles("employer", "client", "admin", "super_admin", "team_lead", "case_manager"),
  body("email").optional().isEmail().normalizeEmail(),
  body("name").notEmpty().withMessage("Employee name is required"),
  body("phone").notEmpty().withMessage("Employee mobile number is required"),
  validate,
  ctrl.inviteEmployee
);
router.get("/:id/participants", authenticate, authorizeRoles("employer", "employee", "client", "admin", "super_admin", "team_lead", "case_manager"), ctrl.listParticipants);
router.post(
  "/:id/participants/employees",
  authenticate,
  authorizeRoles("employer", "client", "admin", "super_admin", "team_lead", "case_manager"),
  authorizePermissions("cases:update"),
  body("email").optional().isEmail().normalizeEmail(),
  body("employee.email").optional().isEmail().normalizeEmail(),
  validate,
  ctrl.addEmployeeParticipant
);
router.post("/:id/participants/:participantId/decline", authenticate, authorizeRoles("employer", "employee", "client"), ctrl.declineParticipant);
router.delete("/:id/participants/:participantId", authenticate, authorizeRoles("employer", "client", "admin", "super_admin", "team_lead", "case_manager"), authorizePermissions("cases:update"), ctrl.deleteParticipant);
router.post(
  "/:id/participants/:participantId/replace",
  authenticate,
  authorizeRoles("employer", "client", "admin", "super_admin", "team_lead", "case_manager"),
  authorizePermissions("cases:update"),
  body("email").isEmail().normalizeEmail(),
  validate,
  ctrl.replaceParticipant
);
router.post(
  "/:id/resend-employee-invite",
  authenticate,
  authorizeRoles("employer", "client", "admin", "super_admin", "team_lead", "case_manager"),
  ctrl.resendEmployeeInvite
);
router.put("/:id/job", authenticate, authorizeRoles("employer", "client"), authorizePermissions("cases:update"), ctrl.saveJobInfo);
router.put("/:id/employee-questionnaire", authenticate, authorizeRoles("employer", "employee", "client"), authorizePermissions("questionnaires:update"), ctrl.saveEmployeeQuestionnaire);
router.post("/:id/submit", authenticate, authorizeRoles("employer", "employee", "client"), ctrl.submitParticipantInfo);
router.post("/:id/requests", authenticate, authorizeRoles("super_admin", "admin", "team_lead", "case_manager"), authorizePermissions("cases:update"), ctrl.createInformationRequest);

module.exports = router;
