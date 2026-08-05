// Sent to the prospect after they reschedule their own consultation via the
// token-based manage link. Neutral host language only — see
// consultation-confirmation.js for the pattern this mirrors.
function subject(data = {}) {
  return `Your consultation with ${data.msoEntityShortName || "us"} has been rescheduled`;
}

function bodyLines(data = {}) {
  return [
    `Hi ${data.fullName || "there"},`,
    `Your consultation with ${data.publicHostName || "our immigration team"} has been moved to ${data.startAt ? new Date(data.startAt).toLocaleString("en-US") : "a new time"}.`,
    data.locationType === "phone"
      ? "We'll call you at the phone number you provided."
      : (data.meetingUrl ? `Join here: ${data.meetingUrl}` : "We'll send video call details separately."),
    data.manageUrl ? `Need to make another change? <a href="${data.manageUrl}">Manage your booking</a>.` : "",
  ].filter(Boolean);
}

module.exports = { key: "consultation-reschedule", subject, bodyLines };
