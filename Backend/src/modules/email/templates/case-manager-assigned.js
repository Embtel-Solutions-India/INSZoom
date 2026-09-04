function subject(data = {}) {
  return `Your case manager has been assigned — Case ${data.caseNumber || ""}`;
}

function bodyLines(data = {}) {
  return [
    `Hi ${data.clientName || "there"},`,
    `We're pleased to let you know that <strong>${data.caseManagerName || "a case manager"}</strong> has been assigned to handle your immigration case ${data.caseNumber || ""}.`,
    `Your case manager is your primary point of contact for any questions about your case. You can message them directly through your portal.`,
    `<a href="${data.portalLink || "#"}" style="display:inline-block;padding:12px 24px;background:#0f766e;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">Go to My Case</a>`,
  ];
}

module.exports = { key: "case-manager-assigned", subject, bodyLines };
