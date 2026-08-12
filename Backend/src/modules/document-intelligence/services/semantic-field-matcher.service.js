const Case = require("../../../models/Case");
const Question = require("../../../models/Question");
const registry = require("../../employment-workflow/questionnaires/registry");
const questionnaireService = require("../../questionnaires/questionnaire.service");
const providerRegistry = require("../providers/document-intelligence-provider.registry");

const MATCH_MIN_COMBINED_CONFIDENCE = Number(process.env.DOCUMENT_PREFILL_MIN_CONFIDENCE || 55);

// Uses the same case-wide resolution as document-intelligence's questionnaire
// sync (every explicitly-assigned checklist plus each role's default
// template, e.g. the H-1B Employee Checklist) so the AI match catalog covers
// the questions the client is actually looking at, not just whatever's
// already in questionnaireReferences.
async function answerCatalogFor(caseData) {
  if (!caseData) return [];
  const targets = await questionnaireService.resolveCaseQuestionnaires(caseData._id);
  if (!targets.length) return [];
  const questionnaireIds = targets.map((target) => target.questionnaire._id);
  const questions = await Question.find({ questionnaire: { $in: questionnaireIds }, active: true }).select("key label sectionKey questionnaire");
  return questions.map((question) => ({
    targetSystem: "answer",
    targetPath: question.key,
    label: question.label,
    section: question.sectionKey,
    questionnaireId: question.questionnaire,
  }));
}

function masterDataCatalogFor(caseData) {
  if (!caseData?.visaType) return [];
  return registry.fieldCatalog(caseData.visaType)
    .filter((entry) => !entry.repeatable)
    .map((entry) => ({
      targetSystem: "masterData",
      targetPath: entry.path,
      label: entry.label,
      section: entry.section,
    }));
}

async function buildTargetCatalog(caseId) {
  if (!caseId) return [];
  const caseData = await Case.findById(caseId).select("visaType questionnaireReferences");
  if (!caseData) return [];
  const [answerTargets, masterDataTargets] = await Promise.all([
    answerCatalogFor(caseData),
    Promise.resolve(masterDataCatalogFor(caseData)),
  ]);
  return [...answerTargets, ...masterDataTargets];
}

function matchPrompt(documentType, fields, catalog) {
  const catalogLines = catalog.map((entry, index) => `${index}. [${entry.targetSystem}] ${entry.targetPath} — "${entry.label}"`).join("\n");
  const fieldLines = fields.map((field, index) => `${index}. key="${field.key}" value=${JSON.stringify(field.value)}`).join("\n");
  return [
    "You are matching fields extracted from an immigration case document to the closest matching field in a target field catalog, by meaning (not literal string matching).",
    `Document type: ${documentType}.`,
    "Extracted fields:",
    fieldLines,
    "Target field catalog (index. [system] path — label):",
    catalogLines,
    "For each extracted field, decide the single best-matching catalog entry by meaning (e.g. an extracted 'employerName' field matches a catalog entry labeled 'Company Legal Name'). Skip a field if nothing in the catalog is a reasonable match — do not force a match.",
    "Return strict JSON only: { \"matches\": [ { \"fieldKey\": \"...\", \"catalogIndex\": 0, \"matchConfidence\": 0-100 } ] }",
  ].join("\n\n");
}

async function matchFields({ documentType, fields, caseId, alreadyMappedKeys = [] }) {
  const unmapped = (fields || []).filter((field) => !alreadyMappedKeys.includes(field.key));
  if (!unmapped.length) return [];
  const catalog = await buildTargetCatalog(caseId);
  if (!catalog.length) return [];

  let response;
  let llmFailed = false;
  try {
    response = await providerRegistry.generateStructuredJson({ prompt: matchPrompt(documentType, unmapped, catalog) });
  } catch (error) {
    llmFailed = true;
  }

  const results = [];
  if (!llmFailed) {
    for (const match of response?.matches || []) {
      const entry = catalog[match.catalogIndex];
      const field = unmapped.find((item) => item.key === match.fieldKey);
      if (!entry || !field) continue;
      const matchConfidence = Math.max(0, Math.min(100, Number(match.matchConfidence) || 0));
      const combinedConfidence = Math.round((matchConfidence * (Number(field.confidence) || 0)) / 100);
      if (combinedConfidence < MATCH_MIN_COMBINED_CONFIDENCE) continue;
      results.push({
        fieldKey: field.key,
        targetSystem: entry.targetSystem,
        targetPath: entry.targetPath,
        questionnaireId: entry.questionnaireId,
        matchConfidence,
        combinedConfidence,
      });
    }
  }
  // `results` only ever contains matches that already cleared
  // MATCH_MIN_COMBINED_CONFIDENCE (filtered above), so "!results.length"
  // already covers all three fallback triggers the task specifies: the LLM
  // call threw/timed out (llmFailed), it returned zero matches, or every
  // match it returned was below the confidence floor.
  if (llmFailed || !results.length) {
    return heuristicFallbackMatch({ fields: unmapped, catalog })
      .filter((match) => match.combinedConfidence >= MATCH_MIN_COMBINED_CONFIDENCE);
  }
  return results;
}

// --- Deterministic fallback matcher -----------------------------------
// Used only when the LLM path above can't produce a usable match (see the
// call site's llmFailed/!results.length gate). Domain-abbreviation aliases
// worth expanding as real cases surface - kept small deliberately, per the
// task that added this ("don't over-build a huge dictionary up front").
const FIELD_ALIASES = {
  dob: "date of birth",
  ssn: "social security number",
  ein: "employer identification number",
  pob: "place of birth",
  dol: "date of last arrival",
};

function splitCamelCase(text) {
  return String(text || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

function normalizeTokens(text) {
  const words = splitCamelCase(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words.flatMap((word) => (FIELD_ALIASES[word] ? FIELD_ALIASES[word].split(" ") : [word]));
}

// |intersection| / |union| - a RATIO, not an absolute word count, because
// these field labels are only ever 2-5 words long (an absolute-count
// threshold like "6-7 matching words" would never fire on labels this
// short - see the task note this fallback was built against).
function tokenOverlapRatio(tokensA, tokensB) {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  if (!setA.size && !setB.size) return 1;
  const intersectionSize = [...setA].filter((token) => setB.has(token)).length;
  const unionSize = new Set([...setA, ...setB]).size;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

function levenshteinDistance(a, b) {
  const rows = a.length;
  const cols = b.length;
  if (!rows) return cols;
  if (!cols) return rows;
  const dp = Array.from({ length: rows + 1 }, () => new Array(cols + 1).fill(0));
  for (let i = 0; i <= rows; i += 1) dp[i][0] = i;
  for (let j = 0; j <= cols; j += 1) dp[0][j] = j;
  for (let i = 1; i <= rows; i += 1) {
    for (let j = 1; j <= cols; j += 1) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[rows][cols];
}

// Catches near-identical labels with word-order differences the token-set
// ratio above might not distinguish from a much weaker partial overlap
// (ratio treats "wage level employer" and "employer wage level" identically
// to any other 2-of-3 overlap; Levenshtein on the full normalized string
// rewards them for actually being the same words in a different order).
function levenshteinSimilarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (!maxLen) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

// For each unmapped field, picks the single best-scoring catalog entry (the
// LLM path above also returns one match per field, never several) subject
// to the task's own acceptance rule: token-overlap ratio >= 0.6 OR full-
// string Levenshtein similarity >= 0.8. On an exact-score tie, the FIRST
// catalog entry wins (stable sort, no special-casing by targetSystem) -
// buildTargetCatalog() always concatenates answer-catalog entries before
// masterData ones, so a tie between an "answer" Question and a "masterData"
// registry entry for the same underlying concept (this codebase's
// registry.fieldCatalog() and the employee checklist's own generated
// Questions frequently share the identical label - see
// i129-h1b-crosswalk.js's education-checkbox note) resolves to "answer".
// That matches deterministicAnswerMatches' own unconditional preference for
// the answer system, and it's what actually lets an OCR-derived value reach
// raw.questionnaireAnswers.* (an Answer document) rather than sitting only
// in questionnaireData.masterData - the crosswalk edges this fallback feeds
// are sourced from the former.
function heuristicFallbackMatch({ fields = [], catalog = [] } = {}) {
  const matches = [];
  for (const field of fields) {
    const fieldTokens = normalizeTokens(field.key);
    const fieldNormalized = fieldTokens.join(" ");
    let best = null;
    for (const entry of catalog) {
      const entryTokens = normalizeTokens(entry.label || entry.targetPath || "");
      const entryNormalized = entryTokens.join(" ");
      const ratio = tokenOverlapRatio(fieldTokens, entryTokens);
      const levSim = levenshteinSimilarity(fieldNormalized, entryNormalized);
      if (ratio < 0.6 && levSim < 0.8) continue;
      const score = Math.max(ratio, levSim);
      if (!best || score > best.score) best = { entry, score };
    }
    if (!best) continue;
    const matchConfidence = Math.round(best.score * 100);
    // Capped at 65 regardless of computed score - a heuristic string match,
    // however clean, is never allowed to look as trustworthy as a confirmed
    // LLM/deterministic match; it always lands in the same masterDataPrefill/
    // answer-auto-save review queue as everything else, never bypassing it.
    const combinedConfidence = Math.min(65, Math.round((matchConfidence * (Number(field.confidence) || 100)) / 100));
    matches.push({
      fieldKey: field.key,
      targetSystem: best.entry.targetSystem,
      targetPath: best.entry.targetPath,
      questionnaireId: best.entry.questionnaireId,
      matchConfidence,
      combinedConfidence,
      matchMethod: "heuristic_fallback",
    });
  }
  return matches;
}

module.exports = {
  MATCH_MIN_COMBINED_CONFIDENCE,
  buildTargetCatalog,
  matchFields,
  heuristicFallbackMatch,
};
