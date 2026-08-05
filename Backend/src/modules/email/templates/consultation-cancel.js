// Sent to the prospect after they cancel their own consultation via the
// token-based manage link.
function subject(data = {}) {
  return `Your consultation with ${data.msoEntityShortName || "us"} has been cancelled`;
}

function bodyLines(data = {}) {
  return [
    `Hi ${data.fullName || "there"},`,
    `Your consultation${data.startAt ? ` for ${new Date(data.startAt).toLocaleString("en-US")}` : ""} has been cancelled${data.reason ? `: ${data.reason}` : "."}`,
    "If this was a mistake, or you'd like to book a new time, you're welcome to start over.",
  ];
}

module.exports = { key: "consultation-cancel", subject, bodyLines };
