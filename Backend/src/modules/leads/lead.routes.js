const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const { body } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const ctrl = require("./lead.controller");

const leadRules = [
  body("fullName").optional().trim().notEmpty(),
  body("name").optional().trim().notEmpty(),
  body().custom((value) => {
    if (String(value.fullName || value.name || "").trim()) return true;
    throw new Error("Full name is required");
  }),
  body("email").isEmail().normalizeEmail().withMessage("Valid email is required"),
  body("phone").trim().notEmpty().withMessage("Phone number is required"),
];

router.post("/public", leadRules, ctrl.createPublicLead);

// PHASE 4 — public quiz-shaped lead creation. Scoped limiter, separate from
// app.js's global budget, matching quiz.routes.js's publicQuizLimiter
// pattern exactly (windowMs/max). Not reused directly — publicQuizLimiter
// is a local const in quiz.routes.js, never exported, so it cannot be
// imported here; this is a new instance with the identical configuration.
const publicLeadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/leads — create a Lead from a public, pre-login quiz-style
// submission. Public endpoint, rate-limited, no authentication required.
// NEVER creates a Case or User — see lead.controller.js's createLeadFromQuiz.
router.post("/", publicLeadLimiter, ctrl.createLeadRules, ctrl.createLeadFromQuiz);

// POST /api/leads/from-intake — create a Lead from an authenticated client's
// intake questionnaire submission. Mounted before any /:leadId-shaped route
// below (there are none yet in this file, but kept first defensively) to
// avoid an Express path-matching conflict. NEVER creates a Case or User —
// see lead.controller.js's createLeadFromIntake. Sets User.leadId only.
router.post(
  "/from-intake",
  authenticate,
  authorizeRoles("client", "employer", "employee", "beneficiary"),
  ctrl.fromIntakeRules,
  ctrl.createLeadFromIntake
);

module.exports = router;
