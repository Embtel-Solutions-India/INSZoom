// Sent to the client when our team adds the USCIS receipt number AFTER the "case submitted online" e-mail already went out (the number was not known yet).
// If the number was on file when that e-mail was sent, it was part of it and this one is not sent.
const { receiptLines } = require("./receiptSection");

function subject(data = {}) {
  return `Your USCIS receipt number${data.caseNumber ? ` (${data.caseNumber})` : ""}`;
}

function bodyLines(data = {}) {
  return [
    `Hi ${data.clientName || "there"},`,
    ...receiptLines(data),
    `<a href="${data.portalLink || "#"}" style="display:inline-block;padding:12px 24px;background:#1e3a5f;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold;">Track My Case</a>`,
    "Regards,<br>The Immiglance Team",
  ];
}

module.exports = { key: "case-uscis-receipt-number-client", subject, bodyLines };
