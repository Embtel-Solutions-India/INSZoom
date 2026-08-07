const User = require("../../models/User");
const Case = require("../../models/Case");
const { generateOpaqueToken, hashToken } = require("./password.service");
const { invalidateUserCache } = require("../../config/redis");
const emailService = require("../email/email.service");

const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// Generate and persist a fresh invite token on the user record.
// Called at case-creation time and by the resend path.
async function createClientInviteToken(user) {
  const token = generateOpaqueToken();
  user.inviteTokenHash = hashToken(token);
  user.inviteTokenExpiresAt = new Date(Date.now() + INVITE_EXPIRY_MS);
  await user.save();
  return token;
}

// Returns { name, email } for a valid non-expired token, or null.
// Used by GET /auth/invite/:token (shared with the employee path).
async function getClientInviteDetails(token) {
  const user = await User.findOne({
    inviteTokenHash: hashToken(token),
    inviteTokenExpiresAt: { $gt: new Date() },
    role: "client",
  }).select("+inviteTokenHash");
  if (!user) return null;
  return { name: user.name || user.displayName || "", email: user.email };
}

// Activates the account: sets password, clears token fields, marks email verified.
// Returns the activated user, or null for invalid/expired token.
async function acceptClientInvite(token, newPassword) {
  const user = await User.findOne({
    inviteTokenHash: hashToken(token),
    inviteTokenExpiresAt: { $gt: new Date() },
    role: "client",
  }).select("+inviteTokenHash");
  if (!user) return null;

  user.password = newPassword;
  user.inviteTokenHash = undefined;
  user.inviteTokenExpiresAt = undefined;
  user.isActive = true;
  user.isEmailVerified = true;
  await user.save();
  await invalidateUserCache(user._id);
  return user;
}

// True only for a real client account that was created by staff and has not
// yet activated (no password set). Deliberately not gated on token expiry —
// that case is exactly what a resend recovers.
function isPendingClientInvite(user) {
  return Boolean(user) && user.role === "client" && !user.password;
}

// Resend path — same neutral / silent contract as employeeInvite.resendInviteEmail.
// Never throws; never reveals whether the email exists or its state.
async function resendClientInviteEmail(email) {
  if (!email) return { sent: false };
  const user = await User.findOne({
    email: String(email).toLowerCase(),
    role: "client",
  }).select("+password");
  if (!isPendingClientInvite(user)) return { sent: false };

  const caseData = await Case.findOne({ user: user._id }).sort({ createdAt: -1 });
  const token = await createClientInviteToken(user);
  await emailService.sendTemplateEmail("client-portal-invitation", {
    to: user.email,
    data: {
      clientName: user.name || user.displayName,
      caseNumber: caseData?.caseNumber,
      token,
    },
    caseId: caseData?._id,
    userId: user._id,
    source: "shared",
  });
  return { sent: true };
}

module.exports = {
  createClientInviteToken,
  getClientInviteDetails,
  acceptClientInvite,
  isPendingClientInvite,
  resendClientInviteEmail,
};
