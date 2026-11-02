// Sent to the client once, the moment their case card reaches the "Submitted" stage on the Pipeline (moved by the team, through Update Stage, or in GoHighLevel).
// Warm and short: congratulations, where the case stands, what comes next, one button.
function subject(data = {}) {
  return `Congratulations - your case has been submitted${data.caseNumber ? ` (${data.caseNumber})` : ""}`;
}

function bodyLines(data = {}) {
  return [
    `Hi ${data.clientName || "there"},`,
    "Congratulations! Your case has been submitted. This is a big step, and it would not have been possible without your timely documents and information.",
    "USCIS will send a receipt notice once it has your filing. Processing times vary, and your case manager will tell you as soon as there is any update.",
    `<a href="${data.portalLink || "#"}" style="display:inline-block;padding:12px 24px;background:#1e3a5f;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold;">Track My Case</a>`,
    "Regards,<br>The Immiglance Team",
  ];
}

module.exports = { key: "case-submitted-client", subject, bodyLines };
