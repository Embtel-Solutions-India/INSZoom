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
  }).select("+password +passwordResetTokenHash");

  if (!user) return null;
  user.password = newPassword;
  user.passwordResetTokenHash = undefined;
  user.passwordResetExpiresAt = undefined;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await invalidateUserCache(user._id);
  await sessionService.revokeAllSessions(user._id);
  return user;
}

module.exports = { createPasswordResetToken, resetPassword };
