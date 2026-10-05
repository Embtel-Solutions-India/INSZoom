const env = require("../../../config/env");

// env.clientUrl is the Client portal's own origin (CLIENT_URL env var) —
// /accept-invite lives there (ported from Landing so Client is a fully
// self-contained portal, matching Admin/Attorney).
const FRONTEND_URL = env.clientUrl;

function subject(data = {}) {
  return `Your immigration case has been created${data.caseNumber ? ` — ${data.caseNumber}` : ""}`;
}

function bodyLines(data = {}) {
  const link = `${FRONTEND_URL}/accept-invite?token=${data.token}`;
  return [
    `Hi ${data.clientName || "there"},`,
    `Your immigration case has been created with our team.`,
    `<table role="presentation" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 20px;margin:0 0 16px;width:100%;">
      <tr><td>
        <p style="margin:0 0 6px;font-size:13px;color:#6b7280;font-weight:500;text-transform:uppercase;letter-spacing:0.5px;">Your Case ID</p>
        <p style="margin:0;font-size:22px;font-weight:800;color:#065f46;letter-spacing:1px;">${data.caseNumber || ""}</p>
      </td></tr>
    </table>`,
    `Please activate your account by setting your password using the button below. Once activated, you can track your case progress, upload documents, and message your case manager.`,
    `<a href="${link}" style="display:inline-block;padding:10px 20px;background:#1e3a5f;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold;">Set Your Password</a>`,
    `Or copy this link into your browser: ${link}`,
    `This link expires in 7 days. If it expires, you can request a new one from the login page.`,
  ];
}

module.exports = { key: "client-portal-invitation", subject, bodyLines };
