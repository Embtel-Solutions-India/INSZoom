// Internal — sent to the host/admin who owns the consultation calendar. May
// include internal detail (prospect name, quiz tier/score, admin deep link)
// since the recipient is staff, never the public prospect-facing copy.
function subject(data = {}) {
  return `New consultation booked${data.tier ? ` — Tier ${data.tier}` : ""}: ${data.fullName || "Unknown"}`;
}

function bodyLines(data = {}) {
  return [
    `${data.fullName || "A prospect"} booked a free consultation${data.startAt ? ` for ${new Date(data.startAt).toLocaleString("en-US")}` : ""}.`,
    `Email: ${data.email || "Not provided"}`,
    `Phone: ${data.phone || "Not provided"}`,
    data.visaPathway ? `Visa pathway: ${data.visaPathway}` : "",
    data.tier ? `Quiz tier: ${data.tier} (${data.criteriaMetCount ?? "?"} criteria met)` : "",
  ].filter(Boolean);
}

module.exports = { key: "consultation-host-notify", subject, bodyLines };
