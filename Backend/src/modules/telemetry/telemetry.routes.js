const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const ctrl = require("./telemetry.controller");

// Scoped limiter for the public ingest endpoint, separate from app.js's
// global 300/15min budget — a noisy public funnel shouldn't be able to spend
// down every other route's shared allowance.
const trackLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/track", trackLimiter, ctrl.trackEvent);
router.get(
  "/summary",
  authenticate,
  authorizeRoles("super_admin", "admin", "case_manager"),
  authorizePermissions("telemetry:read"),
  ctrl.summary
);

module.exports = router;
