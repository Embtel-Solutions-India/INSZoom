const router = require("express").Router();
const { body } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const ctrl = require("./appointment.controller");

const appointmentRoles = ["super_admin", "admin", "case_manager", "team_lead", "client", "user"];
const managerRoles = ["super_admin", "admin", "case_manager", "team_lead"];

const publicRules = [
  body("name").trim().notEmpty().withMessage("Name is required"),
  body("email").isEmail().normalizeEmail().withMessage("Valid email required"),
  body("phone").notEmpty().withMessage("Phone is required"),
];

const createRules = [
  body("email").optional().isEmail().normalizeEmail().withMessage("Valid email required"),
  body("startAt").optional().isISO8601().withMessage("startAt must be a valid date"),
  body("endAt").optional().isISO8601().withMessage("endAt must be a valid date"),
];

router.post("/public", publicRules, ctrl.createPublicAppointment);
router.post("/", publicRules, ctrl.createPublicAppointment);

router.get("/my", authenticate, authorizePermissions("appointments:read"), ctrl.getMyAppointments);
router.get("/calendar", authenticate, authorizeRoles(...appointmentRoles), authorizePermissions("appointments:read"), ctrl.getCalendar);
router.get("/availability", authenticate, authorizeRoles(...appointmentRoles), authorizePermissions("appointments:read"), ctrl.getAvailability);
router.get("/dashboard", authenticate, authorizeRoles(...appointmentRoles), authorizePermissions("appointments:read"), ctrl.getDashboard);
router.post("/reminders/send-due", authenticate, authorizeRoles("super_admin", "admin"), ctrl.sendDueReminders);
router.post("/sync/:provider", authenticate, authorizeRoles(...managerRoles), authorizePermissions("calendar:sync"), ctrl.syncCalendar);
router.post("/schedule", authenticate, authorizeRoles(...appointmentRoles), authorizePermissions("appointments:create"), createRules, ctrl.createAppointment);
router.get("/", authenticate, authorizeRoles(...appointmentRoles), authorizePermissions("appointments:read"), ctrl.getAppointments);
router.get("/:id", authenticate, authorizeRoles(...appointmentRoles), authorizePermissions("appointments:read"), ctrl.getAppointment);
router.put("/:id", authenticate, authorizeRoles(...managerRoles), authorizePermissions("appointments:update"), createRules, ctrl.updateAppointment);
router.put("/:id/reschedule", authenticate, authorizeRoles(...appointmentRoles), authorizePermissions("appointments:update"), createRules, ctrl.rescheduleAppointment);
router.put("/:id/status", authenticate, authorizeRoles(...managerRoles), authorizePermissions("appointments:update"), [
  body("status").isIn(["pending", "scheduled", "confirmed", "contacted", "completed", "cancelled", "no_show", "rescheduled"]),
], ctrl.updateAppointmentStatus);
router.put("/:id/cancel", authenticate, authorizeRoles(...appointmentRoles), authorizePermissions("appointments:update"), ctrl.cancelAppointment);
router.delete("/:id", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("appointments:delete"), ctrl.cancelAppointment);

module.exports = router;
