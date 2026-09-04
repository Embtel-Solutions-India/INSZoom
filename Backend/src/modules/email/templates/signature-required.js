function subject(data = {}) { return `Action required: your signature is needed — Case ${data.caseNumber || ""}`; }
function bodyLines(data = {}) {
  return [
    `Hi ${data.recipientName || "there"},`,
    `Your electronic signature is required for ${data.documentName ? `<strong>${data.documentName}</strong>` : "one or more immigration documents"} related to your case.`,
    `Please log in and review and sign the document(s) as soon as possible.`,
    `<a href="${data.portalLink || "#"}" style="display:inline-block;padding:12px 24px;background:#0f766e;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">Review &amp; Sign</a>`,
  ];
}
module.exports = { key: "signature-required", subject, bodyLines };
