function subject(data = {}) { return `Your case has a new case manager — Case ${data.caseNumber || ""}`; }
function bodyLines(data = {}) {
  return [
    `Hi ${data.clientName || "there"},`,
    `We'd like to let you know that your immigration case ${data.caseNumber || ""} has been reassigned to <strong>${data.newCaseManagerName || "a new case manager"}</strong>.`,
    data.previousCaseManagerName ? `Previously your case was handled by ${data.previousCaseManagerName}.` : null,
    `Your new case manager will be in touch shortly to introduce themselves and review the status of your case. All your case history, documents, and information remain unchanged.`,
    `<a href="${data.portalLink || "#"}" style="display:inline-block;padding:12px 24px;background:#0f766e;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">Go to My Case</a>`,
  ].filter(Boolean);
}
module.exports = { key: "case-manager-reassigned", subject, bodyLines };
