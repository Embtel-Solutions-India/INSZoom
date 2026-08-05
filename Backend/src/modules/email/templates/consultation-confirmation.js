// Sent to the prospect after a direct (Tier A/B) consultation booking.
// Branded per entity-config (msoEntityShortName only — PRD FR-2.3: no
// Founder's Office attribution); the caller supplies that via `data`.
function subject(data = {}) {
  return `Your consultation with ${data.msoEntityShortName || "us"} is confirmed`;
}

function bodyLines(data = {}) {
  return [
    `Hi ${data.fullName || "there"},`,
    `Your consultation with ${data.publicHostName || "our immigration team"} is confirmed for ${data.startAt ? new Date(data.startAt).toLocaleString("en-US") : "the scheduled time"}.`,
    data.locationType === "phone"
      ? "We'll call you at the phone number you provided."
      : (data.meetingUrl ? `Join here: ${data.meetingUrl}` : "We'll send video call details separately."),
    data.manageUrl ? `Need to reschedule or cancel? <a href="${data.manageUrl}">Manage your booking</a>.` : "",
    `${data.msoEntityShortName || "Our team"} looks forward to speaking with you.`,
  ].filter(Boolean);
}

module.exports = { key: "consultation-confirmation", subject, bodyLines };
