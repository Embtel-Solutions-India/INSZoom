const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const ctrl = require("./workflow.controller");

const adminRoles = ["super_admin", "admin"];
const designerRoles = ["super_admin", "admin", "team_lead", "case_manager"];
const staffRoles = ["super_admin", "admin", "team_lead", "case_manager"];

router.post("/templates/seed-defaults", authenticate, authorizeRoles(...adminRoles), authorizePermissions("workflows:create"), ctrl.seedDefaults);
router.get("/templates", authenticate, authorizeRoles(...staffRoles), authorizePermissions("workflows:read"), ctrl.getTemplates);
router.post("/templates", authenticate, authorizeRoles(...designerRoles), authorizePermissions("workflows:create"), ctrl.createTemplate);
router.post("/templates/import", authenticate, authorizeRoles(...designerRoles), authorizePermissions("workflows:create"), ctrl.importTemplate);
router.post("/templates/ai-suggest", authenticate, authorizeRoles(...designerRoles), authorizePermissions("workflows:create"), ctrl.suggestWorkflow);
router.get("/templates/:id", authenticate, authorizeRoles(...staffRoles), authorizePermissions("workflows:read"), ctrl.getTemplate);
router.put("/templates/:id", authenticate, authorizeRoles(...designerRoles), authorizePermissions("workflows:update"), ctrl.updateTemplate);
router.post("/templates/:id/publish", authenticate, authorizeRoles(...designerRoles), authorizePermissions("workflows:update"), ctrl.publishTemplate);
router.post("/templates/:id/version", authenticate, authorizeRoles(...designerRoles), authorizePermissions("workflows:create"), ctrl.createTemplateVersion);
router.post("/templates/:id/clone", authenticate, authorizeRoles(...designerRoles), authorizePermissions("workflows:create"), ctrl.cloneTemplate);
router.get("/templates/:id/export", authenticate, authorizeRoles(...designerRoles), authorizePermissions("workflows:read"), ctrl.exportTemplate);

router.post("/trigger", authenticate, authorizeRoles(...staffRoles), authorizePermissions("workflows:update"), ctrl.triggerWorkflow);
router.post("/sla/check", authenticate, authorizeRoles(...adminRoles), authorizePermissions("workflows:update"), ctrl.checkSlaBreaches);
router.post("/scheduled/process", authenticate, authorizeRoles(...adminRoles), authorizePermissions("workflows:update"), ctrl.processScheduledWorkflows);
router.post("/retries/process", authenticate, authorizeRoles(...adminRoles), authorizePermissions("workflows:update"), ctrl.retryFailedActions);
router.post("/cases/:caseId/start", authenticate, authorizeRoles(...staffRoles), authorizePermissions("workflows:create"), ctrl.startCaseWorkflow);
router.get("/analytics/summary", authenticate, authorizeRoles(...staffRoles), authorizePermissions("workflows:read"), ctrl.getAnalytics);

router.get("/", authenticate, authorizeRoles(...staffRoles), authorizePermissions("workflows:read"), ctrl.getWorkflows);
router.post("/", authenticate, authorizeRoles(...designerRoles), authorizePermissions("workflows:create"), ctrl.createWorkflow);
router.get("/:id", authenticate, authorizeRoles(...staffRoles), authorizePermissions("workflows:read"), ctrl.getWorkflow);
router.post("/:id/transition", authenticate, authorizeRoles(...staffRoles), authorizePermissions("workflows:update"), ctrl.transitionWorkflow);
router.post("/:id/approve", authenticate, authorizeRoles(...staffRoles), authorizePermissions("workflows:update"), ctrl.approveWorkflow);

module.exports = router;
