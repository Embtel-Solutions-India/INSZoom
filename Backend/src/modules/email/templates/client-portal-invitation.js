const env = require("../../../config/env");

// env.clientUrl is the Client portal's own origin (CLIENT_URL env var) —
// /accept-invite lives there (ported from Landing so Client is a fully
// self-contained portal, matching Admin/Attorney).
const FRONTEND_URL = env.clientUrl;

function subject() {
  return "Your immigration case is ready — activate your Immiglance portal account";
}

function bodyLines(data = {}) {
  const link = `${FRONTEND_URL}/accept-invite?token=${data.token}`;
  return [
    `Hi ${data.clientName || "there"},`,
    `Your immigration case${data.caseNumber ? ` (${data.caseNumber})` : ""} has been opened by our team. ` +
      `Please activate your Immiglance client portal account to track your case progress, ` +
      `upload documents, and communicate with your case manager.`,
    `<a href="${link}" style="display:inline-block;padding:10px 20px;background:#0f766e;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold;">Activate Your Account</a>`,
    `Or copy this link into your browser: ${link}`,
    `This link expires in 7 days. If it expires, you can request a new one from the login page.`,
  ];
}

module.exports = { key: "client-portal-invitation", subject, bodyLines };
