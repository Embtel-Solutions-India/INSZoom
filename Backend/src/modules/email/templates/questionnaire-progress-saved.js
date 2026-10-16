const { answeredListHtml } = require("./_answered");
const { actorOf, actorHtml, caseLineHtml } = require("./_actor");
const { escapeHtml } = require("../emailVariables.registry");

// No button of its own: email.service appends the single "Log in to Admin" button to every email sent to staff.
module.exports = {
  key: "questionnaire-progress-saved",
  subject: (data = {}) => `${actorOf(data).name} saved progress on their questionnaire`,
  bodyLines: (data = {}) => [
    `Hi ${escapeHtml(data.recipientName || data.caseManagerName || "there")},`,
    `${actorHtml(data)} has filled in information on the questionnaire${data.checklistName ? ` <strong>${escapeHtml(data.checklistName)}</strong>` : ""}.`,
    caseLineHtml(data),
    data.completionPercentage || data.completionPercentage === 0 ? `Current completion: ${escapeHtml(data.completionPercentage)}%.` : null,
    answeredListHtml(data.answeredGroups, data.answeredMore) ? "They have given answers for:" : null,
    answeredListHtml(data.answeredGroups, data.answeredMore),
    "Please log in to the Admin portal to review what was entered.",
  ].filter(Boolean),
};
