// Developer e-mail (Phase 7.E / B8): one or more forms are still not imported or not production ready AFTER every diagnosis, strategy and retry the pipeline has. ONE e-mail lists
// all forms stuck at that time, each with its stage, plain-language reason, error signature, every strategy that was tried and its result, what would release it, how long it has
// been stuck and whether the previous edition still serves. Content rules as the other pipeline templates: sanitized text only (no secrets, tokens, client data or stack traces are
// ever put into `data` - outcomeData.buildStuckData sanitizes them), every dynamic value is HTML-escaped.
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

const SHOWN_FORMS = 50;
const SHOWN_STRATEGIES = 15;
const SHOWN_CODES = 5;

function subject(data = {}) {
  const forms = Array.isArray(data.forms) ? data.forms : [];
  const codes = [...new Set(forms.map((item) => item.formCode).filter(Boolean))];
  const shown = codes.slice(0, SHOWN_CODES).join(", ") + (codes.length > SHOWN_CODES ? ` +${codes.length - SHOWN_CODES} more` : "");
  const count = data.count ?? forms.length;
  return `${data.reminder ? "Reminder - form" : "Form"} pipeline: ${count} form${count === 1 ? "" : "s"} stuck${shown ? ` - ${shown}` : ""}`;
}

const resultText = (item) => (item.result === "worked" ? "worked" : item.result === "unverified" ? "ran but could not be verified" : "did not work");

function formLines(item) {
  const e = escapeHtml;
  const lines = [];
  lines.push(`<strong>${e(item.formCode)}</strong>${item.fromEdition || item.toEdition ? ` &mdash; edition ${item.fromEdition ? `${e(item.fromEdition)} &rarr; ` : ""}${e(item.toEdition || "?")}` : ""} &mdash; stuck at <strong>${e(item.stage || "unknown")}</strong>${item.stuckFor ? ` for ${e(item.stuckFor)}` : ""}`);
  lines.push(`Why: ${e(item.reason || "no reason was recorded")}${item.signature ? ` (signature ${e(item.signature)})` : ""}`);
  const strategies = Array.isArray(item.strategies) ? item.strategies : [];
  if (strategies.length) {
    lines.push(`Tried (${e(strategies.length)}): ${strategies.slice(0, SHOWN_STRATEGIES).map((s) => `${e(s.strategy)} - ${e(resultText(s))}${s.evidence ? ` (${e(s.evidence)})` : ""}`).join("; ")}${strategies.length > SHOWN_STRATEGIES ? `; ...and ${e(strategies.length - SHOWN_STRATEGIES)} more` : ""}`);
  } else {
    lines.push("Tried: no strategy result was recorded for this job.");
  }
  const conditions = Array.isArray(item.releaseConditions) ? item.releaseConditions.filter(Boolean) : [];
  if (conditions.length) lines.push(`It will resume by itself when: ${conditions.map(e).join("; ")}`);
  lines.push(item.previousServing ? `The previous edition${item.activeEdition ? ` (${e(item.activeEdition)})` : ""} is still live; cases are not affected.` : "No edition of this form is live yet.");
  return lines;
}

function bodyLines(data = {}) {
  const e = escapeHtml;
  const forms = Array.isArray(data.forms) ? data.forms : [];
  const lines = [`${data.reminder ? "Reminder: " : ""}<strong>${e(data.count ?? forms.length)}</strong> form${(data.count ?? forms.length) === 1 ? " is" : "s are"} still not imported or not production ready after every automatic attempt. Nothing was promoted by guesswork; the previous edition keeps serving wherever there is one.`];
  for (const item of forms.slice(0, SHOWN_FORMS)) lines.push(...formLines(item));
  const hidden = (Number(data.count) || forms.length) - Math.min(forms.length, SHOWN_FORMS);
  if (hidden > 0) lines.push(`...and ${e(hidden)} more (see Form Governance for the full list).`);
  const resolved = Array.isArray(data.resolved) ? data.resolved : [];
  if (resolved.length) lines.push(`Resolved since the last e-mail: ${resolved.map((item) => `<strong>${e(item.formCode)}</strong>`).join(", ")}.`);
  lines.push(data.adminLink ? `<a href="${e(data.adminLink)}">Open Form Governance</a>` : "See Form Governance in the Admin app.");
  return lines;
}

module.exports = { key: "form-pipeline-stuck", subject, bodyLines, escapeHtml, SHOWN_FORMS, SHOWN_STRATEGIES };
