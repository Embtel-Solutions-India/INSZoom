const authService = require("./auth.service");
const sessionService = require("./session.service");
const passwordResetService = require("./passwordReset.service");
const emailVerificationService = require("./emailVerification.service");
const employeeInviteService = require("./employeeInvite.service");
const clientInviteService = require("./clientInvite.service");
const firebaseService = require("./firebase.service");
const emailService = require("../email/email.service");
const env = require("../../config/env");
const { invalidateUserCache } = require("../../config/redis");

const REFRESH_COOKIE_NAME = "refresh_token";
const REFRESH_COOKIE_PATH = "/api/auth";

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: "lax",
    path: REFRESH_COOKIE_PATH,
  };
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

async function register(req, res, next) {
  try {
    const result = await authService.registerClient(req.body, req);
    res.locals.authUserId = result.user?._id;
    setRefreshCookie(res, result.refreshToken);
    res.status(201).json(result);
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
    const result = await authService.login(req.body.email, req.body.password, req);
    res.locals.authUserId = result.user?._id;
    setRefreshCookie(res, result.refreshToken);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function googleToken(req, res, next) {
  try {
    if (!req.body.idToken) return res.status(400).json({ success: false, message: "Firebase ID token required" });
    const identity = await firebaseService.verifyIdToken(req.body.idToken);
    const result = await authService.loginWithVerifiedIdentity(identity, req);
    res.locals.authUserId = result.user?._id;
    setRefreshCookie(res, result.refreshToken);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function refresh(req, res, next) {
  try {
    const incomingRefreshToken = req.body.refreshToken || req.cookies?.[REFRESH_COOKIE_NAME];
    if (!incomingRefreshToken) return res.status(401).json({ success: false, message: "Refresh token required" });
    const result = await authService.refresh(incomingRefreshToken, req);
    setRefreshCookie(res, result.refreshToken);
    res.json(result);
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
    let user = await employeeInviteService.acceptInvite(req.params.token, req.body.password);
    if (!user) {
      user = await clientInviteService.acceptClientInvite(req.params.token, req.body.password);
    }
    if (!user) return res.status(400).json({ success: false, message: "Invalid or expired invitation link" });
    const result = await authService.issueTokens(user, req, { message: "Account activated successfully" });
    res.locals.authUserId = user._id;
    setRefreshCookie(res, result.refreshToken);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  register,
  registerStaff,
  googleToken,
  login,
  refresh,
  logout,
  logoutAll,
  me,
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
