function subject(data = {}) { return `Your case has been upgraded to Premium Processing — Case ${data.caseNumber || ""}`; }
function bodyLines(data = {}) {
  return [
    `Hi ${data.clientName || "there"},`,
    `Your case ${data.caseNumber || ""} has been upgraded to <strong>Premium Processing</strong>.`,
    `Premium Processing asks USCIS to take action on your petition within a faster, guaranteed timeframe. To prepare Form I-907, please complete the "Form I-907 Premium Processing" information in your case checklist.`,
    `<a href="${data.portalLink || "#"}" style="display:inline-block;padding:12px 24px;background:#1e3a5f;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">Complete My Checklist</a>`,
    `If you have any questions, please contact your case manager through the portal.`,
  ];
}
module.exports = { key: "premium-processing-upgraded", subject, bodyLines };
