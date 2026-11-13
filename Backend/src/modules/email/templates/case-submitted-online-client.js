// Sent to the client once, when the team moves their case card to "Submitted" with the answer "submitted online" AND chooses to inform the client. Same warm wording as the FedEx
// version ("case-submitted-client", which is unchanged); the FedEx section is replaced by the USCIS receipt number, shown only when the number is on file.
const { receiptLines, validReceipt, uscisStatusButton } = require("./receiptSection");

function subject(data = {}) {
  return `Congratulations - your case has been submitted online${data.caseNumber ? ` (${data.caseNumber})` : ""}`;
}

function bodyLines(data = {}) {
  return [
    `Hi ${data.clientName || "there"},`,
    data.beneficiaryName
      ? `Congratulations! The case for <strong>${data.beneficiaryName}</strong> has been submitted online. This is a big step, and it would not have been possible without the timely documents and information provided.`
      : "Congratulations! Your case has been submitted online. This is a big step, and it would not have been possible without your timely documents and information.",
    validReceipt(data)
      ? "Your case manager will tell you as soon as there is any update."
      : "USCIS will send a receipt notice once it has your filing. Your case manager will tell you as soon as there is any update.",
    ...receiptLines(data),
    // receipt number in the e-mail -> the button opens USCIS case status; without one it opens the client portal login page (every e-mail button is turned into the login page when sent)
    validReceipt(data)
      ? uscisStatusButton()
      : `<a href="${data.portalLink || "#"}" style="display:inline-block;padding:12px 24px;background:#1e3a5f;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold;">Log In to My Portal</a>`,
    "Regards,<br>The Immiglance Team",
  ];
}

module.exports = { key: "case-submitted-online-client", subject, bodyLines };
