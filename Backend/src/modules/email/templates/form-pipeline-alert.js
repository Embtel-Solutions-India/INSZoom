// Developer alert for the form import pipeline (plan "Developer email notifications"): sent when a run fails, is blocked, or is dead-lettered.
// Content rules: no secrets, tokens, client data or stack traces - the caller passes an already sanitized error code and short message. Every dynamic value is
// HTML-escaped here because email.service injects these lines into the page as HTML.
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

const KIND_TEXT = {
  failure: "stalled and will be retried",
  blocked: "is blocked (the input is not usable) and will be retried slowly",
  dead_letter: "failed repeatedly and was stopped (dead letter); it needs a manual retry",
  held: "was imported but not promoted",
};

function subject(data = {}) {
  const prefix = data.kind === "dead_letter" ? "Form pipeline STOPPED" : data.kind === "held" ? "Form pipeline held" : "Form pipeline problem";
  return `${prefix}: ${data.formCode || "form"}${data.editionDate ? ` edition ${data.editionDate}` : ""}`;
}

function bodyLines(data = {}) {
  const e = escapeHtml;
  const lines = [
    `Form <strong>${e(data.formCode)}</strong> could not be imported${data.editionDate ? ` for edition ${e(data.editionDate)}` : ""}${data.activeEdition ? ` (active edition: ${e(data.activeEdition)}, which remains live)` : ""}.`,
    `The pipeline stopped at stage <strong>${e(data.stage || "unknown")}</strong> because of: <strong>${e(data.errorClass || "error")}</strong> ${e(data.errorCode || "")} - ${e(data.message || "")}`,
    `This run ${e(KIND_TEXT[data.kind] || "needs attention")}. Attempts: ${e(data.attempts)} of ${e(data.maxAttempts)}. State: <strong>${e(data.state)}</strong>${data.nextAttemptAt ? `. Next retry: ${e(data.nextAttemptAt)}` : ""}.`,
  ];
  if (Array.isArray(data.repairs) && data.repairs.length) lines.push(`Repairs tried: ${data.repairs.map((item) => `${e(item.strategy)} (${e(item.outcome)}${item.verification ? `, verification: ${e(item.verification)}` : ""})`).join("; ")}.`);
  lines.push(`Job ${e(data.jobId)}. ${data.adminLink ? `<a href="${e(data.adminLink)}">Open Form Governance</a>` : "See Form Governance in the Admin app."}`);
  return lines;
}

module.exports = { key: "form-pipeline-alert", subject, bodyLines, escapeHtml };
