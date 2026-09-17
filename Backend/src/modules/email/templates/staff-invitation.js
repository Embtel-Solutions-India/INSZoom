// Settings → Users & Permissions → "Invite Firm Member" (§5.2.1). The
// invited staff member sets their password on the SAME accept-invite page
// the client-side employee-invite flow uses (Immiglance's /accept-invite) —
// once logged in, AuthGate's existing isStaff redirect sends them straight
// to Admin (the internal staff CRM, formerly "INSZoom") automatically, so
// no separate staff-specific accept page was needed.
const env = require("../../../config/env");

const FRONTEND_URL = process.env.IMMIGLANCE_FRONTEND_URL || env.clientOrigins[0] || "http://localhost:5173";

function subject() {
  return "You've been invited to join the firm's team";
}

function bodyLines(data = {}) {
  const link = `${FRONTEND_URL}/accept-invite?token=${data.token}`;
  return [
    `Hi ${data.name || "there"},`,
    `${data.invitedByName || "Your firm"} has invited you to join the team as a ${(data.role || "").replace(/_/g, " ")}.`,
    `<a href="${link}" style="display:inline-block;padding:10px 20px;background:#0f766e;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold;">Set Up Your Account</a>`,
    `Or copy this link into your browser: ${link}`,
    `This link expires in 7 days.`,
  ];
}

module.exports = { key: "staff-invitation", subject, bodyLines };
