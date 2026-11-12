// Sent to the client when our team adds the USCIS receipt number AFTER the "case submitted online" e-mail already went out (the number was not known yet).
// If the number was on file when that e-mail was sent, it was part of it and this one is not sent.
const { receiptLines, uscisStatusButton } = require("./receiptSection");

function subject(data = {}) {
  return `Your USCIS receipt number${data.caseNumber ? ` (${data.caseNumber})` : ""}`;
}

function bodyLines(data = {}) {
  return [
    `Hi ${data.clientName || "there"},`,
    ...receiptLines(data),
    uscisStatusButton(),
    "Regards,<br>The Immiglance Team",
  ];
}

module.exports = { key: "case-uscis-receipt-number-client", subject, bodyLines };
