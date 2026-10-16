// Shared by the questionnaire emails sent to the case team: the questions / documents the client actually answered, grouped by
// checklist. `groups` is [{ title, labels: [..] }]; `more` is how many further answers were left out of the list.
const { escapeHtml } = require("../emailVariables.registry");

function answeredListHtml(groups, more) {
  if (!Array.isArray(groups) || !groups.length) return null;
  const blocks = groups.map((group) => {
    const items = (group.labels || []).map((label) => `<li style="margin:0 0 4px;">${escapeHtml(label)}</li>`).join("");
    return `<p style="margin:0 0 6px;"><strong>${escapeHtml(group.title || "Checklist")}</strong></p><ul style="margin:0 0 12px;padding-left:20px;">${items}</ul>`;
  });
  const extra = Number(more) > 0 ? `<p style="margin:0 0 12px;color:#6b7280;">…and ${Number(more)} more.</p>` : "";
  return `${blocks.join("")}${extra}`;
}

module.exports = { answeredListHtml };
