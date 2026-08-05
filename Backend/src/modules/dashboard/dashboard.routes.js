const router = require("express").Router();
const { body } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const validate = require("../../middleware/validate");
const ctrl = require("./dashboard.controller");

const dashboardRoles = ["super_admin", "admin", "team_lead", "case_manager", "client", "user"];
const analyticsRoles = ["super_admin", "admin", "team_lead", "case_manager", "client"];
const managerRoles = ["super_admin", "admin", "team_lead"];

router.get("/", authenticate, authorizeRoles(...dashboardRoles), authorizePermissions("dashboard:read"), ctrl.getDashboard);
router.get(
  "/:dashboardType(client|admin|executive)",
  authenticate,
  authorizeRoles(...dashboardRoles),
  authorizePermissions("dashboard:read"),
  ctrl.getNamedDashboard
);
router.get("/role/:role", authenticate, authorizeRoles("super_admin", "admin", "team_lead"), authorizePermissions("dashboard:read"), ctrl.getRoleDashboard);
router.get("/analytics", authenticate, authorizeRoles(...analyticsRoles), authorizePermissions("analytics:read"), ctrl.getAnalytics);
router.get("/analytics/cases", authenticate, authorizeRoles(...analyticsRoles), authorizePermissions("analytics:read"), ctrl.getCaseAnalytics);
router.get("/analytics/revenue", authenticate, authorizeRoles(...managerRoles), authorizePermissions("analytics:read"), ctrl.getRevenueAnalytics);
router.get("/analytics/users", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("analytics:read"), ctrl.getUserAnalytics);
router.get("/analytics/documents", authenticate, authorizeRoles(...analyticsRoles), authorizePermissions("analytics:read"), ctrl.getDocumentAnalytics);
router.get("/analytics/workflows", authenticate, authorizeRoles(...analyticsRoles), authorizePermissions("analytics:read"), ctrl.getWorkflowAnalytics);
router.get("/analytics/questionnaires", authenticate, authorizeRoles(...analyticsRoles), authorizePermissions("analytics:read"), ctrl.getQuestionnaireAnalytics);
router.get("/analytics/messages", authenticate, authorizeRoles(...analyticsRoles), authorizePermissions("analytics:read"), ctrl.getMessagingAnalytics);
router.get("/analytics/appointments", authenticate, authorizeRoles(...analyticsRoles), authorizePermissions("analytics:read"), ctrl.getAppointmentAnalytics);
router.get("/export", authenticate, authorizeRoles(...dashboardRoles), authorizePermissions("dashboard:export"), ctrl.exportDashboard);

router.get("/saved", authenticate, authorizeRoles(...dashboardRoles), authorizePermissions("dashboard:read"), ctrl.listSavedDashboards);
router.post(
  "/saved",
  authenticate,
  authorizeRoles(...dashboardRoles),
  authorizePermissions("dashboard:create"),
  body("name").notEmpty().withMessage("Dashboard name is required"),
  validate,
  ctrl.createDashboard
);
router.put("/saved/:id", authenticate, authorizeRoles(...dashboardRoles), authorizePermissions("dashboard:update"), ctrl.updateDashboard);

router.get("/scheduled-reports", authenticate, authorizeRoles(...managerRoles), authorizePermissions("analytics:schedule"), ctrl.listScheduledReports);
router.post(
  "/scheduled-reports",
  authenticate,
  authorizeRoles(...managerRoles),
  authorizePermissions("analytics:schedule"),
  body("name").notEmpty().withMessage("Report name is required"),
  validate,
  ctrl.createScheduledReport
);

module.exports = router;
