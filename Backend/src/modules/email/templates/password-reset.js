// Sent when any account (client, employee, employer, staff) requests a
// password reset. One flow serves every role — the reset token is keyed on
// email + the stored hash/expiry, nothing role-specific.
const env = require("../../../config/env");

// env.clientUrl is the Client portal's own origin (CLIENT_URL env var) —
// /reset-password lives there (ported from Landing so Client is a fully
// self-contained portal, matching Admin/Attorney). Every role shares this
// one flow; a staff account resetting their password still ends up here,
// then AuthGate's existing isStaff redirect sends them on to Admin once
// logged in.
const FRONTEND_URL = env.clientUrl;

function subject() {
  return "Reset your Immiglance password";
}

function bodyLines(data = {}) {
  const link = `${FRONTEND_URL}/reset-password?token=${data.token}`;
  return [
    `Hi ${data.name || "there"},`,
    `We received a request to reset the password for your Immiglance Immigration Portal account.`,
    `<a href="${link}" style="display:inline-block;padding:10px 20px;background:#0f766e;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold;">Reset Password</a>`,
    `Or copy this link into your browser: ${link}`,
    `This link expires in 1 hour.`,
    `If you didn't request this, you can safely ignore this email — your password will not be changed.`,
  ];
}

module.exports = { key: "password-reset", subject, bodyLines };
