const { portalUrl } = require("../portalUrls");

// Sent to the client-side audience of a case (the single applicant, the petitioner, or the employer - never the beneficiary or the employee) when the case manager
// sends a supporting document (a letter, a report ...) from the Petition tab's "Supporting Documents" section for client review. Separate from the petition e-mail.
const escape = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function subject(data = {}) {
  return `New supporting document for your review — ${data.caseNumber || "your case"}`;
}

function bodyLines(data = {}) {
  // the one thing to click is the login page; the Petition page is one click after signing in
  const login = `${portalUrl("client")}/login`;
  const lines = [
    `Hi ${escape(data.clientName || "there")},`,
    `A new supporting document, <strong>${escape(data.petitionName || "a document")}</strong>, has been shared with you for review on case ${escape(data.caseNumber || "your case")}.`,
  ];
  if (data.note) lines.push(`<strong>Note from your case manager:</strong><br/>${escape(data.note).replace(/\n/g, "<br/>")}`);
  lines.push(
    "Please sign in to your Immiglance portal and open the <strong>Petition</strong> page. You will find the document in the Supporting Documents section, where you can read it, download a copy and send your feedback to your case manager.",
    `<a href="${login}" style="display:inline-block;padding:12px 24px;background:#1e3a5f;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:700;">Sign In to Review the Document</a>`,
    "Regards,<br>The Immiglance Team"
  );
  return lines;
}

module.exports = { key: "supporting-document-client-review", subject, bodyLines };
