const env = require("../../../config/env");

const FRONTEND_URL =
  process.env.BAIS_FRONTEND_URL || env.clientOrigins[0] || "http://localhost:5173";

function subject(data = {}) {
  return `You've been invited to a family immigration case${data.caseNumber ? ` — ${data.caseNumber}` : ""}`;
}

function bodyLines(data = {}) {
  const link = `${FRONTEND_URL}/accept-invite?token=${data.token}`;
  return [
    `Hi ${data.beneficiaryName || "there"},`,
    `<strong>${data.petitionerName || "Your petitioner"}</strong> has included you in a family immigration case and has invited you to complete your personal information on the BAIS portal.`,
    `<table role="presentation" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 20px;margin:0 0 16px;width:100%;">
      <tr><td>
        <p style="margin:0 0 4px;font-size:13px;color:#6b7280;font-weight:500;text-transform:uppercase;letter-spacing:0.5px;">Your Case ID</p>
        <p style="margin:0;font-size:22px;font-weight:800;color:#065f46;letter-spacing:1px;">${data.caseNumber || ""}</p>
      </td></tr>
    </table>`,
    `<a href="${link}" style="display:inline-block;padding:10px 20px;background:#0f766e;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold;">Create My Account</a>`,
    `Or copy this link into your browser: ${link}`,
    `<strong>This link expires in 7 days.</strong>`,
    `<em style="color:#9ca3af;font-size:13px;">If you did not expect this email, please contact ${data.petitionerName || "your petitioner"} or ignore it.</em>`,
  ];
}

module.exports = { key: "family-beneficiary-invitation", subject, bodyLines };
