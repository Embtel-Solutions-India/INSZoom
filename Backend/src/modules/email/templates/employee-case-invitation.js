// Invitation sent to an employee when an employer creates their account and
// assigns them to complete their own portion of an employer-sponsored case
// (e.g. L-1A, H-1B). The employee sets their own password via the link —
// the employer never sees or chooses it.
const env = require("../../../config/env");

const FRONTEND_URL = process.env.BAIS_FRONTEND_URL || env.clientOrigins[0] || "http://localhost:5173";

function subject() {
  return "You've been invited to complete your immigration case";
}

function bodyLines(data = {}) {
  const link = `${FRONTEND_URL}/accept-invite?token=${data.token}`;
  return [
    `Hi ${data.employeeName || "there"},`,
    `${data.employerName || "Your employer"} has invited you to complete your portion of immigration case ${data.caseNumber || ""}.`,
    `<a href="${link}" style="display:inline-block;padding:10px 20px;background:#0f766e;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold;">Create Your Account</a>`,
    `Or copy this link into your browser: ${link}`,
    `This link expires in 7 days.`,
  ];
}

module.exports = { key: "employee-case-invitation", subject, bodyLines };
