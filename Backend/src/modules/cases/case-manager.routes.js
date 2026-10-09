const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const authorizePermissions = require("../../middleware/authorizePermissions");
const authorizeRoles = require("../../middleware/authorizeRoles");
const ctrl = require("./case-manager.controller");

const staffRoles = ["super_admin", "admin", "team_lead", "case_manager"];

router.get("/", authenticate, authorizeRoles(...staffRoles), authorizePermissions("users:read"), ctrl.getCaseManagers);
router.get("/analytics-panel", authenticate, authorizeRoles(...staffRoles), authorizePermissions("cases:read"), ctrl.getCaseManagerAnalyticsPanel);
// Weekly star ratings. A case manager reads their own at /me/ratings; admins, team leads and super admins rate. The service enforces who may
// rate / see what (a team lead only their own team), so no extra permission string is needed here.
router.get("/me/ratings", authenticate, authorizeRoles(...staffRoles), ctrl.getCaseManagerRatings);
router.get("/:id/ratings", authenticate, authorizeRoles(...staffRoles), ctrl.getCaseManagerRatings);
router.put("/:id/ratings", authenticate, authorizeRoles("super_admin", "admin", "team_lead"), ctrl.rateCaseManager);
router.get("/:id", authenticate, authorizeRoles(...staffRoles), authorizePermissions("users:read"), ctrl.getCaseManagerDetails);
router.get("/:id/cases", authenticate, authorizeRoles(...staffRoles), authorizePermissions("cases:read"), ctrl.getCaseManagerCases);
router.get("/:id/activities", authenticate, authorizeRoles(...staffRoles), authorizePermissions("cases:read"), ctrl.getCaseManagerActivities);
router.get("/:id/payments", authenticate, authorizeRoles(...staffRoles), authorizePermissions("cases:read"), ctrl.getCaseManagerPayments);
router.get("/:id/analytics", authenticate, authorizeRoles(...staffRoles), authorizePermissions("cases:read"), ctrl.getCaseManagerAnalytics);

module.exports = router;
