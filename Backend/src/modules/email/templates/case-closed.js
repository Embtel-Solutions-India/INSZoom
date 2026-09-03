function subject(data = {}) { return `Your case has been closed — Case ${data.caseNumber || ""}`; }
function bodyLines(data = {}) {
  return [
    `Hi ${data.clientName || "there"},`,
    `Your immigration case ${data.caseNumber || ""} has been officially closed.`,
    data.closureReason ? `<strong>Reason:</strong> ${data.closureReason}` : null,
    `If you have any questions about this closure or would like to discuss next steps, please contact us through the portal.`,
    `<a href="${data.portalLink || "#"}" style="display:inline-block;padding:12px 24px;background:#0f766e;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">View Case Details</a>`,
    `Thank you for choosing BAIS for your immigration needs.`,
  ].filter(Boolean);
}
module.exports = { key: "case-closed", subject, bodyLines };
