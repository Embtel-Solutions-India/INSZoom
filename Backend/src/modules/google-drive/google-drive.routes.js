const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const ctrl = require("./google-drive.controller");

// Mounted at /api/integrations/google-drive. Everything answers 404 while GOOGLE_DRIVE_INTEGRATION_ENABLED is not "true" (status excepted:
// the Admin UI uses it to decide whether to show the button at all).
const staffRoles = ["super_admin", "admin", "team_lead", "case_manager"];
const perUser = (max) => rateLimit({ windowMs: 60 * 1000, max, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => String(req.user?._id || "anon") });
const callbackLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

// Google's redirect: no Bearer token is possible here; authorized by the single-use state row (see connection.service.handleCallback).
router.get("/callback", callbackLimiter, ctrl.callback);

router.get("/status", authenticate, authorizeRoles(...staffRoles), ctrl.status);

router.use(ctrl.requireEnabled);
router.use(authenticate, authorizeRoles(...staffRoles));

// Each team member connects and disconnects THEIR OWN Google account (nothing here is shared between users).
router.post("/connect/start", authorizePermissions("documents:read"), ctrl.requireConfigured, perUser(10), ctrl.connectStart);
router.post("/disconnect", authorizePermissions("documents:read"), perUser(10), ctrl.disconnect);

// Using your own connection: each document is still checked against that person's access to the case.
router.post("/picker-token", authorizePermissions("documents:read"), ctrl.requireConfigured, perUser(30), ctrl.pickerToken);
router.post("/folders/validate", authorizePermissions("documents:read"), ctrl.requireConfigured, perUser(60), ctrl.validateFolder);
router.post("/folders", authorizePermissions("documents:read"), ctrl.requireConfigured, perUser(30), ctrl.createFolder);
router.get("/folders", authorizePermissions("documents:read"), ctrl.requireConfigured, perUser(60), ctrl.listFolders);
router.post("/links/lookup", authorizePermissions("documents:read"), perUser(60), ctrl.lookupLinks);
router.post("/sync", authorizePermissions("documents:read"), ctrl.requireConfigured, perUser(20), ctrl.startSync);
router.get("/jobs/:id", authorizePermissions("documents:read"), perUser(240), ctrl.getJob);
router.post("/jobs/:id/retry", authorizePermissions("documents:read"), ctrl.requireConfigured, perUser(20), ctrl.retryJob);

module.exports = router;
