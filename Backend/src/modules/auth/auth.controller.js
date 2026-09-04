const crypto = require("crypto");
const Case = require("../../models/Case");
const authService = require("./auth.service");
const sessionService = require("./session.service");
const passwordResetService = require("./passwordReset.service");
const emailVerificationService = require("./emailVerification.service");
const employeeInviteService = require("./employeeInvite.service");
const clientInviteService = require("./clientInvite.service");
const googleOAuthService = require("./google-oauth.service");
const emailService = require("../email/email.service");
const env = require("../../config/env");
const logger = require("../../utils/logger");
const { invalidateUserCache } = require("../../config/redis");

const REFRESH_COOKIE_NAME = "refresh_token";
const REFRESH_COOKIE_PATH = "/api/auth";

function refreshCookieOptions() {
  // SameSite=None is rejected by browsers unless Secure is also set,
  // regardless of NODE_ENV — see env.refreshCookieSameSite's comment.
  const sameSite = env.refreshCookieSameSite;
  return {
    httpOnly: true,
    secure: sameSite === "none" ? true : env.nodeEnv === "production",
    sameSite,
    path: REFRESH_COOKIE_PATH,
  };
}

// Safe, non-sensitive diagnostics for confirming the actual production
// cookie topology from logs — never logs the token/cookie value itself, only
// whether one was present and where the request said it came from.
function logRefreshCookieDiagnostics(event, req) {
  logger.info("refresh_cookie_diagnostics", {
    event,
    origin: req.headers?.origin || null,
    cookiePresent: Boolean(req.cookies?.[REFRESH_COOKIE_NAME]),
    sameSiteConfigured: env.refreshCookieSameSite,
  });
}

function setRefreshCookie(res, refreshToken) {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    ...refreshCookieOptions(),
    maxAge: env.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
}

// issueTokens()/refresh() attach the real refresh token onto their returned
// object so the cookie can actually be set — but it must never reach the
// client in the response body (see auth.security.test.js). Every call site
// that both sets the cookie AND res.json()'s the rest of the result goes
// through this so the token is never accidentally spread into a response.
function splitRefreshToken(result) {
  const { refreshToken, ...responseBody } = result;
  return { refreshToken, responseBody };
}

async function register(req, res, next) {
  try {
    const result = await authService.registerClient(req.body, req);
    res.locals.authUserId = result.user?._id;
    const { refreshToken, responseBody } = splitRefreshToken(result);
    setRefreshCookie(res, refreshToken);
    res.status(201).json(responseBody);
  } catch (error) {
    next(error);
  }
}

async function registerStaff(req, res, next) {
  try {
    const result = await authService.registerStaff(req.body, req.user, req);
    res.locals.authUserId = result.user?._id;
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

async function login(req, res, next) {
  try {
    // Three-way login path — { caseId, password }, { username, password },
    // or { email, password } (original, unchanged). Everything from here
    // down (token issuance, cookie setting, response body) is identical.
    const result = req.body.caseId
      ? await authService.loginWithCaseId(String(req.body.caseId).trim().toUpperCase(), req.body.password, req)
      : req.body.username
        ? await authService.loginWithUsername(String(req.body.username).trim(), req.body.password, req)
        : await authService.login(req.body.email, req.body.password, req);
    res.locals.authUserId = result.user?._id;
    const { refreshToken, responseBody } = splitRefreshToken(result);
    setRefreshCookie(res, refreshToken);
    res.json(responseBody);
  } catch (error) {
    next(error);
  }
}

// Firebase-based Google ID-token verification was removed (Firebase Auth is
// no longer part of this app). This endpoint is kept — same route, same
// request contract ({ idToken }) — so the frontend's "Continue with Google"
// button still has a real backend to call rather than a 404, but it cannot
// complete sign-in until a replacement verifier (Google Identity Services +
// google-auth-library, verifying against GOOGLE_OAUTH_CLIENT_ID) is wired up
// in a future phase. authService.loginWithVerifiedIdentity(identity, req) is
// unaffected and ready to receive whatever verified identity that future
// verifier produces — it was never Firebase-specific.
async function googleToken(req, res, next) {
  try {
    if (!req.body.idToken) return res.status(400).json({ success: false, message: "Google ID token required" });
    const error = new Error("Google sign-in is temporarily unavailable. Please use email login.");
    error.status = 503;
    error.code = "GOOGLE_AUTH_NOT_CONFIGURED";
    throw error;
  } catch (error) {
    next(error);
  }
}

// ── Google OAuth (authorization-code redirect flow) ─────────────────────
// GOOGLE_CLIENT_ID/SECRET stay backend-only throughout this flow: the
// browser only ever sees the Google-hosted consent screen and this app's
// own /auth/callback query params (accessToken/userId/email/displayName/
// role — the exact contract OAuthCallback.jsx already parses). The
// short-lived state cookie below is CSRF protection for the callback, not a
// session token, and is cleared as soon as it's checked.
const GOOGLE_STATE_COOKIE = "google_oauth_state";
const GOOGLE_STATE_COOKIE_PATH = "/api/auth/google";

function googleStateCookieOptions() {
  return {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: "lax",
    path: GOOGLE_STATE_COOKIE_PATH,
  };
}

// Last line of defense: env.js's production boot guard is supposed to make
// an unsafe clientUrl unreachable whenever NODE_ENV is genuinely
// "production" (it throws at startup otherwise), and oauthRedirectUri has
// no localhost fallback in production either — but if NODE_ENV is
// misreported to the live process, or a future change weakens either
// guard, this stops the OAuth flow from ever redirecting a browser to
// env.clientUrl, or sending env.google.oauthRedirectUri to Google, anyway.
// Only reachable via googleOAuthStart/googleOAuthCallback below — nothing
// past this point may redirect using either value unless this returns true.
function ensureSafeOAuthConfig(res) {
  if (env.nodeEnv === "production" && (!env.clientUrlSafe || !env.google.oauthRedirectUriSafe)) {
    logger.fatal("google_oauth_unsafe_config_blocked", {
      nodeEnv: env.nodeEnv,
      clientUrl: env.clientUrl,
      clientUrlSafe: env.clientUrlSafe,
      oauthRedirectUri: env.google.oauthRedirectUri,
      oauthRedirectUriSafe: env.google.oauthRedirectUriSafe,
    });
    res.status(503).json({
      success: false,
      message: "Sign-in is temporarily unavailable. Please try again shortly or contact support.",
      code: "CLIENT_URL_MISCONFIGURED",
    });
    return false;
  }
  return true;
}

// Only reachable once ensureSafeOAuthConfig has confirmed env.clientUrl is
// safe to redirect a browser to (see its call sites in googleOAuthStart/
// googleOAuthCallback below).
function googleCallbackRedirectUrl(params) {
  const url = new URL("/auth/callback", env.clientUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  return url.toString();
}

function googleOAuthStart(req, res) {
  if (!ensureSafeOAuthConfig(res)) return;
  if (!googleOAuthService.isConfigured()) {
    logger.warn("google_oauth_start_not_configured", {});
    return res.redirect(googleCallbackRedirectUrl({ error: "google_not_configured" }));
  }
  try {
    const state = crypto.randomBytes(24).toString("hex");
    res.cookie(GOOGLE_STATE_COOKIE, state, { ...googleStateCookieOptions(), maxAge: 5 * 60 * 1000 });
    const authUrl = googleOAuthService.buildAuthUrl(state);
    res.redirect(authUrl);
  } catch (error) {
    logger.error("google_oauth_start_failed", { error });
    res.redirect(googleCallbackRedirectUrl({ error: "google_not_configured" }));
  }
}

async function googleOAuthCallback(req, res) {
  if (!ensureSafeOAuthConfig(res)) return;
  const expectedState = req.cookies?.[GOOGLE_STATE_COOKIE];
  res.clearCookie(GOOGLE_STATE_COOKIE, googleStateCookieOptions());
  try {
    // A user who clicks "Cancel"/denies consent on Google's own screen comes
    // back here with ?error=access_denied rather than a code — not a server
    // failure, just an abandoned login.
    if (req.query.error) {
      return res.redirect(googleCallbackRedirectUrl({ error: "google_cancelled" }));
    }
    const { code, state } = req.query;
    if (!code || !state || !expectedState || state !== expectedState) {
      return res.redirect(googleCallbackRedirectUrl({ error: "invalid_state" }));
    }
    const identity = await googleOAuthService.exchangeCodeForIdentity(code);
    const result = await authService.loginWithVerifiedIdentity(identity, req);
    res.locals.authUserId = result.user?._id;
    res.locals.authUserRole = result.user?.role;
    setRefreshCookie(res, result.refreshToken);
    res.redirect(
      googleCallbackRedirectUrl({
        accessToken: result.accessToken,
        userId: result.user?._id,
        email: result.user?.email,
        displayName: result.user?.displayName || result.user?.name,
        role: result.user?.role,
      })
    );
  } catch (error) {
    // Never let a Google/network failure here reach the default Express
    // error handler (which would render a JSON 500 page instead of landing
    // the browser back on the app) — always resolve to a redirect, and
    // never include error.message (could echo back provider details) in
    // the query string the browser ends up with.
    logger.error("google_oauth_callback_failed", { error, code: error.code });
    res.redirect(googleCallbackRedirectUrl({ error: "google_auth_failed" }));
  }
}

async function refresh(req, res, next) {
  try {
    logRefreshCookieDiagnostics("refresh_attempt", req);
    const incomingRefreshToken = req.body.refreshToken || req.cookies?.[REFRESH_COOKIE_NAME];
    if (!incomingRefreshToken) return res.status(401).json({ success: false, message: "Refresh token required" });
    const result = await authService.refresh(incomingRefreshToken, req);
    const { refreshToken, responseBody } = splitRefreshToken(result);
    setRefreshCookie(res, refreshToken);
    res.json(responseBody);
  } catch (error) {
    next(error);
  }
}

async function logout(req, res, next) {
  try {
    const incomingRefreshToken = req.body.refreshToken || req.cookies?.[REFRESH_COOKIE_NAME];
    if (incomingRefreshToken) await sessionService.revokeSession(incomingRefreshToken);
    clearRefreshCookie(res);
    res.json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    next(error);
  }
}

async function logoutAll(req, res, next) {
  try {
    await sessionService.revokeAllSessions(req.user._id);
    clearRefreshCookie(res);
    res.json({ success: true, message: "All sessions revoked successfully" });
  } catch (error) {
    next(error);
  }
}

function me(req, res) {
  res.json({
    success: true,
    user: req.user.toAuthJSON ? req.user.toAuthJSON() : req.user,
    // Server-delivered feature-flag defaults — the production kill switch for
    // frontend rollouts (see src/utils/featureFlags.js on the client). Adding
    // a flag here is a config-delivery change only, never a data-model change.
    features: {
      unifiedChecklist: process.env.FEATURE_UNIFIED_CHECKLIST === "true",
    },
  });
}

/**
 * GET /api/auth/session-context
 *
 * Returns the complete routing context for the authenticated user.
 * This is the single source of truth for all BAIS frontend routing
 * decisions (see BAIS/Frontend/src/components/AuthGate.jsx) — nothing else
 * should independently decide where to route a session based on case status.
 *
 * Pure read: never writes to any model.
 *
 * Response shape:
 * {
 *   success: true,
 *   userId: string,
 *   role: string,
 *   hasCase: boolean,
 *   caseIds: string[],          // human-readable case numbers, e.g. ['B001']
 *   activeCase: string | null,  // primaryCaseId's case number, or most recent
 *   isLegacyNoCaseAccount: boolean,
 *   leadId: string | null,
 *   mustSetPassword: boolean,
 *   caseRole: string | null,
 * }
 */
async function getSessionContext(req, res, next) {
  try {
    const user = req.user; // full Mongoose User document, populated by `authenticate`

    if (!["client", "employer", "employee", "beneficiary"].includes(user.role)) {
      return res.status(200).json({
        success: true,
        userId: user._id.toString(),
        role: user.role,
        hasCase: false,
        caseIds: [],
        activeCase: null,
        isLegacyNoCaseAccount: false,
        leadId: null,
        mustSetPassword: user.mustSetPassword || false,
        caseRole: user.caseRole || null,
      });
    }

    let caseIds = [];
    let activeCase = null;
    let hasCase = false;

    if (user.caseIds && user.caseIds.length > 0) {
      const cases = await Case.find({ _id: { $in: user.caseIds } }, { caseNumber: 1, createdAt: 1 })
        .sort({ createdAt: -1 })
        .lean();

      caseIds = cases.map((c) => c.caseNumber).filter(Boolean);
      hasCase = caseIds.length > 0;

      if (user.primaryCaseId) {
        const primaryCase = cases.find((c) => c._id.toString() === user.primaryCaseId.toString());
        activeCase = primaryCase?.caseNumber || caseIds[0] || null;
      } else {
        activeCase = caseIds[0] || null;
      }
    }

    return res.status(200).json({
      success: true,
      userId: user._id.toString(),
      role: user.role,
      hasCase,
      caseIds,
      activeCase,
      isLegacyNoCaseAccount: user.legacyNoCaseAccount || false,
      leadId: user.leadId ? user.leadId.toString() : null,
      mustSetPassword: user.mustSetPassword || false,
      caseRole: user.caseRole || null,
    });
  } catch (error) {
    next(error);
  }
}

async function updateDetails(req, res, next) {
  try {
    const allowed = ["name", "displayName", "phone", "department", "specialization", "avatar"];
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) req.user[field] = req.body[field];
    });
    // Pre-case applicant-type choice (PlanSelection / a first-run prompt) —
    // changeable at any time. An invited employee flipping this has no
    // effect: isEmployerCapable() in employment-workflow.controller.js
    // excludes role "employee" outright, regardless of applicantType.
    if (req.body.applicantType !== undefined) req.user.applicantType = req.body.applicantType;
    await req.user.save();
    await invalidateUserCache(req.user._id);
    res.json({ success: true, user: req.user.toAuthJSON() });
  } catch (error) {
    next(error);
  }
}

async function changePassword(req, res, next) {
  try {
    await authService.changePassword(req.user._id, req.body.currentPassword, req.body.newPassword);
    res.json({ success: true, message: "Password updated successfully" });
  } catch (error) {
    next(error);
  }
}

async function forgotPassword(req, res, next) {
  try {
    const result = await passwordResetService.createPasswordResetToken(req.body.email);
    // Only send an email when the account actually exists — but the
    // response below is IDENTICAL either way, so a caller can never learn
    // whether an email is registered from this endpoint's behavior.
    if (result) {
      const { token, user } = result;
      res.locals.authUserId = user._id;
      await emailService.sendTemplateEmail("password-reset", {
        to: user.email,
        data: { name: user.name || user.displayName, token },
        userId: user._id,
        source: "shared",
      });
    }
    res.json({
      success: true,
      message: "If an account exists for this email, password reset instructions will be sent.",
    });
  } catch (error) {
    next(error);
  }
}

async function resetPassword(req, res, next) {
  try {
    if (req.body.confirmPassword !== undefined && req.body.newPassword !== req.body.confirmPassword) {
      return res.status(400).json({ success: false, message: "Passwords do not match" });
    }
    const user = await passwordResetService.resetPassword(req.body.token, req.body.newPassword);
    if (!user) return res.status(400).json({ success: false, message: "Invalid or expired reset token" });
    res.locals.authUserId = user._id;
    res.json({ success: true, message: "Password reset successfully" });
  } catch (error) {
    next(error);
  }
}

async function resendInvite(req, res, next) {
  try {
    // Public + neutral, mirroring forgotPassword: never reveals whether the
    // email exists or is a pending invite. Guides a passwordless invited
    // employee (or a staff-created client) back to activation without ever
    // exposing a token in the API.
    const empResult = await employeeInviteService.resendInviteEmail(req.body.email);
    if (!empResult.sent) {
      await clientInviteService.resendClientInviteEmail(req.body.email);
    }
    res.json({
      success: true,
      message: "If an account is pending activation for this email, a new invitation has been sent.",
    });
  } catch (error) {
    next(error);
  }
}

async function verifyEmail(req, res, next) {
  try {
    const user = await emailVerificationService.verifyEmailToken(req.body.token);
    if (!user) return res.status(400).json({ success: false, message: "Invalid or expired verification token" });
    res.json({ success: true, message: "Email verified successfully" });
  } catch (error) {
    next(error);
  }
}

async function resendVerification(req, res, next) {
  try {
    const token = await emailVerificationService.createEmailVerificationToken(req.user._id);
    res.json({
      success: true,
      message: "Verification instructions generated.",
      ...(process.env.NODE_ENV === "development" ? { verificationToken: token } : {}),
    });
  } catch (error) {
    next(error);
  }
}

async function getInviteDetails(req, res, next) {
  try {
    const details =
      (await employeeInviteService.getInviteDetails(req.params.token)) ||
      (await clientInviteService.getClientInviteDetails(req.params.token));
    if (!details) return res.status(400).json({ success: false, message: "Invalid or expired invitation link" });
    res.json({ success: true, ...details });
  } catch (error) {
    next(error);
  }
}

async function acceptInvite(req, res, next) {
  try {
    if (req.body.password !== req.body.confirmPassword) {
      return res.status(400).json({ success: false, message: "Passwords do not match" });
    }
    const username = req.body.username?.trim() || undefined;
    let user = await employeeInviteService.acceptInvite(req.params.token, req.body.password, username);
    if (!user) {
      user = await clientInviteService.acceptClientInvite(req.params.token, req.body.password, username);
    }
    if (!user) return res.status(400).json({ success: false, message: "Invalid or expired invitation link" });
    const result = await authService.issueTokens(user, req, { message: "Account activated successfully" });
    res.locals.authUserId = user._id;
    const { refreshToken, responseBody } = splitRefreshToken(result);
    setRefreshCookie(res, refreshToken);
    res.json(responseBody);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  register,
  registerStaff,
  googleToken,
  googleOAuthStart,
  googleOAuthCallback,
  login,
  refresh,
  logout,
  logoutAll,
  me,
  getSessionContext,
  updateDetails,
  changePassword,
  forgotPassword,
  resetPassword,
  resendInvite,
  verifyEmail,
  resendVerification,
  getInviteDetails,
  acceptInvite,
};
