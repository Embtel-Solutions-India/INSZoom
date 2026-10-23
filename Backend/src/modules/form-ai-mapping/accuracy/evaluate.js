// Pure accuracy metrics for AI field mapping against the SIGNED golden set (no database, no network).
//
// The answer key is every golden entry whose valid review verdict is "right" (the box is filled with that source path) or "blank" (the box must stay empty). A review is valid only
// while the entry still says what it said when it was reviewed (contentHash), exactly as GoldenSetService.validReviews. Suggestions come from the Gemini mapping engine:
//   { targetFieldId, candidate: { sourcePath, transform?, condition? }, tier: "auto_use" | "needs_review" | "rejected", ... }
// and are matched to the key by targetFieldId. Only AUTO-USED suggestions are judged for precision and violations (the others never reach a live form); needs_review and rejected ones
// are counted for coverage and for the per-kind accuracy report.
//
//   critical role violation   an auto-used suggestion whose party (petitioner side / beneficiary side, from the source path) differs from the party the key expects
//   data-integrity failure    an auto-used suggestion that must never be auto-used: a box verified blank, a checkbox / radio / dropdown / date box, a conditional or repeating box,
//                             a sensitive field (SSN, A-number, passport number) or a whole address block
// Both are fatal for the gate whatever the overall precision is.
const { partyOfPath } = require("../../form-mapping/contract/MappingContractValidator");
const { MAIN_FAMILIES, AUTO_USE_KINDS, effectiveThresholds } = require("./thresholds");

const SENSITIVE_PATH = /(^|\.)(ssn|socialSecurity\w*|aNumber|alienNumber|alienRegistrationNumber|passportNumber|passport\.number)(\.|$)/i;
const ADDRESS_BLOCK = /(^|\.)(mailingAddress|physicalAddress|address|foreignAddress|homeAddress)$/i;
const REPEATING_PATH = /\.\d+(\.|$)/;

/** The source path a suggestion proposes: the engine stores it as candidate.path (candidate.sourcePath is accepted too). */
const pathOf = (suggestion) => normPath(suggestion?.candidate?.path ?? suggestion?.candidate?.sourcePath);
const normPath = (path) => String(path || "").replace(/\[(\d+)\]/g, ".$1").replace(/^\./, "").trim();
const round = (value) => (Number.isFinite(value) ? Math.round(value * 10000) / 10000 : null);
const ratio = (num, den) => (den ? round(num / den) : null);

/** The key: Map targetFieldId -> { entry, verdict, expectedPath, expectedParty, kind, conditional, repeating }. */
function buildKey({ goldenDraft, reviews = [] }) {
  const reviewByEntry = new Map(reviews.map((row) => [row.entryId, row]));
  const key = new Map();
  for (const entry of goldenDraft?.entries || []) {
    const review = reviewByEntry.get(entry.id);
    if (!review || review.contentHash !== entry.contentHash || !["right", "blank"].includes(review.verdict)) continue;
    const targetFieldId = entry.technical?.targetFieldId;
    if (!targetFieldId) continue;
    const expectedPath = normPath(entry.technical?.sourcePath);
    key.set(targetFieldId, {
      entryId: entry.id, formCode: entry.formCode, family: entry.family, kind: entry.boxKind || "text", verdict: review.verdict, expectedPath,
      expectedParty: review.verdict === "right" ? partyOfPath(expectedPath) : null,
      conditional: Boolean(entry.technical?.condition), repeating: entry.technical?.transform?.type === "arrayItem" || REPEATING_PATH.test(expectedPath),
    });
  }
  return key;
}

const empty = () => ({ verified: 0, suggested: 0, autoUsed: 0, autoCorrect: 0, autoWrong: 0, needsReview: 0, rejected: 0, roleViolations: 0, integrityFailures: 0, anyCorrect: 0 });
const finish = (bucket) => ({ ...bucket, precision: ratio(bucket.autoCorrect, bucket.autoUsed), coverage: ratio(bucket.suggested, bucket.verified), needsReviewRate: ratio(bucket.needsReview, bucket.suggested), candidateAccuracy: ratio(bucket.anyCorrect, bucket.suggested) });

/** Why this auto-used suggestion must never have been auto-used (empty list = allowed). */
function integrityProblems(item, suggestion, autoUseKinds) {
  const problems = [];
  const path = pathOf(suggestion);
  if (item.verdict === "blank") problems.push("BLANK_BOX_FILLED");
  if (!autoUseKinds.includes(item.kind)) problems.push("NON_TEXT_BOX_AUTO_USED");
  if (item.conditional || suggestion.candidate?.condition) problems.push("CONDITIONAL_BOX_AUTO_USED");
  if (item.repeating || suggestion.candidate?.transform?.type === "arrayItem" || REPEATING_PATH.test(path)) problems.push("REPEATING_BOX_AUTO_USED");
  if (SENSITIVE_PATH.test(path) || SENSITIVE_PATH.test(item.expectedPath || "")) problems.push("SENSITIVE_FIELD_AUTO_USED");
  if (ADDRESS_BLOCK.test(path) || ADDRESS_BLOCK.test(item.expectedPath || "")) problems.push("ADDRESS_BLOCK_AUTO_USED");
  return problems;
}

/**
 * @param goldenDraft        the committed golden draft ({ entries, heldOutForms, entriesChecksum })
 * @param reviews            GoldenSetReview rows ({ entryId, contentHash, verdict })
 * @param suggestionsByForm  { "I-90": [suggestion...] }
 * @param thresholds         optional overrides - can only be stricter than the pre-approved ones
 */
function evaluate({ goldenDraft, reviews = [], suggestionsByForm = {}, thresholds: overrides = {}, autoUseKinds = AUTO_USE_KINDS, mainFamilies = MAIN_FAMILIES } = {}) {
  const thresholds = effectiveThresholds(overrides);
  const key = buildKey({ goldenDraft, reviews });
  const byForm = {};
  const byFamily = {};
  const byKind = {};
  const overall = empty();
  const violations = { role: [], integrity: [] };
  const familyOfForm = {};
  const evaluatedForms = new Set();
  let unverified = 0;
  const bump = (item, field, amount = 1) => { for (const bucket of [overall, (byForm[item.formCode] ||= empty()), (byFamily[item.family] ||= empty()), (byKind[item.kind] ||= empty())]) bucket[field] += amount; };
  const verifiedPerFamilyKind = {};

  for (const item of key.values()) {
    familyOfForm[item.formCode] = item.family;
    bump(item, "verified");
  }

  for (const [formCode, suggestions] of Object.entries(suggestionsByForm)) {
    let formHasJudged = false;
    for (const suggestion of suggestions || []) {
      const item = key.get(suggestion.targetFieldId);
      if (!item || item.formCode !== formCode) { unverified += 1; continue; } // the box has no verified answer: reported, never judged
      formHasJudged = true;
      bump(item, "suggested");
      const tier = suggestion.tier;
      const path = pathOf(suggestion);
      const correct = item.verdict === "right" && path !== "" && path === item.expectedPath;
      if (correct) bump(item, "anyCorrect");
      if (tier === "needs_review") bump(item, "needsReview");
      else if (tier === "rejected") bump(item, "rejected");
      if (tier !== "auto_use") continue;
      bump(item, "autoUsed");
      if (correct) bump(item, "autoCorrect"); else bump(item, "autoWrong");
      const suggestedParty = partyOfPath(path);
      const base = { formCode, targetFieldId: suggestion.targetFieldId, entryId: item.entryId, expected: item.expectedPath || "(blank)", suggested: path };
      if (item.expectedParty && suggestedParty && suggestedParty !== item.expectedParty) {
        bump(item, "roleViolations");
        violations.role.push({ ...base, expectedParty: item.expectedParty, suggestedParty });
      }
      const problems = integrityProblems(item, suggestion, autoUseKinds);
      if (problems.length) {
        bump(item, "integrityFailures");
        violations.integrity.push({ ...base, problems });
      }
    }
    if (formHasJudged) evaluatedForms.add(formCode);
  }

  // verified golden fields per family and widget type, over the forms that were actually evaluated
  for (const item of key.values()) {
    if (!evaluatedForms.has(item.formCode)) continue;
    const kinds = (verifiedPerFamilyKind[item.family] ||= {});
    kinds[item.kind] = (kinds[item.kind] || 0) + 1;
  }

  const formsByFamily = {};
  for (const form of evaluatedForms) (formsByFamily[familyOfForm[form]] ||= []).push(form);
  Object.values(formsByFamily).forEach((list) => list.sort());
  const heldOutForms = goldenDraft?.heldOutForms || [];
  const autoUsedText = Object.entries(byKind).filter(([kind]) => autoUseKinds.includes(kind)).reduce((sum, [, bucket]) => sum + bucket.autoUsed, 0);
  const autoCorrectText = Object.entries(byKind).filter(([kind]) => autoUseKinds.includes(kind)).reduce((sum, [, bucket]) => sum + bucket.autoCorrect, 0);
  const precision = ratio(autoCorrectText, autoUsedText);
  const familiesShort = mainFamilies.filter((family) => (formsByFamily[family] || []).length < thresholds.minFormsPerFamily);
  const widgetShort = [];
  for (const [family, kinds] of Object.entries(verifiedPerFamilyKind)) {
    if (!mainFamilies.includes(family)) continue;
    for (const [kind, count] of Object.entries(kinds)) if (count < thresholds.minVerifiedPerWidgetType) widgetShort.push(`${family}/${kind}: ${count}`);
  }
  const heldOutMissing = heldOutForms.filter((form) => !evaluatedForms.has(form));

  const results = {
    "no critical party-role violation": { ok: overall.roleViolations <= thresholds.maxCriticalRoleViolations, actual: overall.roleViolations, required: `<= ${thresholds.maxCriticalRoleViolations}` },
    "no data-integrity failure": { ok: overall.integrityFailures <= thresholds.maxDataIntegrityFailures, actual: overall.integrityFailures, required: `<= ${thresholds.maxDataIntegrityFailures}` },
    "enough verified auto-used text mappings": { ok: autoUsedText >= thresholds.minAutoUsedTextMappings, actual: autoUsedText, required: `>= ${thresholds.minAutoUsedTextMappings}` },
    "precision on auto-used text mappings": { ok: precision !== null && precision >= thresholds.minPrecision && autoUsedText >= thresholds.minAutoUsedTextMappings, actual: precision, required: `>= ${thresholds.minPrecision} (with the sample above)` },
    "forms evaluated per main family": { ok: !familiesShort.length, actual: Object.fromEntries(mainFamilies.map((family) => [family, (formsByFamily[family] || []).length])), required: `>= ${thresholds.minFormsPerFamily} each` },
    "a held-out form was evaluated": { ok: !thresholds.requireHeldOutForm || (heldOutForms.length > 0 && !heldOutMissing.length), actual: heldOutForms.filter((form) => evaluatedForms.has(form)), required: heldOutForms.length ? heldOutForms.join(", ") : "a held-out form in the golden set" },
    "verified fields per widget type in each main family": { ok: !widgetShort.length && Object.keys(verifiedPerFamilyKind).some((family) => mainFamilies.includes(family)), actual: widgetShort.length ? `short: ${widgetShort.join("; ")}` : "all families reach the minimum", required: `>= ${thresholds.minVerifiedPerWidgetType} per widget type` },
  };
  const blockers = Object.entries(results).filter(([, result]) => !result.ok).map(([name, result]) => `${name}: ${typeof result.actual === "object" ? JSON.stringify(result.actual) : result.actual} (required ${result.required})`);
  const cap = (list) => list.slice(0, 50);
  return {
    met: blockers.length === 0,
    results,
    blockers,
    metrics: { overall: finish(overall), byForm: Object.fromEntries(Object.entries(byForm).map(([k, v]) => [k, finish(v)])), byFamily: Object.fromEntries(Object.entries(byFamily).map(([k, v]) => [k, finish(v)])), byKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, finish(v)])), autoUsedText, precision, unverifiedSuggestions: unverified },
    violations: { role: cap(violations.role), integrity: cap(violations.integrity), roleTotal: violations.role.length, integrityTotal: violations.integrity.length },
    evaluated: { forms: [...evaluatedForms].sort(), formsByFamily, families: Object.keys(formsByFamily).sort(), heldOutForms },
    thresholds,
    goldenChecksum: goldenDraft?.entriesChecksum || null,
    verifiedEntries: key.size,
  };
}

module.exports = { evaluate, buildKey, integrityProblems, normPath, pathOf };
