// Turns the AI's raw answer into findings the scan can store (Petition AI Review). Pure, never throws.
// The model's page numbers are relative to the slice; they are mapped to real pages here, and anything outside the slice is dropped
// (a model that "sees" page 9 in a 4-page slice is hallucinating). Enums are enforced, text is trimmed to the model's limits.
const { SEVERITIES, CATEGORIES, CATEGORY, SEVERITY, LIMITS } = require("./constants");
const { toAbsolutePage } = require("./batchPlanner");

// Common words a model uses instead of the exact category name.
const CATEGORY_ALIASES = Object.freeze({
  spelling: CATEGORY.TYPO, grammar: CATEGORY.TYPO, punctuation: CATEGORY.TYPO, typo_error: CATEGORY.TYPO,
  name: CATEGORY.WRONG_NAME, name_mismatch: CATEGORY.WRONG_NAME, wrong_person: CATEGORY.WRONG_NAME,
  address: CATEGORY.ADDRESS_MISMATCH, wrong_address: CATEGORY.ADDRESS_MISMATCH,
  rule: CATEGORY.COMPANY_RULE, compliance: CATEGORY.COMPANY_RULE, company_rules: CATEGORY.COMPANY_RULE, branding: CATEGORY.COMPANY_RULE,
  inconsistency: CATEGORY.CONSISTENCY, date: CATEGORY.CONSISTENCY, fact: CATEGORY.CONSISTENCY,
  unreadable: CATEGORY.UNREADABLE_PAGE, blank_page: CATEGORY.UNREADABLE_PAGE, illegible: CATEGORY.UNREADABLE_PAGE,
});
const SEVERITY_ALIASES = Object.freeze({ critical: SEVERITY.ERROR, high: SEVERITY.ERROR, major: SEVERITY.ERROR, medium: SEVERITY.WARNING, minor: SEVERITY.INFO, low: SEVERITY.INFO, note: SEVERITY.INFO });
const SEVERITY_RANK = Object.freeze({ error: 3, warning: 2, info: 1 });

const key = (value) => String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
const text = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function category(value) {
  const k = key(value);
  return CATEGORIES.includes(k) ? k : CATEGORY_ALIASES[k] || null;
}
function severity(value) {
  const k = key(value);
  return SEVERITIES.includes(k) ? k : SEVERITY_ALIASES[k] || null;
}
function confidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  const scaled = number > 1 && number <= 100 ? number / 100 : number; // "85" meaning 85 %
  return Math.min(1, Math.max(0, Math.round(scaled * 100) / 100));
}

/**
 * Parses the model's text. Returns the object or null. Tolerates a ```json fence and text around the object
 * (the response schema normally prevents both).
 */
function parseAnswer(raw) {
  if (raw && typeof raw === "object") return raw;
  const source = String(raw || "").trim();
  if (!source) return null;
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : source;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

/**
 * validateAnswer(answer, batch) -> { findings, unreadablePages, dropped: { outOfRange, invalid } }
 * answer: the parsed object. findings get absolute pages; unreadablePages are absolute too.
 */
function validateAnswer(answer, batch) {
  const findings = [];
  const dropped = { outOfRange: 0, invalid: 0 };
  const rawFindings = Array.isArray(answer?.findings) ? answer.findings.slice(0, LIMITS.maxFindingsPerBatch * 2) : [];
  for (const raw of rawFindings) {
    const page = toAbsolutePage(batch, raw?.page);
    if (page === null) { dropped.outOfRange += 1; continue; }
    const item = {
      page,
      severity: severity(raw?.severity),
      category: category(raw?.category),
      excerpt: text(raw?.excerpt, LIMITS.maxExcerptChars),
      found: text(raw?.found, LIMITS.maxTextChars),
      suggestion: text(raw?.suggestion, LIMITS.maxTextChars),
      section: text(raw?.section, LIMITS.maxSectionChars), // where on the page (e.g. "Part 1, Item 2.a"); may be empty
      confidence: confidence(raw?.confidence),
    };
    if (!item.category || (!item.excerpt && !item.found)) { dropped.invalid += 1; continue; }
    if (!item.severity) item.severity = item.category === CATEGORY.TYPO ? SEVERITY.INFO : SEVERITY.WARNING;
    findings.push(item);
  }
  const unreadablePages = [...new Set((Array.isArray(answer?.unreadablePages) ? answer.unreadablePages : []).map((p) => toAbsolutePage(batch, p)).filter((p) => p !== null))];
  return { findings: dedupeFindings(findings).slice(0, LIMITS.maxFindingsPerBatch), unreadablePages, dropped };
}

/** One finding per page + category + excerpt; the most severe / most confident copy wins. Order: page, then severity. */
function dedupeFindings(findings) {
  const best = new Map();
  for (const finding of findings) {
    const id = `${finding.page}|${finding.category}|${key(finding.excerpt || finding.found).replace(/[^a-z0-9_]/g, "")}`;
    const current = best.get(id);
    if (!current || SEVERITY_RANK[finding.severity] > SEVERITY_RANK[current.severity]
      || (SEVERITY_RANK[finding.severity] === SEVERITY_RANK[current.severity] && finding.confidence > current.confidence)) best.set(id, finding);
  }
  return [...best.values()].sort((a, b) => a.page - b.page || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

/** The finding recorded for a page the AI could not read (never silently skipped). */
function unreadableFinding(page, reason) {
  return { page, severity: SEVERITY.WARNING, category: CATEGORY.UNREADABLE_PAGE, excerpt: "", found: text(`The AI could not read this page (${reason}). Check it by eye.`, LIMITS.maxTextChars), suggestion: "", confidence: 1 };
}

module.exports = { parseAnswer, validateAnswer, dedupeFindings, unreadableFinding, SEVERITY_RANK };
