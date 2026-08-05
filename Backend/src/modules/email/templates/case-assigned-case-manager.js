// Email sent to a Case Manager immediately after a case is assigned to them.
// Body content is a placeholder — actual copy will be supplied later and
// dropped in here without touching any call sites.
function subject() {
  return "New Case Assigned To You";
}

function bodyLines(data = {}) {
  return [
    `Hi ${data.caseManagerName || "there"},`,
    `Case ${data.caseNumber || ""} for ${data.clientName || "a client"} has been assigned to you.`,
  ];
}

module.exports = { key: "case-assigned-case-manager", subject, bodyLines };
