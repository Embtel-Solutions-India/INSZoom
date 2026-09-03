function subject(data = {}) { return `Congratulations — your case has been approved! — Case ${data.caseNumber || ""}`; }
function bodyLines(data = {}) {
  return [
    `Hi ${data.clientName || "there"},`,
    `We are thrilled to share that your immigration case has been <strong>approved</strong> by USCIS.`,
    `Your case manager will reach out to discuss the next steps in the process. Please log in to the portal to view the full details.`,
    `<a href="${data.portalLink || "#"}" style="display:inline-block;padding:12px 24px;background:#0f766e;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">View Approval Details</a>`,
    `Thank you for trusting BAIS with your immigration journey.`,
  ];
}
module.exports = { key: "case-approved", subject, bodyLines };
