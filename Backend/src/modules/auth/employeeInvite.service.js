const User = require("../../models/User");
const Case = require("../../models/Case");
const { generateOpaqueToken, hashToken } = require("./password.service");
const { invalidateUserCache } = require("../../config/redis");
const emailService = require("../email/email.service");

const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

async function createInviteToken(user) {
  const token = generateOpaqueToken();
  user.inviteTokenHash = hashToken(token);
  user.inviteTokenExpiresAt = new Date(Date.now() + INVITE_EXPIRY_MS);
  await user.save();
  return token;
}

async function getInviteDetails(token) {
  const user = await User.findOne({
    inviteTokenHash: hashToken(token),
    inviteTokenExpiresAt: { $gt: new Date() },
  }).select("+inviteTokenHash");
  if (!user) return null;
  return { name: user.name || user.displayName || "", email: user.email };
}

async function acceptInvite(token, newPassword) {
  const user = await User.findOne({
    inviteTokenHash: hashToken(token),
    inviteTokenExpiresAt: { $gt: new Date() },
  }).select("+inviteTokenHash");
  if (!user) return null;

  user.password = newPassword;
  user.inviteTokenHash = undefined;
  user.inviteTokenExpiresAt = undefined;
  user.isActive = true;
  user.isEmailVerified = true;
  await user.save();
  await invalidateUserCache(user._id);

  const now = new Date();
  await Case.updateMany(
    { employeeUser: user._id, "employeeInvite.status": "sent" },
    { $set: { "employeeInvite.status": "accepted", "employeeInvite.acceptedAt": now } }
  );

  return user;
}

// True only for a real invited-but-not-yet-activated employee account: role
// "employee" and no password ever set (the invite flow never sets one — see
// sendEmployeeInvite in employment-workflow.controller.js). An expired
// invite token still counts (that's exactly the case a resend recovers),
// deliberately not gated on inviteTokenExpiresAt.
function isPendingInvite(user) {
  return Boolean(user) && user.role === "employee" && !user.password;
}

// Public, email-only resend path for a passwordless invited employee who
// wandered to login/signup instead of using their (possibly expired) invite
// link — see auth.controller.js's resendInvite. Deliberately silent (no
// throw, no distinguishing return value) for any email that isn't a pending
// invite, so it never reveals account existence/state to the caller.
async function resendInviteEmail(email) {
  if (!email) return { sent: false };
  const user = await User.findOne({ email: String(email).toLowerCase(), role: "employee" }).select("+password");
  if (!isPendingInvite(user)) return { sent: false };

  const caseData = await Case.findOne({ employeeUser: user._id }).sort({ createdAt: -1 });
  const token = await createInviteToken(user);
  let employerName;
  if (caseData?.employerUser) {
    const employer = await User.findById(caseData.employerUser).select("name displayName");
    employerName = employer?.name || employer?.displayName;
  }
  await emailService.sendTemplateEmail("employee-case-invitation", {
    to: user.email,
    data: { employeeName: user.name || user.displayName, employerName, caseNumber: caseData?.caseNumber, token },
    caseId: caseData?._id,
    userId: user._id,
    source: "shared",
  });
  if (caseData) {
    caseData.employeeInvite = { ...(caseData.employeeInvite || {}), status: "sent", invitedAt: new Date() };
    await caseData.save();
  }
  return { sent: true };
}

module.exports = { createInviteToken, getInviteDetails, acceptInvite, isPendingInvite, resendInviteEmail };
