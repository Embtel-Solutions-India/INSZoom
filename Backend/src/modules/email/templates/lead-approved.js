// Sent to a prospect once staff approves their lead after a completed
// consultation — the step immediately before an admin converts them to a case.
function subject(data = {}) {
  return `Great news — your consultation is approved`;
}

function bodyLines(data = {}) {
  return [
    `Hi ${data.fullName || "there"},`,
    `We're pleased to let you know your case has been approved to move forward with ${data.msoEntityShortName || "our immigration team"}.`,
    `We'll be in touch shortly with next steps to get your case started.`,
  ].filter(Boolean);
}

module.exports = { key: "lead-approved", subject, bodyLines };
