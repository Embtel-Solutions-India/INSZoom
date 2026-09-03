function subject(data = {}) { return `Action required: additional information needed — Case ${data.caseNumber || ""}`; }
function bodyLines(data = {}) {
  return [
    `Hi ${data.recipientName || "there"},`,
    `Your case manager has requested additional information for your immigration case.`,
    data.details ? `<strong>Details:</strong> ${data.details}` : null,
    `Please log in to the portal to provide the requested information as soon as possible.`,
    `<a href="${data.portalLink || "#"}" style="display:inline-block;padding:12px 24px;background:#0f766e;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">Provide Information</a>`,
  ].filter(Boolean);
}
module.exports = { key: "additional-info-requested", subject, bodyLines };
