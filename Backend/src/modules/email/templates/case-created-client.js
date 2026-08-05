// Email sent to the client immediately after their immigration case is created.
// Body content is a placeholder — actual copy will be supplied later and dropped
// in here without touching any call sites.
function subject() {
  return "Your Immigration Case Has Been Created";
}

function bodyLines(data = {}) {
  return [
    `Hi ${data.clientName || "there"},`,
    `Your case ${data.caseNumber || ""} has been created.`,
  ];
}

module.exports = { key: "case-created-client", subject, bodyLines };
