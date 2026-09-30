// Invitation sent to an employee when an employer creates their account and
// assigns them to complete their own portion of an employer-sponsored case
// (e.g. L-1A, H-1B). The employee sets their own password via the link —
// the employer never sees or chooses it.
const env = require("../../../config/env");

// env.clientUrl is the Client portal's own origin (CLIENT_URL env var) —
// /accept-invite lives there (ported from Landing so Client is a fully
// self-contained portal, matching Admin/Attorney).
const FRONTEND_URL = env.clientUrl;

function subject() {
  return "You've been invited to complete your immigration case";
}

function bodyLines(data = {}) {
  const link = `${FRONTEND_URL}/accept-invite?token=${data.token}`;
  return [
    `Hi ${data.employeeName || "there"},`,
    `${data.employerName || "Your employer"} has invited you to complete your portion of immigration case ${data.caseNumber || ""}.`,
    `<strong>Your Case ID:</strong> ${data.caseNumber || ""}`,
    `<strong>Portal:</strong> ${FRONTEND_URL}`,
    `Click below to set your own password and access your dedicated case portal — you'll only see your own information, never anyone else's:`,
    `<a href="${link}" style="display:inline-block;padding:10px 20px;background:#1e3a5f;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold;">Set Your Password &amp; Access Your Case</a>`,
    `Or copy this link into your browser: ${link}`,
    `This link expires in 7 days.`,
  ];
}

module.exports = { key: "employee-case-invitation", subject, bodyLines };
