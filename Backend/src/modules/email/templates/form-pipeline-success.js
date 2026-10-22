// Developer e-mail: an edition of a form was promoted to live (plan "Developer email notifications" - Success). Content rules: form codes, edition dates, visa type names,
// check names and counts only - no secrets, tokens, client data or stack traces. Every dynamic value is HTML-escaped (email.service injects these lines as HTML).
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function subject(data = {}) {
  return `Form pipeline: ${data.formCode || "form"} ${data.previousEdition ? "updated to" : "added at"} edition ${data.newEdition || "?"}`;
}

function releaseLine(release = {}) {
  const e = escapeHtml;
  if (release.mode !== "degraded") return "Release: <strong>promoted</strong> (every certification check passed).";
  const failed = (release.failed || []).length ? release.failed.map(e).join(", ") : "non-critical checks";
  const who = release.authorizedBy ? `, authorized by ${e(release.authorizedBy)}${release.authorizedAt ? ` on ${e(release.authorizedAt)}` : ""}` : "";
  return `Release: <strong>degraded</strong> - these non-critical checks failed: ${failed}${who}${release.reason ? ` (${e(release.reason)})` : ""}.`;
}

function bodyLines(data = {}) {
  const e = escapeHtml;
  const lines = [];
  lines.push(data.previousEdition
    ? `Form <strong>${e(data.formCode)}</strong> was updated from edition <strong>${e(data.previousEdition)}</strong> to edition <strong>${e(data.newEdition)}</strong>.`
    : `Form <strong>${e(data.formCode)}</strong> was added to the registry at edition <strong>${e(data.newEdition)}</strong>.`);
  lines.push(Array.isArray(data.visaTypes)
    ? (data.visaTypes.length
      ? `It is mapped to these visa types and case-creation options, from which the form will now activate: ${data.visaTypes.map(e).join(", ")}.`
      : "It is not mapped to any visa type or case-creation option yet, so no case creates it automatically.")
    : "The visa types it is mapped to could not be read for this e-mail.");
  lines.push(releaseLine(data.release));
  lines.push(data.coverage && data.coverage.total !== null
    ? `Coverage: ${e(data.coverage.mapped)} of ${e(data.coverage.total)} fields mapped; ${e(data.coverage.requiredUnmapped ?? "unknown")} required field(s) unresolved.`
    : "Coverage: not available for this edition yet.");
  lines.push(data.previousEdition ? "Previous edition: retired and retained for rollback." : "There was no previous edition.");
  lines.push(`Job ${e(data.jobId)}. ${data.adminLink ? `<a href="${e(data.adminLink)}">Open Form Governance</a>` : "See Form Governance in the Admin app."}`);
  return lines;
}

module.exports = { key: "form-pipeline-success", subject, bodyLines, escapeHtml };
