const { portalUrl } = require("../portalUrls");

// Sent to each attorney with access to a case when the case manager sends the petition for attorney review.
function subject(data = {}) {
  return `Petition ready for your review — ${data.caseNumber || "your case"}`;
}

function bodyLines(data = {}) {
  // the one thing to click is the login page; the case is one click after signing in
  const login = `${portalUrl("attorney")}/login`;
  const lines = [
    `Hello ${data.attorneyName || "there"},`,
    "The case manager has uploaded the petition for the case below and is asking for your review.",
    `<strong>Case:</strong> ${data.caseNumber || "—"}<br/><strong>Client:</strong> ${data.clientName || "—"}<br/><strong>Case type:</strong> ${data.visaType || "—"}<br/><strong>Petition:</strong> ${data.petitionName || "—"}`,
  ];
  if (data.note) lines.push(`<strong>Note from the case manager:</strong><br/>${String(data.note).replace(/</g, "&lt;").replace(/\n/g, "<br/>")}`);
  lines.push(
    "Sign in to the Attorney Portal, open the case and select the Petition tab to read the petition. Please share your comments or your approval with the case manager through the Messages / Feedback section of the case.",
    `<a href="${login}" style="display:inline-block;padding:12px 24px;background:#1e3a5f;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:700;">Sign In to Review the Petition</a>`,
    "Regards,<br>The Immiglance Team"
  );
  return lines;
}

module.exports = { key: "petition-attorney-review", subject, bodyLines };
