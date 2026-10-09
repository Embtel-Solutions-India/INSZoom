const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const ctrl = require("./ghl.controller");

// The webhook is registered in app.js ahead of express.json (it needs the raw body).
const adminOnly = [authenticate, authorizeRoles("super_admin", "admin")];
// Staff who work the board. A case manager is further limited to their own cases
// inside the service via canAccessCase.
const boardStaff = [authenticate, authorizeRoles("super_admin", "admin", "team_lead", "case_manager")];

router.get("/status", boardStaff, ctrl.status);
router.get("/board", boardStaff, ctrl.board);
router.get("/setup", adminOnly, ctrl.setupPreview);
router.get("/visa-mapping", adminOnly, ctrl.visaMapping);
router.put("/visa-mapping", adminOnly, ctrl.saveVisaMapping);
router.post("/setup/confirm", adminOnly, ctrl.confirmMappings);
router.post("/sync", adminOnly, ctrl.syncNow);
router.post("/reconcile", adminOnly, ctrl.reconcileNow);

router.get("/cases/:caseId/stages", boardStaff, ctrl.caseStages);
router.patch("/cases/:caseId/pipeline-stage", boardStaff, ctrl.moveStage);
router.post("/jobs/:id/retry", adminOnly, ctrl.retryJob);

module.exports = router;
