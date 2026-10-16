// Shared by the case-team emails: who did it, in the team's words - the person's own name, registered email and exactly which party
// they are on the case (Employer, Employee, Petitioner, Beneficiary, Client). Every value is HTML-escaped (names/emails are user input).
const { escapeHtml } = require("../emailVariables.registry");

function actorOf(data = {}) {
  return {
    name: String(data.actorName || data.senderName || data.clientName || "A client"),
    email: String(data.actorEmail || data.senderEmail || ""),
    role: String(data.actorRole || data.senderRole || data.filledBy || ""),
  };
}

// "<strong>Acme HR</strong> (hr@acme.com) - Employer"
function actorHtml(data) {
  const actor = actorOf(data);
  return `<strong>${escapeHtml(actor.name)}</strong>${actor.email ? ` (${escapeHtml(actor.email)})` : ""}${actor.role ? ` - ${escapeHtml(actor.role)}` : ""}`;
}

// "Case B195 (O-1B) - Acme Inc": the case is secondary information, never the headline.
function caseLineHtml({ caseNumber, visaType, employerName } = {}) {
  if (!caseNumber) return null;
  return `Case: <strong>${escapeHtml(caseNumber)}</strong>${visaType ? ` (${escapeHtml(visaType)})` : ""}${employerName ? ` - ${escapeHtml(employerName)}` : ""}`;
}

module.exports = { actorOf, actorHtml, caseLineHtml };
