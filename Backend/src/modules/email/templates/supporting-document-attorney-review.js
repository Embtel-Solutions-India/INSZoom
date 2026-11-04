const { portalUrl } = require("../portalUrls");

// Sent to each attorney with access to a case when the case manager sends a supporting document (a letter, a report ...) from the Petition tab's
// "Supporting Documents" section for attorney review. Separate from the petition e-mail.
const escape = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function subject(data = {}) {
  return `New supporting document for your review — ${data.caseNumber || "your case"}`;
}

function bodyLines(data = {}) {
  // the one thing to click is the login page; the case is one click after signing in
  const login = `${portalUrl("attorney")}/login`;
  const lines = [
    `Hello ${escape(data.attorneyName || "there")},`,
    `A new supporting document, <strong>${escape(data.petitionName || "a document")}</strong>, has been shared with you for review.`,
    `<strong>Case:</strong> ${escape(data.caseNumber || "—")}<br/><strong>Client:</strong> ${escape(data.clientName || "—")}<br/><strong>Case type:</strong> ${escape(data.visaType || "—")}`,
  ];
  if (data.note) lines.push(`<strong>Note from the case manager:</strong><br/>${escape(data.note).replace(/\n/g, "<br/>")}`);
  lines.push(
    "Please sign in to the Attorney Portal, open the case and select the <strong>Petition</strong> tab. You will find the document in the Supporting Documents section. Please share your comments or your approval with the case manager through the Messages / Feedback section of the case.",
    `<a href="${login}" style="display:inline-block;padding:12px 24px;background:#1e3a5f;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:700;">Sign In to Review the Document</a>`,
    "Regards,<br>The Immiglance Team"
  );
  return lines;
}

module.exports = { key: "supporting-document-attorney-review", subject, bodyLines };
