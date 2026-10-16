const { answeredListHtml } = require("./_answered");
const { actorOf, actorHtml, caseLineHtml } = require("./_actor");
const { escapeHtml } = require("../emailVariables.registry");

// No button of its own: email.service appends the single "Log in to Admin" button to every email sent to staff.
module.exports = {
  key: "questionnaire-submitted-team",
  subject: (data = {}) => `${actorOf(data).name} submitted their questionnaire`,
  bodyLines: (data = {}) => [
    `Hi ${escapeHtml(data.recipientName || "there")},`,
    `These documents have been submitted by the client: ${actorHtml(data)} has submitted${data.checklistName ? ` <strong>${escapeHtml(data.checklistName)}</strong>` : " their questionnaire"}.`,
    caseLineHtml(data),
    answeredListHtml(data.answeredGroups, data.answeredMore) ? "They have given answers for:" : null,
    answeredListHtml(data.answeredGroups, data.answeredMore),
    "Please log in to the Admin portal to view and review them.",
  ].filter(Boolean),
};
