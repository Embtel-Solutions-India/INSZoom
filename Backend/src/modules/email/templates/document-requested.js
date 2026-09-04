function subject(data = {}) { return `Action required: documents needed for your case — Case ${data.caseNumber || ""}`; }
function bodyLines(data = {}) {
  return [
    `Hi ${data.recipientName || "there"},`,
    `Your case manager has requested ${data.documentCount ? `<strong>${data.documentCount} document(s)</strong>` : "additional documents"} for your immigration case.`,
    data.documentList ? `<strong>Required documents:</strong><br>${data.documentList}` : null,
    `Please upload these documents through your portal as soon as possible.`,
    `<a href="${data.portalLink || "#"}" style="display:inline-block;padding:12px 24px;background:#0f766e;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">Upload Documents</a>`,
  ].filter(Boolean);
}
module.exports = { key: "document-requested", subject, bodyLines };
