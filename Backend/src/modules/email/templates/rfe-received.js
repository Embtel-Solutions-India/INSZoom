function subject(data = {}) { return `URGENT: USCIS has requested additional evidence — Case ${data.caseNumber || ""}`; }
function bodyLines(data = {}) {
  return [
    `Hi ${data.clientName || "there"},`,
    `USCIS has issued a <strong>Request for Evidence (RFE)</strong> for your immigration case. This requires your attention and a response within the deadline.`,
    data.rfeDeadline ? `<p style="color:#dc2626;font-weight:700;font-size:16px;margin:0 0 16px;">Response deadline: ${data.rfeDeadline}</p>` : null,
    `Your case manager is reviewing the RFE and will contact you with specific next steps. Please log in to the portal for the full notice details.`,
    `<a href="${data.portalLink || "#"}" style="display:inline-block;padding:12px 24px;background:#dc2626;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">View RFE Details</a>`,
  ].filter(Boolean);
}
module.exports = { key: "rfe-received", subject, bodyLines };
