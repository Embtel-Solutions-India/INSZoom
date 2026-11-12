// Sent to the client once, the moment their case card reaches the "Submitted" stage on the Pipeline (moved by the team, through Update Stage, or in GoHighLevel).
// Warm and short: congratulations, where the case stands, what comes next, one button.
function subject(data = {}) {
  return `Congratulations - your case has been submitted${data.caseNumber ? ` (${data.caseNumber})` : ""}`;
}

const { fedexLines } = require("./fedexSection");

// When the FedEx tracking number is already on file (data.trackingNumber) the e-mail carries it; without one the FedEx part is left out entirely and the
// number follows in its own e-mail once the team adds it.
function bodyLines(data = {}) {
  return [
    `Hi ${data.clientName || "there"},`,
    data.beneficiaryName
      ? `Congratulations! The case for <strong>${data.beneficiaryName}</strong> has been submitted. This is a big step, and it would not have been possible without the timely documents and information provided.`
      : "Congratulations! Your case has been submitted. This is a big step, and it would not have been possible without your timely documents and information.",
    "USCIS will send a receipt notice once it has your filing. Processing times vary, and your case manager will tell you as soon as there is any update.",
    ...fedexLines(data),
    `<a href="${data.portalLink || "#"}" style="display:inline-block;padding:12px 24px;background:#1e3a5f;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold;">Track My Case</a>`,
    "Regards,<br>The Immiglance Team",
  ];
}

module.exports = { key: "case-submitted-client", subject, bodyLines };
