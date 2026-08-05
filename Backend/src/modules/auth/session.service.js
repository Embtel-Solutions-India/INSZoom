const AuthSession = require("../../models/AuthSession");
const { hashToken } = require("./password.service");
const env = require("../../config/env");

function getSessionExpiry() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + env.refreshTokenTtlDays);
  return expiresAt;
}

async function createSession(user, refreshToken, req) {
  return AuthSession.create({
    user: user._id,
    refreshTokenHash: hashToken(refreshToken),
    userAgent: req.get("user-agent"),
    ipAddress: req.ip,
    expiresAt: getSessionExpiry(),
  });
}

async function findActiveSession(refreshToken) {
  const tokenHash = hashToken(refreshToken);
  return AuthSession.findOne({
    refreshTokenHash: tokenHash,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  }).select("+refreshTokenHash");
}

async function rotateSession(session, newRefreshToken, req) {
  const replacement = await AuthSession.create({
    user: session.user,
    refreshTokenHash: hashToken(newRefreshToken),
    userAgent: req.get("user-agent"),
    ipAddress: req.ip,
    expiresAt: getSessionExpiry(),
  });

  session.revokedAt = new Date();
  session.replacedBy = replacement._id;
  await session.save();
  return replacement;
}

async function revokeSession(refreshToken) {
  const session = await findActiveSession(refreshToken);
  if (!session) return false;
  session.revokedAt = new Date();
  await session.save();
  return true;
}

async function revokeAllSessions(userId) {
  await AuthSession.updateMany({ user: userId, revokedAt: null }, { revokedAt: new Date() });
}

module.exports = {
  createSession,
  findActiveSession,
  rotateSession,
  revokeSession,
  revokeAllSessions,
};
