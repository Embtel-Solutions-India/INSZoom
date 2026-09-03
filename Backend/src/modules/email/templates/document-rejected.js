function subject(data = {}) { return `Action required: document needs to be replaced — Case ${data.caseNumber || ""}`; }
function bodyLines(data = {}) {
  return [
    `Hi ${data.recipientName || "there"},`,
    `Your case manager has reviewed the document you submitted${data.documentName ? ` (<strong>${data.documentName}</strong>)` : ""} and has requested a replacement.`,
    data.rejectionReason ? `<strong>Reason:</strong> ${data.rejectionReason}` : null,
    `Please log in to the portal and upload a corrected version as soon as possible to avoid delays to your case.`,
    `<a href="${data.portalLink || "#"}" style="display:inline-block;padding:12px 24px;background:#0f766e;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">Upload Replacement Document</a>`,
  ].filter(Boolean);
}
module.exports = { key: "document-rejected", subject, bodyLines };
