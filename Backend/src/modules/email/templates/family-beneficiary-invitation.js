// Invitation sent to a beneficiary (foreign fiancé(e)/spouse) when a U.S.
// citizen petitioner creates a family-visa (K-1/K-3) case and invites them
// to complete their own portion of it. Mirrors employee-case-invitation.js's
// shape exactly, but is its OWN template with its own family-appropriate
// wording — never reused/repurposed from the employee template. Placeholder
// copy for now; real fiancé(e)/spouse wording is a follow-up.
const env = require("../../../config/env");

const FRONTEND_URL = process.env.BAIS_FRONTEND_URL || env.clientOrigins[0] || "http://localhost:5173";

function subject() {
  return "You've been invited to complete your immigration case";
}

function bodyLines(data = {}) {
  const link = `${FRONTEND_URL}/accept-invite?token=${data.token}`;
  return [
    `Hi ${data.beneficiaryName || "there"},`,
    `${data.petitionerName || "Your petitioner"} has invited you to complete your portion of immigration case ${data.caseNumber || ""}.`,
    `<a href="${link}" style="display:inline-block;padding:10px 20px;background:#0f766e;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold;">Create Your Account</a>`,
    `Or copy this link into your browser: ${link}`,
    `This link expires in 7 days.`,
  ];
}

module.exports = { key: "family-beneficiary-invitation", subject, bodyLines };
