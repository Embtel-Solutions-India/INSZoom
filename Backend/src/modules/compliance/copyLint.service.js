const entityConfigService = require("../entity-config/entityConfig.service");
const { DEFAULT_SOFT_TERMS } = require("./compliance.constants");

// Pure, reusable prohibited-word guard. No DB access inside the hot path —
// `lint()` takes the term list as a plain argument so it can be called from
// anywhere (request handlers, background jobs, other services) without
// coupling to how the terms were resolved. `scan()` is the convenience
// wrapper that pulls the DB-or-fallback list once and delegates to `lint`.

function escapeRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Builds one alternation regex per lint() call from ESCAPED LITERALS only —
// terms are user/admin-configured plain words or phrases, never compiled as
// user-supplied regex syntax, so this can't be used to construct a
// catastrophic-backtracking pattern (no nested quantifiers are possible when
// every alternative is a fixed, escaped string joined with \b word boundaries).
function buildMatcher(terms) {
  const escaped = terms
    .map((term) => String(term || "").trim())
    .filter(Boolean)
    .map(escapeRegExp)
    .sort((a, b) => b.length - a.length); // longest-first so phrases win over sub-word overlaps
  if (!escaped.length) return null;
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
}

function normalizeForMatching(text) {
  // Diacritic-insensitive: strip combining marks after NFD normalization.
  return String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function lint(text, terms = [], softTerms = DEFAULT_SOFT_TERMS) {
  const normalized = normalizeForMatching(text);
  const hardMatcher = buildMatcher(terms);
  const softMatcher = buildMatcher(softTerms);

  const violations = [];
  if (hardMatcher) {
    let match;
    while ((match = hardMatcher.exec(normalized))) {
      violations.push({
        term: match[1].toLowerCase(),
        index: match.index,
        snippet: normalized.slice(Math.max(0, match.index - 20), match.index + match[1].length + 20).trim(),
        severity: "block",
      });
      if (match.index === hardMatcher.lastIndex) hardMatcher.lastIndex += 1; // guard zero-width match
    }
  }

  let softViolations = [];
  if (softMatcher) {
    let match;
    while ((match = softMatcher.exec(normalized))) {
      softViolations.push({
        term: match[1].toLowerCase(),
        index: match.index,
        snippet: normalized.slice(Math.max(0, match.index - 20), match.index + match[1].length + 20).trim(),
        severity: "warn",
      });
      if (match.index === softMatcher.lastIndex) softMatcher.lastIndex += 1;
    }
  }

  const allViolations = [...violations, ...softViolations].sort((a, b) => a.index - b.index);
  const severity = violations.length ? "block" : softViolations.length ? "warn" : "none";

  return { clean: allViolations.length === 0, violations: allViolations, severity };
}

async function scan(text) {
  const terms = await entityConfigService.resolveProhibitedTerms();
  return lint(text, terms);
}

module.exports = { lint, scan, buildMatcher, escapeRegExp };
