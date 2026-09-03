const User = require("../../models/User");
const Client = require("../../models/Client");
const Case = require("../../models/Case");
const Referral = require("../../models/Referral");
const tokenService = require("./token.service");
const sessionService = require("./session.service");
const env = require("../../config/env");
const { canCreateUserRole } = require("../authorization/rbac.service");
const { normalizeRole } = require("../authorization/roleHierarchy");
const { generateUniqueReferralCode } = require("../../utils/referralCode");
const { invalidateUserCache } = require("../../config/redis");
const { isPendingInvite } = require("./employeeInvite.service");
const { isPendingClientInvite } = require("./clientInvite.service");

function authPayload(user, accessToken, refreshToken, options = {}) {
  const userPayload = user.toAuthJSON ? user.toAuthJSON() : user;
  return {
    success: true,
    message: options.message || "Authentication successful",
    user: userPayload,
    token: accessToken,
    accessToken,
  };
}

async function applyReferralOnSignup(newUser, referralCode) {
  if (!referralCode) return;
  const code = String(referralCode).trim().toUpperCase();
  if (!code) return;
  const referrer = await User.findOne({ referralCode: code });
  if (!referrer || referrer._id.toString() === newUser._id.toString()) return;
  newUser.referredBy = referrer._id;
  newUser.referredWithCode = code;
  newUser.referralDiscountAvailable = true;
  newUser.referralDiscountReason = "signup";
  await newUser.save();
  await Referral.findOneAndUpdate(
    { referredUser: newUser._id },
    { code, referrer: referrer._id, referredUser: newUser._id, discountPercent: Number(process.env.REFERRAL_DISCOUNT_PERCENT || 10), status: "pending" },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function issueTokens(user, req, options = {}) {
  const accessToken = tokenService.generateAccessToken(user);
  const refreshToken = tokenService.generateRefreshToken(user);
  await sessionService.createSession(user, refreshToken, req);
  // authPayload() deliberately omits refreshToken (see auth.security.test.js
  // — it must never appear in a JSON response body). Callers still need the
  // real value to set the httpOnly cookie, so it's attached here, on the
  // object issueTokens() itself returns — every controller that calls this
  // must strip `refreshToken` back off before res.json()'ing the rest (see
  // splitRefreshToken() in auth.controller.js).
  return { ...authPayload(user, accessToken, refreshToken, options), refreshToken };
}

async function registerClient(payload, req) {
  const email = payload.email?.toLowerCase();
  const exists = await User.findOne({ email }).select("+password");
  if (exists) {
    // A passwordless invited employee (see employment-workflow's
    // sendEmployeeInvite) who tries the normal signup with their invited
    // email is not "already registered" in any useful sense — there's no
    // password to log in with. Signal it distinctly so the frontend can
    // guide them to activation instead of a dead-end 409. An ordinary
    // duplicate email (a real account with a password) still gets the
    // plain 409 below, unchanged.
    if (isPendingInvite(exists)) {
      const error = new Error("This email has a pending invitation. Check your email or request a new invite to activate your account.");
      error.status = 409;
      error.code = "PENDING_INVITE";
      throw error;
    }
    // Same idea, for a client whose case was created by staff via the
    // INSZoom portal (see cases:createCaseWithClient) — they have a User
    // record but no password yet, so ordinary signup should redirect them
    // to activation instead of a dead-end 409.
    if (isPendingClientInvite(exists)) {
      const error = new Error("This email has a pending portal invitation. Check your email or request a new invite to activate your account.");
      error.status = 409;
      error.code = "PENDING_CLIENT_INVITE";
      throw error;
    }
    const error = new Error("Email already registered");
    error.status = 409;
    throw error;
  }

  const requestedRole = ["employer", "employee"].includes(payload.accountType) ? payload.accountType : "client";
  const role = env.adminEmails.includes(email) ? "admin" : requestedRole;
  const referralCode = await generateUniqueReferralCode(User);
  const user = await User.create({
    email,
    password: payload.password,
    name: payload.name || payload.displayName,
    displayName: payload.displayName || payload.name,
    phone: payload.phone,
    role,
    referralCode,
  });
  await applyReferralOnSignup(user, payload.referralCode);
  await Client.findOneAndUpdate(
    { user: user._id },
    { user: user._id, email: user.email, fullName: user.name || user.displayName, primaryPhone: user.phone, source: "shared" },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return issueTokens(user, req, { message: "Account created successfully" });
}

async function registerStaff(payload, currentUser, req) {
  const role = normalizeRole(payload.role);
  if (!canCreateUserRole(currentUser, role)) {
    const error = new Error("You do not have permission to create a user with this role");
    error.status = 403;
    throw error;
  }

  const email = payload.email?.toLowerCase();
  const exists = await User.findOne({ email });
  if (exists) {
    const error = new Error("Email already registered");
    error.status = 409;
    throw error;
  }

  const user = await User.create({
    email,
    password: payload.password,
    name: payload.name || payload.displayName,
    displayName: payload.displayName || payload.name,
    role,
    permissions: payload.permissions || [],
    phone: payload.phone,
    department: payload.department,
    specialization: payload.specialization,
    teamId: payload.teamId,
    companyId: payload.companyId,
  });

  return {
    success: true,
    message: "User created successfully",
    user: user.toAuthJSON ? user.toAuthJSON() : user,
  };
}

async function login(email, password, req) {
  const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
  if (!user) {
    const error = new Error("Invalid email or password");
    error.status = 401;
    throw error;
  }
  if (user.isLocked && user.isLocked()) {
    const error = new Error("Account temporarily locked due to failed login attempts");
    error.status = 423;
    throw error;
  }
  // A passwordless invited employee has no password to compare against —
  // that's not a wrong-password attempt (so it shouldn't count toward
  // lockout), it's an account that hasn't been activated yet.
  if (isPendingInvite(user)) {
    const error = new Error("This account hasn't been activated yet. Check your email for an invitation, or request a new one.");
    error.status = 401;
    error.code = "PENDING_INVITE";
    throw error;
  }
  const passwordMatches = await user.comparePassword(password);
  if (!passwordMatches) {
    user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
    if (user.failedLoginAttempts >= 5) user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
    user.loginHistory = [...(user.loginHistory || []).slice(-19), {
      loggedInAt: new Date(),
      ipAddress: req?.ip,
      userAgent: req?.headers?.["user-agent"],
      success: false,
    }];
    await user.save();
    const error = new Error("Invalid email or password");
    error.status = 401;
    throw error;
  }
  if (!user.isActive) {
    const error = new Error("Account deactivated");
    error.status = 403;
    throw error;
  }

  user.lastLogin = new Date();
  user.failedLoginAttempts = 0;
  user.lockedUntil = undefined;
  user.loginHistory = [...(user.loginHistory || []).slice(-19), {
    loggedInAt: new Date(),
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
    success: true,
  }];
  await user.save();
  return issueTokens(user, req, { message: "Login successful" });
}

/**
 * PHASE 3 addition — authenticates a client using their human-readable
 * Case ID (e.g. 'B001') and password instead of email. Returns the exact
 * same shape as login() (via issueTokens/authPayload) so the controller's
 * post-resolution logic (token issuance, cookie setting, response) works
 * identically for both paths.
 *
 * Every security check below (lockout, pending-invite, failed-attempt
 * recording, login history) is copied verbatim from login() — this must
 * never have weaker security behavior than the email path. The only
 * difference is how the User document is found: by resolving a Case's
 * `user` field first, since a Case ID is not itself a User identifier.
 *
 * Read-only with respect to Case data — only ever reads the Case to find
 * the linked User; never writes to it.
 *
 * Does NOT modify login() — that function is completely untouched.
 */
async function loginWithCaseId(caseNumber, password, req) {
  const caseDoc = await Case.findOne({ caseNumber }).select("caseNumber user");
  // Case not found and "case has no linked user" both fall through to the
  // same generic, non-disclosing error as an unknown email would — never
  // reveal which part of the lookup failed.
  const linkedUserId = caseDoc?.user;
  if (!caseDoc || !linkedUserId) {
    const error = new Error("Invalid Case ID or password");
    error.status = 401;
    throw error;
  }

  const user = await User.findById(linkedUserId).select("+password");
  if (!user) {
    const error = new Error("Invalid Case ID or password");
    error.status = 401;
    throw error;
  }
  if (user.isLocked && user.isLocked()) {
    const error = new Error("Account temporarily locked due to failed login attempts");
    error.status = 423;
    throw error;
  }
  if (isPendingInvite(user)) {
    const error = new Error("This account hasn't been activated yet. Check your email for an invitation, or request a new one.");
    error.status = 401;
    error.code = "PENDING_INVITE";
    throw error;
  }
  const passwordMatches = await user.comparePassword(password);
  if (!passwordMatches) {
    user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
    if (user.failedLoginAttempts >= 5) user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
    user.loginHistory = [...(user.loginHistory || []).slice(-19), {
      loggedInAt: new Date(),
      ipAddress: req?.ip,
      userAgent: req?.headers?.["user-agent"],
      success: false,
    }];
    await user.save();
    const error = new Error("Invalid Case ID or password");
    error.status = 401;
    throw error;
  }
  if (!user.isActive) {
    const error = new Error("Account deactivated");
    error.status = 403;
    throw error;
  }

  user.lastLogin = new Date();
  user.failedLoginAttempts = 0;
  user.lockedUntil = undefined;
  user.loginHistory = [...(user.loginHistory || []).slice(-19), {
    loggedInAt: new Date(),
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
    success: true,
  }];
  await user.save();
  return issueTokens(user, req, { message: "Login successful" });
}

// Mirrors loginWithCaseId's exact lock/pending-invite/password/isActive
// sequence, minus the Case-lookup indirection (username resolves directly
// to a User, unlike a Case ID).
async function loginWithUsername(username, password, req) {
  const user = await User.findOne({ username: String(username).trim().toLowerCase() }).select("+password");
  if (!user) {
    const error = new Error("Invalid username or password");
    error.status = 401;
    throw error;
  }
  if (user.isLocked && user.isLocked()) {
    const error = new Error("Account temporarily locked due to failed login attempts");
    error.status = 423;
    throw error;
  }
  if (isPendingInvite(user)) {
    const error = new Error("This account hasn't been activated yet. Check your email for an invitation, or request a new one.");
    error.status = 401;
    error.code = "PENDING_INVITE";
    throw error;
  }
  const passwordMatches = await user.comparePassword(password);
  if (!passwordMatches) {
    user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
    if (user.failedLoginAttempts >= 5) user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
    user.loginHistory = [...(user.loginHistory || []).slice(-19), {
      loggedInAt: new Date(),
      ipAddress: req?.ip,
      userAgent: req?.headers?.["user-agent"],
      success: false,
    }];
    await user.save();
    const error = new Error("Invalid username or password");
    error.status = 401;
    throw error;
  }
  if (!user.isActive) {
    const error = new Error("Account deactivated");
    error.status = 403;
    throw error;
  }

  user.lastLogin = new Date();
  user.failedLoginAttempts = 0;
  user.lockedUntil = undefined;
  user.loginHistory = [...(user.loginHistory || []).slice(-19), {
    loggedInAt: new Date(),
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
    success: true,
  }];
  await user.save();
  return issueTokens(user, req, { message: "Login successful" });
}

async function loginWithVerifiedIdentity(identity, req) {
  const email = identity.email?.toLowerCase();
  if (!email) {
    const error = new Error("Verified identity did not include an email address");
    error.status = 400;
    throw error;
  }
  let user = await User.findOne({ email });
  if (!user) {
    user = await User.create({
      email,
      name: identity.name || identity.displayName || email.split("@")[0],
      displayName: identity.displayName || identity.name || email.split("@")[0],
      avatar: identity.picture,
      profileImage: identity.picture,
      role: env.adminEmails.includes(email) ? "admin" : "client",
      isEmailVerified: Boolean(identity.emailVerified),
      referralCode: await generateUniqueReferralCode(User),
    });
    await Client.findOneAndUpdate(
      { user: user._id },
      { user: user._id, email: user.email, fullName: user.name || user.displayName, source: "shared" },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } else {
    user.name = user.name || identity.name || identity.displayName;
    user.displayName = user.displayName || identity.displayName || identity.name;
    user.avatar = user.avatar || identity.picture;
    user.profileImage = user.profileImage || identity.picture;
    if (identity.emailVerified) user.isEmailVerified = true;
    if (env.adminEmails.includes(email) && user.role !== "admin" && user.role !== "super_admin") user.role = "admin";
  }
  if (!user.isActive) {
    const error = new Error("Account deactivated");
    error.status = 403;
    throw error;
  }
  user.lastLogin = new Date();
  await user.save();
  return issueTokens(user, req, { message: "Google sign-in successful" });
}

async function refresh(refreshToken, req) {
  const decoded = tokenService.verifyRefreshToken(refreshToken);
  const session = await sessionService.findActiveSession(refreshToken);
  if (!session) {
    const error = new Error("Invalid or expired refresh token");
    error.status = 401;
    throw error;
  }

  const user = await User.findById(decoded.userId);
  if (!user || !user.isActive || (user.tokenVersion || 0) !== (decoded.tokenVersion || 0)) {
    const error = new Error("Invalid or expired refresh token");
    error.status = 401;
    throw error;
  }

  const accessToken = tokenService.generateAccessToken(user);
  const newRefreshToken = tokenService.generateRefreshToken(user);
  await sessionService.rotateSession(session, newRefreshToken, req);
  return { accessToken, refreshToken: newRefreshToken };
}

async function changePassword(userId, currentPassword, newPassword) {
  const user = await User.findById(userId).select("+password");
  if (!user || !(await user.comparePassword(currentPassword))) {
    const error = new Error("Current password is incorrect");
    error.status = 400;
    throw error;
  }
  user.password = newPassword;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await invalidateUserCache(user._id);
  await sessionService.revokeAllSessions(user._id);
}

module.exports = {
  authPayload,
  issueTokens,
  registerClient,
  registerStaff,
  login,
  loginWithCaseId,
  loginWithUsername,
  loginWithVerifiedIdentity,
  refresh,
  changePassword,
};
