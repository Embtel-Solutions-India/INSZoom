function subject(data = {}) { return `Your case has been placed on hold — Case ${data.caseNumber || ""}`; }
function bodyLines(data = {}) {
  return [
    `Hi ${data.clientName || "there"},`,
    `Your immigration case ${data.caseNumber || ""} has been temporarily placed on hold.`,
    data.holdReason ? `<strong>Reason:</strong> ${data.holdReason}` : null,
    `Your case manager will contact you with more information. No action is required from you at this time unless your case manager specifically requests it.`,
    `<a href="${data.portalLink || "#"}" style="display:inline-block;padding:12px 24px;background:#0f766e;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">View My Case</a>`,
  ].filter(Boolean);
}
module.exports = { key: "case-on-hold", subject, bodyLines };
