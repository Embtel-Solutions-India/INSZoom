const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const env = require("../../config/env");

function generateAccessToken(user) {
  return jwt.sign(
    {
      userId: user._id.toString(),
      role: user.role,
      tokenVersion: user.tokenVersion || 0,
    },
    env.jwtAccessSecret,
    { expiresIn: env.jwtAccessExpires }
  );
}

function generateRefreshToken(user) {
  return jwt.sign(
    {
      userId: user._id.toString(),
      tokenVersion: user.tokenVersion || 0,
      // jwt.sign's auto-added `iat` only has 1-second resolution, and this
      // payload is otherwise identical on every call for the same user —
      // two refreshes within the same second (e.g. two open tabs refreshing
      // near-simultaneously) would sign the byte-identical token, colliding
      // on AuthSession's unique refreshTokenHash index. A random jti makes
      // every issued refresh token unique regardless of timing.
      jti: crypto.randomBytes(16).toString("hex"),
    },
    env.jwtRefreshSecret,
    { expiresIn: env.jwtRefreshExpires }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.jwtAccessSecret);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwtRefreshSecret);
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
