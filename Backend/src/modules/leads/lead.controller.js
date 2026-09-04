const { validationResult, body } = require("express-validator");
const leadService = require("./lead.service");

function validationFailed(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ success: false, message: "Validation failed", errors: errors.array() });
    return true;
  }
  return false;
}

exports.createPublicLead = async (req, res, next) => {
  try {
    if (validationFailed(req, res)) return;
    const result = await leadService.createLead(req.body, req);
    res.status(201).json({
      success: true,
      message: "Consultation lead received",
      lead: result.lead,
    });
  } catch (error) {
    next(error);
  }
};

// ─── PHASE 4 ──────────────────────────────────────────────────────────────

// Validation rules for POST /api/leads — matches the Lead model's actual
// flat fields (fullName/email/phone), not the {contact:{...}} nesting the
// original Phase 4 spec sketched, since that's what the model stores.
exports.createLeadRules = [
  body("contact.name").optional().trim(),
  body("contact.email").optional().isEmail().normalizeEmail(),
  body("contact.phone").optional().trim(),
  body("fullName").optional().trim(),
  body("name").optional().trim(),
  body("email").optional().isEmail().normalizeEmail(),
  body("phone").optional().trim(),
  body().custom((value) => {
    const email = value.contact?.email || value.email;
    if (!email) throw new Error("A valid email is required");
    return true;
  }),
  body("visaInterest").optional().trim(),
  body("extensionInterest").optional().trim(),
  // quizAnswers is the raw client payload — stored as-is on Lead.profileAnswers,
  // never individually validated for content (matches how createQuizLead()
  // already treats profileAnswers/criteriaAnswers as opaque).
  body("quizAnswers").optional(),
];

/**
 * POST /api/leads
 * Creates a Lead from a public, pre-login quiz-shaped submission.
 * Public endpoint — no authentication required.
 *
 * INVARIANT: never creates a Case document, User document, Client
 * document, or any canonical/form data. See lead.service.js's
 * createLeadFromQuiz for the full invariant note.
 */
exports.createLeadFromQuiz = async (req, res, next) => {
  try {
    if (validationFailed(req, res)) return;
    const lead = await leadService.createLeadFromQuiz(req.body, req);
    return res.status(201).json({
      success: true,
      leadId: lead._id,
      leadNumber: lead.leadNumber || null,
    });
  } catch (error) {
    next(error);
  }
};

// Validation rules for POST /api/leads/from-intake.
exports.fromIntakeRules = [
  body("visaInterest").optional().trim(),
  body("extensionInterest").optional().trim(),
  body("intakeAnswers").optional(),
];

/**
 * POST /api/leads/from-intake
 * Creates a Lead from a logged-in client's intake questionnaire submission.
 * Requires a valid JWT (see lead.routes.js: authenticate + authorizeRoles).
 *
 * INVARIANT: never creates a Case document, User document, Client document,
 * or any canonical/form data. Creates exactly one Lead document and sets
 * req.user.leadId on the already-existing authenticated User — nothing
 * else is written.
 *
 * The contact email is always req.user.email (see lead.service.js's
 * createLeadFromIntake) — never taken from the request body.
 */
exports.createLeadFromIntake = async (req, res, next) => {
  try {
    if (validationFailed(req, res)) return;
    const lead = await leadService.createLeadFromIntake(req.body, req.user, req);

    // The only write to the User document anywhere in Phase 4. req.user is
    // a full Mongoose document (authenticate middleware confirmed via
    // User.findById(...).select("-password")), so .save() is valid here.
    req.user.leadId = lead._id;
    await req.user.save();

    return res.status(201).json({
      success: true,
      leadId: lead._id,
      leadNumber: lead.leadNumber || null,
    });
  } catch (error) {
    next(error);
  }
};
