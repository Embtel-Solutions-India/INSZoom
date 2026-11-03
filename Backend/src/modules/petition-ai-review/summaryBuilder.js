// The scan summary shown at the top of the AI Review panel (Petition AI Review).
//   buildSummary()  - pure, always works: counts, page -> issues, category totals and a plain-language text built in code
//   withAiSummary() - optionally asks the AI for a short executive summary from the findings TEXT only (no petition pages);
//                     any failure, empty or odd answer keeps the code-built text, so a summary always exists
const { SEVERITIES, CATEGORIES } = require("./constants");
const { SEVERITY_RANK } = require("./findingValidator");

const CATEGORY_LABEL = Object.freeze({
  typo: "typos / wording", wrong_name: "wrong names", address_mismatch: "address mismatches", company_rule: "company-rule issues",
  consistency: "inconsistencies", unreadable_page: "unreadable pages",
});
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** buildSummary({ findings, gaps, totalPages, lastPage, skippedFrom }) -> { counts, byPage, byCategory, text } */
function buildSummary({ findings = [], gaps = [], totalPages = 0, lastPage = totalPages, skippedFrom = null } = {}) {
  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  const byCategory = Object.fromEntries(CATEGORIES.map((category) => [category, 0]));
  const pages = new Map();
  for (const finding of findings) {
    if (counts[finding.severity] !== undefined) counts[finding.severity] += 1;
    if (byCategory[finding.category] !== undefined) byCategory[finding.category] += 1;
    const entry = pages.get(finding.page) || { page: finding.page, count: 0, worst: finding.severity };
    entry.count += 1;
    if (SEVERITY_RANK[finding.severity] > SEVERITY_RANK[entry.worst]) entry.worst = finding.severity;
    pages.set(finding.page, entry);
  }
  const byPage = [...pages.values()].sort((a, b) => a.page - b.page);
  return { counts, byPage, byCategory, text: summaryText({ counts, byPage, byCategory, gaps, lastPage, skippedFrom, totalPages }) };
}

function summaryText({ counts, byPage, byCategory, gaps, lastPage, skippedFrom, totalPages }) {
  const total = counts.error + counts.warning + counts.info;
  const parts = [];
  if (!total) parts.push(`No issues found on ${plural(lastPage, "page")} checked.`);
  else {
    parts.push(`${plural(total, "issue")} on ${plural(byPage.length, "page")}: ${counts.error} to fix, ${counts.warning} to check, ${counts.info} minor.`);
    const top = Object.entries(byCategory).filter(([, count]) => count).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([category, count]) => `${count} ${CATEGORY_LABEL[category] || category}`);
    if (top.length) parts.push(`Mostly ${top.join(", ")}.`);
    const worst = byPage.filter((entry) => entry.worst === "error").slice(0, 8).map((entry) => entry.page);
    if (worst.length) parts.push(`Pages with errors: ${worst.join(", ")}${byPage.filter((entry) => entry.worst === "error").length > worst.length ? " ..." : ""}.`);
  }
  const gapPages = (gaps || []).reduce((sum, gap) => sum + Math.max(0, (gap.to || 0) - (gap.from || 0) + 1), 0);
  if (gapPages) parts.push(`${plural(gapPages, "page")} could not be read by the AI - check them by eye.`);
  if (skippedFrom) parts.push(`Pages ${skippedFrom}-${totalPages} were not scanned (page limit).`);
  parts.push("AI-assisted - verify before acting.");
  return parts.join(" ");
}

/**
 * withAiSummary({ summary, findings, caller }) -> summary with `text` replaced by a short AI summary when that works.
 * Never throws; never sends petition pages (findings text only, at most 80 of them).
 */
async function withAiSummary({ summary, findings = [], caller }) {
  if (!caller || !findings.length) return summary;
  try {
    const lines = findings.slice(0, 80).map((f) => `p${f.page} [${f.severity}/${f.category}] ${f.found}`).join("\n");
    const reply = await caller.call({
      parts: [{ text: `Write a 2-4 sentence executive summary for the case team of these AI proof-reading findings on a petition. Plain language, no new facts. Return JSON {"summary":"..."}.\n\n${lines}` }],
      responseSchema: { type: "OBJECT", properties: { summary: { type: "STRING" } }, required: ["summary"] },
    });
    const parsed = JSON.parse(String(reply?.text || "").trim());
    const text = String(parsed?.summary || "").replace(/\s+/g, " ").trim();
    if (text.length < 20 || text.length > 1500) return summary;
    return { ...summary, text: `${text} AI-assisted - verify before acting.`, aiText: true };
  } catch (_error) {
    return summary;
  }
}

module.exports = { buildSummary, withAiSummary, CATEGORY_LABEL };
