const { actorOf, actorHtml, caseLineHtml } = require("./_actor");
const { escapeHtml } = require("../emailVariables.registry");

// No button of its own: email.service appends the single "Log in to Admin" button to every email sent to staff.
module.exports = {
  key: "client-message-team-alert",
  subject: (data = {}) => `New message from ${actorOf(data).name}`,
  bodyLines: (data = {}) => [
    `Hi ${escapeHtml(data.recipientName || "there")},`,
    `A new message has been sent by ${actorHtml(data)} through the Immiglance portal.`,
    data.messagePreview ? `<em>"${escapeHtml(data.messagePreview)}"</em>` : null,
    caseLineHtml(data),
    "Log in to the Admin portal to view and reply. You will not get another email about this case's messages for the next 30 minutes.",
  ].filter(Boolean),
};
