// Developer e-mail: an edition was imported but NOT promoted (plan "Developer email notifications" - Held / approval required). Content rules as the other pipeline templates:
// sanitized reason only, no secrets, tokens, client data or stack traces; every dynamic value is HTML-escaped.
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function subject(data = {}) {
  const prefix = data.reasonKind === "policy_hold" ? "Form pipeline HELD" : "Form pipeline approval needed";
  return `${prefix}: ${data.formCode || "form"}${data.editionDate ? ` edition ${data.editionDate}` : ""}`;
}

function bodyLines(data = {}) {
  const e = escapeHtml;
  return [
    `Form <strong>${e(data.formCode)}</strong>${data.editionDate ? ` edition <strong>${e(data.editionDate)}</strong>` : ""} was imported but not promoted: ${e(data.reason || "it needs a decision")}.`,
    `Action needed: ${e(data.action || "open Form Governance and decide")}`,
    `${data.activeEdition ? `The active edition (${e(data.activeEdition)}) stays live and nothing was changed for cases. ` : "Nothing was changed for cases. "}Job ${e(data.jobId)}. ${data.adminLink ? `<a href="${e(data.adminLink)}">Open Form Governance</a>` : "See Form Governance in the Admin app."}`,
  ];
}

module.exports = { key: "form-pipeline-held", subject, bodyLines, escapeHtml };
