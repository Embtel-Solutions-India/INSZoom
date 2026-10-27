const { portalUrl } = require("../portalUrls");

// Sent to the client-side audience of a case (the single applicant, the petitioner, or the employer - never the beneficiary or the employee) when the case manager
// sends the petition for client review.
function subject(data = {}) {
  return `Your petition is ready for your review — ${data.caseNumber || "your case"}`;
}

function bodyLines(data = {}) {
  const link = data.petitionLink || `${portalUrl("client")}/dashboard/petition`;
  const lines = [
    `Hi ${data.clientName || "there"},`,
    `Your case manager has prepared the petition for case ${data.caseNumber || "your case"} and is asking for your review.`,
    `<strong>Petition:</strong> ${data.petitionName || "—"}`,
  ];
  if (data.note) lines.push(`<strong>Note from your case manager:</strong><br/>${String(data.note).replace(/</g, "&lt;").replace(/\n/g, "<br/>")}`);
  lines.push(
    "Please sign in to your Immiglance portal and open the Petition page. You can read the petition there and send your feedback in the panel beside it, including any changes you would like. Your case manager is notified as soon as you reply.",
    `<a href="${link}" style="display:inline-block;padding:12px 24px;background:#1e3a5f;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">Review Your Petition</a>`,
    "Regards,<br>The Immiglance Team"
  );
  return lines;
}

module.exports = { key: "petition-client-review", subject, bodyLines };
