// Sent to staff whenever a public eligibility-quiz lead is created —
// replaces the old mailto-only notification (see lead.service.js).
function subject(data = {}) {
  return `New ${data.tier ? `Tier ${data.tier} ` : ""}Lead — ${data.fullName || "Unknown"}`;
}

function bodyLines(data = {}) {
  return [
    `A new lead was captured${data.visaPathway ? ` for ${data.visaPathway}` : ""}.`,
    `Name: ${data.fullName || "Not provided"}`,
    `Email: ${data.email || "Not provided"}`,
    `Phone: ${data.phone || "Not provided"}`,
    data.tier ? `Tier: ${data.tier} (${data.criteriaMetCount ?? "?"} criteria met) — routing: ${data.routing || "n/a"}` : "",
    `Source: ${data.source || "Unknown"}`,
  ].filter(Boolean);
}

module.exports = { key: "quiz-lead-internal", subject, bodyLines };
