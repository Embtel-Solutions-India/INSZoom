function subject(data = {}) {
  return `New message${data.senderName ? ` from ${data.senderName}` : ""} - Case ${data.caseNumber || ""}`.trim();
}

function bodyLines(data = {}) {
  return [
    `Hi ${data.recipientName || "there"},`,
    `You have received a new message${data.caseNumber ? ` on case <strong>${data.caseNumber}</strong>` : ""}${data.senderName ? ` from <strong>${data.senderName}</strong>` : ""}.`,
    data.messagePreview ? `<em>"${data.messagePreview}"</em>` : null,
    `Sign in to read it and reply.`,
    `<a href="${data.portalLink || "#"}" style="display:inline-block;padding:12px 24px;background:#1e3a5f;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">Open the message</a>`,
  ].filter(Boolean);
}

module.exports = { key: "new-message-received", subject, bodyLines };
