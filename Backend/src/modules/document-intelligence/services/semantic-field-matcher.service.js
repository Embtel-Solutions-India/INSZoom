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
  const questions = await Question.find({ questionnaire: { $in: questionnaireIds }, active: { $ne: false } }).select("key label sectionKey questionnaire");
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
  try {
    response = await providerRegistry.generateStructuredJson({ prompt: matchPrompt(documentType, unmapped, catalog) });
  } catch (error) {
    return [];
  }

  const results = [];
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
  return results;
}

module.exports = {
  MATCH_MIN_COMBINED_CONFIDENCE,
  buildTargetCatalog,
  matchFields,
};
