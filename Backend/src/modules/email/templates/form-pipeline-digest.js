// Developer e-mail: ONE summary of the editions a scheduled / catalog-wide run promoted (plan "Developer email notifications" - batch runs send a digest instead of one e-mail
// per form). Form codes, edition dates and counts only; every dynamic value is HTML-escaped.
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

const SHOWN = 50;
const TRIGGER_TEXT = { catalog_sync: "catalog sync", autopilot: "autopilot", edition_upgrade: "edition upgrade", script: "script", admin_fetch: "admin fetch", case_acquire: "case acquisition", mapping_save: "mapping save", manual_retry: "manual retry" };
const triggerText = (trigger) => TRIGGER_TEXT[trigger] || "pipeline";

function subject(data = {}) {
  return `Form pipeline summary: ${data.count || 0} edition${data.count === 1 ? "" : "s"} promoted (${triggerText(data.trigger)})`;
}

function bodyLines(data = {}) {
  const e = escapeHtml;
  const entries = Array.isArray(data.entries) ? data.entries : [];
  const lines = [`The ${e(triggerText(data.trigger))} run promoted <strong>${e(data.count)}</strong> form edition${data.count === 1 ? "" : "s"}${data.individualSent ? ` (${e(data.individualSent)} more already e-mailed on their own)` : ""}.`];
  for (const item of entries.slice(0, SHOWN)) {
    lines.push(`<strong>${e(item.formCode)}</strong>: ${item.fromEdition ? `${e(item.fromEdition)} &rarr; ` : "added at "}${e(item.toEdition || "?")}${item.release === "degraded" ? " (degraded release)" : ""}`);
  }
  const hidden = (Number(data.count) || 0) - Math.min(entries.length, SHOWN);
  if (hidden > 0) lines.push(`...and ${e(hidden)} more (see Form Governance for the full list).`);
  lines.push(data.adminLink ? `<a href="${e(data.adminLink)}">Open Form Governance</a>` : "See Form Governance in the Admin app.");
  return lines;
}

module.exports = { key: "form-pipeline-digest", subject, bodyLines, escapeHtml, SHOWN };
