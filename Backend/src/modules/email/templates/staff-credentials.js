// Sent when an admin adds an internal team member or an attorney from the
// Admin portal (Settings -> Users -> Add Firm Member). The admin sets the
// role and password; this email delivers the right portal link for that
// role plus the login email and the password that was set - there is no
// "activate your account" step.
const PORTAL_BY_ROLE = {
  attorney: { label: "Attorney Portal", portal: "attorney" },
  default: { label: "Admin Portal", portal: "admin" },
};

function portalFor(role) {
  const portal = PORTAL_BY_ROLE[role] || PORTAL_BY_ROLE.default;
  return { label: portal.label, url: `${require("../portalUrls").portalUrl(portal.portal)}/login` };
}

const layout = require("../emailLayoutV2");

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function subject(data = {}) {
  return `Your Immiglance ${portalFor(data.role).label} account is ready`;
}

function roleText(data = {}) {
  const roleLabel = String(data.role || "team member").replace(/_/g, " ");
  return { article: /^[aeiou]/i.test(roleLabel) ? "an" : "a", roleLabel };
}

// Plain-text version (and the fallback for mail apps that do not show HTML).
function bodyLines(data = {}) {
  const portal = portalFor(data.role);
  const { article, roleLabel } = roleText(data);
  return [
    `Hi ${escapeHtml(data.name || "there")},`,
    `Congratulations! ${escapeHtml(data.invitedByName || "Your firm")} has added you to the Immiglance ${portal.label} as ${article} <strong>${escapeHtml(roleLabel)}</strong>. Here are your login credentials.`,
    `Login email: <strong>${escapeHtml(data.email)}</strong><br/>Password: <strong style="font-family:monospace;">${escapeHtml(data.password)}</strong>`,
    `Your portal account is ready. Sign in using the button below.`,
    `<a href="${portal.url}" style="display:inline-block;padding:10px 20px;background:#1e3a5f;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold;">Open ${portal.label}</a>`,
    `If the button does not work, copy and paste this link into your browser: <a href="${portal.url}">${portal.url}</a>`,
    `Please keep these login details private and do not share them.`,
  ];
}

// A light grey box holding one login detail: a small grey label above the value.
function credentialBox(label, value, { mono = false } = {}) {
  const valueFont = mono ? "Consolas,'Courier New',monospace" : layout.FONT;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;border-collapse:separate;">`
    + `<tr><td style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;">`
    + `<div style="font-family:${layout.FONT};font-size:12px;color:#6b7280;letter-spacing:0.3px;margin:0 0 4px;">${label}</div>`
    + `<div style="font-family:${valueFont};font-size:15px;font-weight:600;color:#111827;word-break:break-all;">${value}</div>`
    + `</td></tr></table>`;
}

// HTML version: congratulations, the login email and password each in a grey box, then the button and the plain link as a fallback.
function bodyHtml(data = {}) {
  const portal = portalFor(data.role);
  const { article, roleLabel } = roleText(data);
  return [
    layout.paragraph(`Hi ${escapeHtml(data.name || "there")},`),
    layout.paragraph(`<strong>Congratulations!</strong> ${escapeHtml(data.invitedByName || "Your firm")} has added you to the Immiglance ${portal.label} as ${article} <strong>${escapeHtml(roleLabel)}</strong>. Here are your login credentials:`),
    credentialBox("Login email", escapeHtml(data.email)),
    credentialBox("Password", escapeHtml(data.password), { mono: true }),
    `<div style="height:8px;line-height:8px;">&nbsp;</div>`,
    layout.paragraph("Your portal account is ready. Sign in using the button below."),
    layout.button(`Open ${portal.label}`, portal.url),
    layout.paragraph(`<span style="font-size:13px;color:#6b7280;">If the button does not work, copy and paste this link into your browser:<br><a href="${portal.url}" style="color:${layout.BRAND};word-break:break-all;">${portal.url}</a></span>`),
    layout.paragraph(`<span style="font-size:13px;color:#6b7280;">Please keep these login details private and do not share them.</span>`),
  ].join("");
}

module.exports = { key: "staff-credentials", subject, bodyLines, bodyHtml, portalFor };
