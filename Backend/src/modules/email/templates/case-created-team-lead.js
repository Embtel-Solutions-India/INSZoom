// Email sent to the Team Lead immediately after a new immigration case is
// created and routed to their queue. Body content is a placeholder — actual
// copy will be supplied later and dropped in here without touching any call sites.
function subject() {
  return "New Immigration Case Created";
}

function bodyLines(data = {}) {
  return [
    `Hi ${data.teamLeadName || "there"},`,
    `A new case ${data.caseNumber || ""} for ${data.clientName || "a client"} has been created and is awaiting assignment.`,
  ];
}

module.exports = { key: "case-created-team-lead", subject, bodyLines };
