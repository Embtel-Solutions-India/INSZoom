function subject(data = {}) { return `Action required: questionnaire assigned — Case ${data.caseNumber || ""}`; }
function bodyLines(data = {}) {
  return [
    `Hi ${data.recipientName || "there"},`,
    `Your case manager has assigned a questionnaire that requires your input for your immigration case.`,
    data.questionnaireName ? `<strong>Questionnaire:</strong> ${data.questionnaireName}` : null,
    data.deadline ? `<strong>Please complete it by: ${data.deadline}</strong>` : `Please complete it as soon as possible to avoid delays.`,
    `<a href="${data.portalLink || "#"}" style="display:inline-block;padding:12px 24px;background:#0f766e;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">Complete Questionnaire</a>`,
  ].filter(Boolean);
}
module.exports = { key: "questionnaire-assigned", subject, bodyLines };
