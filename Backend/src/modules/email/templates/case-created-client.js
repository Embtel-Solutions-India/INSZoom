const env = require("../../../config/env");

// Sent when a case is created for a client who ALREADY has a working portal
// account (a client who still has to set a password gets the combined
// client-portal-invitation email instead - never two emails for one event).
function subject(data = {}) {
  return `Your immigration case has been created${data.caseNumber ? ` — ${data.caseNumber}` : ""}`;
}

function bodyLines(data = {}) {
  // Never a link straight into the dashboard: the first page is always the login page.
  const portal = data.loginLink || `${String(env.clientUrl || "").replace(/\/+$/, "")}/login`;
  return [
    `Hi ${data.clientName || "there"},`,
    `We're writing to confirm that your immigration case has been successfully created with our team.`,
    `<table role="presentation" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 20px;margin:0 0 16px;width:100%;">
      <tr><td>
        <p style="margin:0 0 6px;font-size:13px;color:#6b7280;font-weight:500;text-transform:uppercase;letter-spacing:0.5px;">Your Case ID</p>
        <p style="margin:0${data.visaType ? " 0 14px" : ""};font-size:22px;font-weight:800;color:#065f46;letter-spacing:1px;">${data.caseNumber || ""}</p>
        ${data.visaType ? `<p style="margin:0 0 6px;font-size:13px;color:#6b7280;font-weight:500;text-transform:uppercase;letter-spacing:0.5px;">Case type</p><p style="margin:0;font-size:16px;font-weight:700;color:#065f46;">${data.visaType}</p>` : ""}
      </td></tr>
    </table>`,
    `Please keep your Case ID safe — you will use it to log in to the Immiglance portal and to reference your case in any communication with our team.`,
    `Your case is now in the portal. Log in to track your case progress, upload documents, complete your questionnaires, and message your case manager directly.`,
    portal ? `<a href="${portal}" style="display:inline-block;padding:10px 20px;background:#1e3a5f;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold;">Log In to My Portal</a>` : null,
    portal ? `Or copy this link into your browser: ${portal}` : null,
    `If you have any questions, reply to your case manager directly or reach us through the Messages section of your portal.`,
  ].filter(Boolean);
}

module.exports = { key: "case-created-client", subject, bodyLines };
