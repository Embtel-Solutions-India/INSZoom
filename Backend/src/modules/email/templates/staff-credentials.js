// Sent when an admin adds an internal team member or an attorney from the
// Admin portal (Settings -> Users -> Add Firm Member). The admin sets the
// role and password; this email delivers the right portal link for that
// role plus the login email and the password that was set - there is no
// "activate your account" step.
const PORTAL_BY_ROLE = {
  attorney: { label: "Attorney Portal", envKey: "ATTORNEY_PORTAL_URL", fallback: "http://localhost:5174" },
  default: { label: "Admin Portal", envKey: "ADMIN_PORTAL_URL", fallback: "http://localhost:3002" },
};

function portalFor(role) {
  const portal = PORTAL_BY_ROLE[role] || PORTAL_BY_ROLE.default;
  const base = String(process.env[portal.envKey] || portal.fallback).replace(/\/+$/, "");
  return { label: portal.label, url: `${base}/login` };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function subject(data = {}) {
  return `Your Immiglance ${portalFor(data.role).label} account is ready`;
}

function bodyLines(data = {}) {
  const portal = portalFor(data.role);
  const roleLabel = String(data.role || "team member").replace(/_/g, " ");
  return [
    `Hi ${escapeHtml(data.name || "there")},`,
    `${escapeHtml(data.invitedByName || "Your firm")} has added you to Immiglance as ${/^[aeiou]/i.test(roleLabel) ? "an" : "a"} <strong>${escapeHtml(roleLabel)}</strong>. Your account is ready - sign in to the ${portal.label} with the details below.`,
    `<a href="${portal.url}" style="display:inline-block;padding:10px 20px;background:#1e3a5f;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold;">Open ${portal.label}</a>`,
    `Portal link: <a href="${portal.url}">${portal.url}</a>`,
    `Login email: <strong>${escapeHtml(data.email)}</strong><br/>Password: <strong style="font-family:monospace;">${escapeHtml(data.password)}</strong>`,
    `Please keep these login details private and do not share them.`,
  ];
}

module.exports = { key: "staff-credentials", subject, bodyLines, portalFor };
