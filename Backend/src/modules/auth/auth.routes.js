const router = require("express").Router();
const { body } = require("express-validator");
const ctrl = require("./auth.controller");
const validate = require("../../middleware/validate");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const auditAuth = require("../../middleware/auditAuth");

const emailRule = body("email").isEmail().normalizeEmail().withMessage("Valid email required");
const passwordRule = body("password").isLength({ min: 8 }).withMessage("Password must be at least 8 characters");

router.post(
  "/register",
  [emailRule, passwordRule, body("name").optional().trim().isLength({ min: 2 }), body("displayName").optional().trim().isLength({ min: 2 }), body("accountType").optional().isIn(["client", "employee", "employer"])],
  validate,
  auditAuth("auth.register"),
  ctrl.register
);

router.post(
  "/staff/register",
  authenticate,
  authorizeRoles("super_admin", "admin"),
  [emailRule, passwordRule, body("role").notEmpty().withMessage("Role is required")],
  validate,
  auditAuth("auth.staff_register"),
  ctrl.registerStaff
);

// Login accepts { email, password }, { caseId, password } (a human-readable
// case number), or { username, password } — exactly one identifier must be
// present; password is unconditionally required either way.
const loginRules = [
  body("email")
    .if((value, { req }) => !req.body.caseId && !req.body.username)
    .isEmail()
    .normalizeEmail()
    .withMessage("Valid email is required when caseId and username are not provided"),
  body("caseId")
    .if((value, { req }) => !req.body.email && !req.body.username)
    .notEmpty()
    .trim()
    .withMessage("caseId is required when email and username are not provided"),
  body("username")
    .if((value, { req }) => !req.body.email && !req.body.caseId)
    .notEmpty()
    .trim()
    .withMessage("username is required when email and caseId are not provided"),
  body("password").notEmpty().withMessage("Password is required"),
];
router.post("/login", loginRules, validate, auditAuth("auth.login"), ctrl.login);
router.post("/google-token", [body("idToken").notEmpty()], validate, auditAuth("auth.google_token"), ctrl.googleToken);
// "Continue with Google" — authorization-code redirect flow. GET (not POST):
// this is a full-page browser navigation to Google, not an API call.
router.get("/google", auditAuth("auth.google_oauth_start"), ctrl.googleOAuthStart);
router.get("/google/callback", auditAuth("auth.google_oauth_callback"), ctrl.googleOAuthCallback);
router.post("/refresh", auditAuth("auth.refresh"), ctrl.refresh);
router.post("/logout", authenticate, auditAuth("auth.logout"), ctrl.logout);
router.post("/logout-all", authenticate, auditAuth("auth.logout_all"), ctrl.logoutAll);
router.get("/me", authenticate, ctrl.me);
// GET /api/auth/session-context
// Returns the complete routing context for the authenticated user.
// This is the single source of truth for frontend routing decisions
// (see BAIS/Frontend/src/components/AuthGate.jsx). Requires a valid JWT.
router.get("/session-context", authenticate, ctrl.getSessionContext);
router.put(
  "/change-password",
  authenticate,
  [body("currentPassword").notEmpty(), body("newPassword").isLength({ min: 8 })],
  validate,
  auditAuth("auth.change_password"),
  ctrl.changePassword
);

router.put("/updatedetails", authenticate, ctrl.updateDetails);
router.put("/updatepassword", authenticate, [body("currentPassword").notEmpty(), body("newPassword").isLength({ min: 8 })], validate, ctrl.changePassword);
router.post("/forgot-password", [emailRule], validate, auditAuth("password.reset_requested"), ctrl.forgotPassword);
router.post("/reset-password", [body("token").notEmpty(), body("newPassword").isLength({ min: 8 })], validate, auditAuth("password.reset_completed"), ctrl.resetPassword);
router.post("/verify-email", [body("token").notEmpty()], validate, ctrl.verifyEmail);
router.post("/resend-verification", authenticate, ctrl.resendVerification);

router.get("/invite/:token", ctrl.getInviteDetails);
router.post(
  "/invite/:token/accept",
  [
    body("password").isLength({ min: 8 }).withMessage("Password must be at least 8 characters"),
    body("confirmPassword").notEmpty(),
    body("username").optional({ checkFalsy: true }).trim()
      .matches(/^[a-zA-Z0-9._-]{3,30}$/)
      .withMessage("Username must be 3-30 characters: letters, numbers, dots, underscores, hyphens only"),
  ],
  validate,
  auditAuth("auth.accept_invite"),
  ctrl.acceptInvite
);
// Public + neutral (mirrors forgot-password) — lets a passwordless invited
// employee who wandered to login/signup, or whose 7-day invite token
// expired, get a fresh invite emailed to them without ever exposing a token.
router.post("/resend-invite", [emailRule], validate, auditAuth("auth.invite_resent"), ctrl.resendInvite);

module.exports = router;
