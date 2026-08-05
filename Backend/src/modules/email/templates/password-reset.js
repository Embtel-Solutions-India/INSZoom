// Sent when any account (client, employee, employer, staff) requests a
// password reset. One flow serves every role — the reset token is keyed on
// email + the stored hash/expiry, nothing role-specific.
const env = require("../../../config/env");

const FRONTEND_URL = process.env.BAIS_FRONTEND_URL || env.clientOrigins[0] || "http://localhost:5173";

function subject() {
  return "Reset your BAIS password";
}

function bodyLines(data = {}) {
  const link = `${FRONTEND_URL}/reset-password?token=${data.token}`;
  return [
    `Hi ${data.name || "there"},`,
    `We received a request to reset the password for your BAIS Immigration Portal account.`,
    `<a href="${link}" style="display:inline-block;padding:10px 20px;background:#0f766e;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold;">Reset Password</a>`,
    `Or copy this link into your browser: ${link}`,
    `This link expires in 1 hour.`,
    `If you didn't request this, you can safely ignore this email — your password will not be changed.`,
  ];
}

module.exports = { key: "password-reset", subject, bodyLines };
