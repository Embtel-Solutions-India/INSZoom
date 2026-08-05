const crypto = require("node:crypto");
const env = require("../../config/env");

// Self-contained, stateless booking token: no-account prospects use this to
// view/reschedule/cancel a consultation without ever logging in. Signed
// with the app's existing JWT secret (no new secret to provision) but is
// NOT a JWT — it carries only the appointment id + expiry, never internal
// identity (host user, role, etc.), and expires shortly after the
// appointment itself so it can't be replayed indefinitely.
const SECRET = env.jwtAccessSecret;

function sign(appointmentId, expiresAtMs) {
  return crypto.createHmac("sha256", SECRET).update(`${appointmentId}:${expiresAtMs}`).digest("hex");
}

function issue(appointmentId, { validForMs = 1000 * 60 * 60 * 24 * 60 } = {}) { // default 60 days
  const expiresAtMs = Date.now() + validForMs;
  const signature = sign(appointmentId, expiresAtMs);
  const payload = Buffer.from(`${appointmentId}.${expiresAtMs}`).toString("base64url");
  return `${payload}.${signature}`;
}

function verify(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [payload, signature] = token.split(".", 2);
  if (!payload || !signature) return null;
  let appointmentId, expiresAtMs;
  try {
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    [appointmentId, expiresAtMs] = decoded.split(".");
    expiresAtMs = Number(expiresAtMs);
  } catch {
    return null;
  }
  if (!appointmentId || !Number.isFinite(expiresAtMs)) return null;

  const expected = sign(appointmentId, expiresAtMs);
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) return null;
  if (Date.now() > expiresAtMs) return null;

  return { appointmentId, expiresAtMs };
}

module.exports = { issue, verify };
