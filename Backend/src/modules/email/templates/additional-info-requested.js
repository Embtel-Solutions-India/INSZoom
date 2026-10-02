function subject(data = {}) {
  return data.itemName
    ? `Action required: please provide ${data.itemName} - Case ${data.caseNumber || ""}`
    : `Action required: additional information needed - Case ${data.caseNumber || ""}`;
}
function bodyLines(data = {}) {
  const asking = data.itemName
    ? `${data.caseManagerName || "Your case manager"} is asking for ${data.itemKind === "document" ? "the following document" : "the following information"}: <strong>${data.itemName}</strong>.`
    : `Your case manager has requested additional information for your immigration case.`;
  return [
    `Hi ${data.recipientName || "there"},`,
    asking,
    data.details && data.details !== data.itemName ? `<strong>Details:</strong> ${data.details}` : null,
    `Please log in to the portal and provide the details in your checklist as soon as possible.`,
    `<a href="${data.portalLink || "#"}" style="display:inline-block;padding:12px 24px;background:#1e3a5f;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">Provide Information</a>`,
  ].filter(Boolean);
}
module.exports = { key: "additional-info-requested", subject, bodyLines };
