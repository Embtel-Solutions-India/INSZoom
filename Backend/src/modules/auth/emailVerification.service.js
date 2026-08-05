const User = require("../../models/User");
const { generateOpaqueToken, hashToken } = require("./password.service");

async function createEmailVerificationToken(userId) {
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await User.findByIdAndUpdate(userId, {
    emailVerificationTokenHash: hashToken(token),
    emailVerificationExpiresAt: expiresAt,
  });
  return token;
}

async function verifyEmailToken(token) {
  const user = await User.findOne({
    emailVerificationTokenHash: hashToken(token),
    emailVerificationExpiresAt: { $gt: new Date() },
  }).select("+emailVerificationTokenHash");

  if (!user) return null;
  user.isEmailVerified = true;
  user.emailVerificationTokenHash = undefined;
  user.emailVerificationExpiresAt = undefined;
  await user.save();
  return user;
}

module.exports = { createEmailVerificationToken, verifyEmailToken };
