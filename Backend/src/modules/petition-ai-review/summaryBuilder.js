// The scan summary shown at the top of the AI Review panel (Petition AI Review).
//   buildSummary()  - pure, always works: counts, page -> issues, category totals, and the bullet summary built in code: one point per
//                     page in page order, each issue on that page a sub-point with its section ("Page 4 - Part 1, Item 2: ...")
//   withAiSummary() - optionally asks the AI for a short executive summary from the findings TEXT only (no petition pages);
//                     any failure, empty or odd answer keeps the code-built text, so a summary always exists
const { SEVERITIES, CATEGORIES, LIMITS } = require("./constants");
const { SEVERITY_RANK } = require("./findingValidator");

const CATEGORY_LABEL = Object.freeze({
  typo: "typos / wording", wrong_name: "wrong names", address_mismatch: "address mismatches", company_rule: "company-rule issues",
  consistency: "inconsistencies", unreadable_page: "unreadable pages",
});
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const SEVERITY_WORD = Object.freeze({ error: "To fix", warning: "To check", info: "Minor" });
const ISSUE_LABEL = Object.freeze({ typo: "Typo / wording", wrong_name: "Wrong name", address_mismatch: "Address", company_rule: "Company rule", consistency: "Inconsistency", unreadable_page: "Unreadable page" });
const oneLine = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

/** What one issue says in the summary: what is wrong, then what it should be. */
function issueText(finding) {
  const found = oneLine(finding.found) || (finding.excerpt ? `"${oneLine(finding.excerpt)}"` : ISSUE_LABEL[finding.category] || "Issue");
  const suggestion = oneLine(finding.suggestion);
  return suggestion ? `${found} → ${suggestion}` : found;
}

/** Page-by-page points: [{ page, items: [{ section, severity, category, text }] }] in page order, worst first within a page; capped. */
function buildPoints(findings, maxItems = LIMITS.maxSummaryItems) {
  const sorted = [...findings].sort((a, b) => a.page - b.page || (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0));
  const points = [];
  for (const finding of sorted.slice(0, maxItems)) {
    let point = points.at(-1);
    if (!point || point.page !== finding.page) { point = { page: finding.page, items: [] }; points.push(point); }
    point.items.push({ section: oneLine(finding.section).slice(0, LIMITS.maxSectionChars), severity: finding.severity, category: finding.category, text: issueText(finding) });
  }
  return { points, more: Math.max(0, sorted.length - maxItems) };
}

/** The bullet text: "- Page 4 - Part 1: ... [To fix]" for one issue; "- Page 47" with indented sub-points for two or more. */
function pointsText(points, more) {
  const item = (entry) => `${entry.section ? `${entry.section}: ` : ""}${entry.text} [${SEVERITY_WORD[entry.severity] || entry.severity}]`;
  const lines = [];
  for (const point of points) {
    if (point.items.length === 1) lines.push(`• Page ${point.page} - ${item(point.items[0])}`);
    else {
      lines.push(`• Page ${point.page}`);
      for (const entry of point.items) lines.push(`    ◦ ${item(entry)}`);
    }
  }
  if (more) lines.push(`• ... and ${plural(more, "more issue")} in the list below.`);
  return lines.join("\n");
}

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
  const { points, more } = buildPoints(findings);
  return { counts, byPage, byCategory, points, more, text: summaryText({ counts, byPage, gaps, lastPage, skippedFrom, totalPages, points, more }) };
}

function summaryText({ counts, byPage, gaps, lastPage, skippedFrom, totalPages, points, more }) {
  const total = counts.error + counts.warning + counts.info;
  const lines = [];
  if (!total) lines.push(`No issues found on ${plural(lastPage, "page")} checked.`);
  else {
    lines.push(`${plural(total, "issue")} on ${plural(byPage.length, "page")}: ${counts.error} to fix, ${counts.warning} to check, ${counts.info} minor.`);
    lines.push(pointsText(points, more));
  }
  const gapPages = (gaps || []).reduce((sum, gap) => sum + Math.max(0, (gap.to || 0) - (gap.from || 0) + 1), 0);
  if (gapPages) lines.push(`${plural(gapPages, "page")} could not be read by the AI - check them by eye.`);
  if (skippedFrom) lines.push(`Pages ${skippedFrom}-${totalPages} were not scanned (page limit).`);
  lines.push("AI-assisted - verify before acting.");
  return lines.join("\n");
}

/**
 * withAiSummary({ summary, findings, caller }) -> summary with `text` replaced by a short AI summary when that works.
 * Never throws; never sends petition pages (findings text only, at most 80 of them).
 */
// `onUsage(replyOrError)` (optional) is told about the call's token use - also when it fails - so the scan's cost includes the summary call.
async function withAiSummary({ summary, findings = [], caller, onUsage = null }) {
  if (!caller || !findings.length) return summary;
  const tell = (value) => { try { onUsage?.(value); } catch (_error) { /* counting never breaks the summary */ } };
  try {
    const lines = findings.slice(0, 80).map((f) => `p${f.page} [${f.severity}/${f.category}] ${f.found}`).join("\n");
    const reply = await caller.call({
      parts: [{ text: `Write a 2-4 sentence executive summary for the case team of these AI proof-reading findings on a petition. Plain language, no new facts. Return JSON {"summary":"..."}.\n\n${lines}` }],
      responseSchema: { type: "OBJECT", properties: { summary: { type: "STRING" } }, required: ["summary"] },
    });
    tell(reply);
    const parsed = JSON.parse(String(reply?.text || "").trim());
    const text = String(parsed?.summary || "").replace(/\s+/g, " ").trim();
    if (text.length < 20 || text.length > 1500) return summary;
    return { ...summary, text: `${text} AI-assisted - verify before acting.`, aiText: true };
  } catch (error) {
    if (error && typeof error === "object" && "usage" in error) tell(error);
    return summary;
  }
}

module.exports = { buildSummary, withAiSummary, CATEGORY_LABEL };
