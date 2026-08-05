const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const ctrl = require("./report.controller");

const reportRoles = ["super_admin", "admin", "team_lead", "case_manager"];
const adminRoles = ["super_admin", "admin", "team_lead"];
const eodStaffRoles = ["team_lead", "case_manager", "admin", "super_admin"];

router.get("/cases", authenticate, authorizeRoles(...reportRoles), authorizePermissions("reports:read"), ctrl.cases);
router.get("/financial", authenticate, authorizeRoles("super_admin", "admin", "team_lead"), authorizePermissions("reports:read"), ctrl.financial);
router.get("/users", authenticate, authorizeRoles("super_admin", "admin", "team_lead"), authorizePermissions("reports:read"), ctrl.users);
router.get("/companies", authenticate, authorizeRoles(...reportRoles), authorizePermissions("reports:read"), ctrl.companies);
router.get("/ocr", authenticate, authorizeRoles(...reportRoles), authorizePermissions("reports:read"), ctrl.ocr);
router.get("/workflows", authenticate, authorizeRoles(...reportRoles), authorizePermissions("reports:read"), ctrl.workflows);
router.get("/audit", authenticate, authorizeRoles(...adminRoles), authorizePermissions("audit:read"), ctrl.audit);

router.get("/executions", authenticate, authorizeRoles(...adminRoles), authorizePermissions("reports:read"), ctrl.listExecutions);
router.post("/run", authenticate, authorizeRoles(...reportRoles), authorizePermissions("reports:create"), ctrl.run);
router.get("/export/:reportType", authenticate, authorizeRoles(...reportRoles), authorizePermissions("reports:export"), ctrl.exportReport);

router.get("/templates", authenticate, authorizeRoles(...reportRoles), authorizePermissions("reports:read"), ctrl.listTemplates);
router.post("/templates", authenticate, authorizeRoles(...adminRoles), authorizePermissions("reports:create"), ctrl.createTemplate);
router.put("/templates/:id", authenticate, authorizeRoles(...adminRoles), authorizePermissions("reports:update"), ctrl.updateTemplate);

router.get("/eod", authenticate, authorizeRoles("super_admin", "admin", ...eodStaffRoles), authorizePermissions("reports:read"), ctrl.listEod);
router.post("/eod", authenticate, authorizeRoles(...eodStaffRoles), authorizePermissions("reports:create"), ctrl.createEod);
router.put("/eod/:id", authenticate, authorizeRoles(...eodStaffRoles), authorizePermissions("reports:update"), ctrl.updateEod);
router.put("/eod/:id/review", authenticate, authorizeRoles(...adminRoles), authorizePermissions("reports:review"), ctrl.reviewEod);

module.exports = router;
