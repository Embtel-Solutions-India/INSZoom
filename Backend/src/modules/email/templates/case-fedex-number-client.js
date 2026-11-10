// Sent to the client when our team adds the FedEx tracking number AFTER the "case submitted" e-mail already went out (the number was not known yet).
// If the number was on file when the submitted e-mail was sent, it was part of that e-mail and this one is not sent.
const { fedexLines } = require("./fedexSection");

function subject(data = {}) {
  return `Your FedEx tracking number${data.caseNumber ? ` (${data.caseNumber})` : ""}`;
}

function bodyLines(data = {}) {
  return [
    `Hi ${data.clientName || "there"},`,
    ...fedexLines(data),
    "Regards,<br>The Immiglance Team",
  ];
}

module.exports = { key: "case-fedex-number-client", subject, bodyLines };
