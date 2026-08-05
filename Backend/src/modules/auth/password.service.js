const crypto = require("crypto");

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateOpaqueToken() {
  return crypto.randomBytes(32).toString("hex");
}

module.exports = { hashToken, generateOpaqueToken };
