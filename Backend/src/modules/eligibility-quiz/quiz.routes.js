const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const { body } = require("express-validator");
const validate = require("../../middleware/validate");
const authenticate = require("../../middleware/authenticate");
const optionalAuthenticate = require("../../middleware/optionalAuthenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const ctrl = require("./quiz.controller");

// Scoped limiter for the public quiz surface, separate from app.js's global
// budget — matches Phase 0's telemetry.routes.js pattern.
const publicQuizLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

const submitRules = [
  body("visaPathway").trim().notEmpty().withMessage("visaPathway is required"),
  body("email").isEmail().normalizeEmail().withMessage("Valid email is required"),
  body("fullName").trim().notEmpty().withMessage("fullName is required"),
  body("criteriaAnswers").isArray().withMessage("criteriaAnswers must be an array"),
  body("criteriaAnswers.*.key").trim().notEmpty(),
  body("criteriaAnswers.*.value").optional({ nullable: true }).isInt({ min: 0, max: 3 }).withMessage("criteria answer values must be integers 0-3"),
];

router.get("/definition", publicQuizLimiter, ctrl.getDefinition);
router.get("/visas", publicQuizLimiter, ctrl.getVisas);
// optionalAuthenticate: still fully public (anonymous submits work exactly
// as before) — only populates req.user when a valid token is present, so
// quiz.service.js's submit() can reject a duplicate submission from a
// logged-in user who already has a case (see CASE_EXISTS below).
router.post("/submit", publicQuizLimiter, optionalAuthenticate, submitRules, validate, ctrl.submit);

const staffRoles = ["super_admin", "admin"];

router.get("/leads", authenticate, authorizeRoles(...staffRoles), authorizePermissions("leads:read"), ctrl.listLeads);
router.get("/leads/:id", authenticate, authorizeRoles(...staffRoles), authorizePermissions("leads:read"), ctrl.getLead);
router.post("/leads/:id/seen", authenticate, authorizeRoles(...staffRoles), authorizePermissions("leads:read"), ctrl.markLeadSeen);
router.patch("/leads/:id/status", authenticate, authorizeRoles(...staffRoles), authorizePermissions("leads:update"), ctrl.updateLeadStatus);
router.patch("/leads/:id/assign", authenticate, authorizeRoles(...staffRoles), authorizePermissions("leads:update"), ctrl.assignLead);
router.post("/leads/:id/notes", authenticate, authorizeRoles(...staffRoles), authorizePermissions("leads:update"), ctrl.addLeadNote);

// Phase 6 — state-machine-enforced lead lifecycle transitions (see quiz.service.js).
// Each of these permits exactly one transition; contrast with the freeform
// PATCH /leads/:id/status above, which is an unrestricted admin override.
router.patch("/leads/:id/confirm-consultation", authenticate, authorizeRoles(...staffRoles), authorizePermissions("leads:update"), ctrl.confirmConsultation);
router.patch("/leads/:id/complete-consultation", authenticate, authorizeRoles(...staffRoles), authorizePermissions("leads:update"), ctrl.completeConsultation);
router.patch("/leads/:id/approve", authenticate, authorizeRoles(...staffRoles), authorizePermissions("leads:update"), ctrl.approveLead);
router.patch("/leads/:id/reject", authenticate, authorizeRoles(...staffRoles), authorizePermissions("leads:update"), ctrl.rejectLead);

module.exports = router;
