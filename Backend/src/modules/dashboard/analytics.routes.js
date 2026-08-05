const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const ctrl = require("./dashboard.controller");

const analyticsRoles = ["super_admin", "admin", "team_lead", "case_manager", "client"];
const managerRoles = ["super_admin", "admin", "team_lead"];

router.get("/", authenticate, authorizeRoles(...analyticsRoles), authorizePermissions("analytics:read"), ctrl.getAnalytics);
router.get("/dashboard", authenticate, authorizeRoles(...analyticsRoles), authorizePermissions("dashboard:read"), ctrl.getLegacyDashboardStats);
router.get("/processing-time", authenticate, authorizeRoles(...analyticsRoles), authorizePermissions("analytics:read"), ctrl.getProcessingTime);
router.get("/rfe-trends", authenticate, authorizeRoles(...analyticsRoles), authorizePermissions("analytics:read"), ctrl.getRfeTrends);
router.get("/revenue", authenticate, authorizeRoles(...managerRoles), authorizePermissions("analytics:read"), ctrl.getRevenueAnalytics);
router.get("/payments", authenticate, authorizeRoles(...managerRoles), authorizePermissions("analytics:read"), ctrl.getPaymentAnalytics);
router.get("/cases", authenticate, authorizeRoles(...analyticsRoles), authorizePermissions("analytics:read"), ctrl.getCaseAnalytics);
router.get("/documents", authenticate, authorizeRoles(...analyticsRoles), authorizePermissions("analytics:read"), ctrl.getDocumentAnalytics);
router.get("/workflows", authenticate, authorizeRoles(...analyticsRoles), authorizePermissions("analytics:read"), ctrl.getWorkflowAnalytics);
router.get("/questionnaires", authenticate, authorizeRoles(...analyticsRoles), authorizePermissions("analytics:read"), ctrl.getQuestionnaireAnalytics);
router.get("/messages", authenticate, authorizeRoles(...analyticsRoles), authorizePermissions("analytics:read"), ctrl.getMessagingAnalytics);
router.get("/appointments", authenticate, authorizeRoles(...analyticsRoles), authorizePermissions("analytics:read"), ctrl.getAppointmentAnalytics);

module.exports = router;
