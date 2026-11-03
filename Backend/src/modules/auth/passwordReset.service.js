const User = require("../../models/User");
const { generateOpaqueToken, hashToken } = require("./password.service");
const sessionService = require("./session.service");
const { invalidateUserCache } = require("../../config/redis");

// Returns { token, user } for an existing account, or null for an unknown
// email — the caller (forgotPassword) must send the SAME neutral response
// either way, only branching on this return value to decide whether to
// actually send an email.
async function createPasswordResetToken(email) {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) return null;

  const token = generateOpaqueToken();
  user.passwordResetTokenHash = hashToken(token);
  user.passwordResetExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await user.save();
  return { token, user };
}

async function resetPassword(token, newPassword) {
  const user = await User.findOne({
    passwordResetTokenHash: hashToken(token),
    passwordResetExpiresAt: { $gt: new Date() },
  }).select("+password +passwordResetTokenHash +inviteTokenHash");

  if (!user) return null;
  user.password = newPassword;
  // A client created by staff is inactive until they finish the invitation. Setting a password through "Forgot password" proves they own the
  // mailbox just as the invitation link does, so it activates them too (same end state as clientInvite.acceptClientInvite) - otherwise they
  // hold a correct password and still cannot log in. Only for a never-activated client: an account an admin deactivated has no pending
  // invitation and stays deactivated.
  if (user.role === "client" && user.isActive === false && user.mustSetPassword === true && user.inviteTokenHash) {
    user.isActive = true;
    user.isEmailVerified = true;
    user.mustSetPassword = false;
    user.inviteTokenHash = undefined;
    user.inviteTokenExpiresAt = undefined;
  }
  user.passwordResetTokenHash = undefined;
  user.passwordResetExpiresAt = undefined;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await invalidateUserCache(user._id);
  await sessionService.revokeAllSessions(user._id);
  return user;
}

module.exports = { createPasswordResetToken, resetPassword };
