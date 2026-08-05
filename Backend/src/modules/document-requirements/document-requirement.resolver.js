const mongoose = require("mongoose");
const Question = require("../../models/Question");
const Questionnaire = require("../../models/Questionnaire");
const { generateChecklist: generateConfigChecklist } = require("../../config/visaChecklists");
const { requirementsFor: requirementsForConfig } = require("../canonical/config/documentRequirements");
const { normalizeVisaType } = require("../../config/visaTypes");

function normalize(value) {
  return String(value || "").trim().replace(/[-\s_]+/g, "").toUpperCase();
}

function fileQuestionToRequirement(question, questionnaire) {
  return {
    name: question.metadata?.documentName || question.label,
    documentType: question.fileConstraints?.requireDocumentCategory || question.metadata?.documentType || question.evidenceCategory || question.key,
    description: question.helpText || question.description || "",
    required: question.required !== false,
    category: question.metadata?.category || question.evidenceCategory || "questionnaire",
    targetRole: questionnaire?.checklistRole || "",
    condition: question.conditionalLogic || undefined,
    source: `questionnaire:${questionnaire?.key || question.questionnaire}`,
  };
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = normalize(item.documentType || item.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function requirementsFromCanonicalDb(visaType) {
  // Fail fast to the config fallback instead of letting Mongoose buffer the
  // query indefinitely (queries issued with no live connection queue up and
  // only reject after the driver's buffering timeout, e.g. 10s) — matters
  // for callers evaluated without a DB connection (unit tests), and avoids a
  // slow hang in production during a transient disconnect.
  if (mongoose.connection.readyState !== 1) return [];
  const canonical = normalizeVisaType(visaType);
  const keys = [visaType, canonical, normalize(visaType)].filter(Boolean);
  if (!keys.length) return [];
  const regexes = keys.map((key) => new RegExp(`^${String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"));
  const questionnaires = await Questionnaire.find({
    status: { $ne: "archived" },
    isActive: { $ne: false },
    latestVersion: { $ne: false },
    $or: [
      { visaType: { $in: regexes } },
      { visaTypes: { $in: regexes } },
      { "assignmentRules.visaTypes": { $in: regexes } },
    ],
  }).lean();
  if (!questionnaires.length) return [];

  const questionnaireIds = questionnaires.map((item) => item._id);
  const questions = await Question.find({
    questionnaire: { $in: questionnaireIds },
    active: { $ne: false },
    $or: [
      { type: { $in: ["file", "file-multiple"] } },
      { "metadata.requestedType": "file-multiple" },
    ],
  }).sort({ pageKey: 1, sectionKey: 1, order: 1 }).lean();
  const questionnaireById = new Map(questionnaires.map((item) => [String(item._id), item]));
  return dedupe(questions.map((question) => fileQuestionToRequirement(question, questionnaireById.get(String(question.questionnaire)))));
}

async function resolveDocumentRequirements(visaOrProfile, options = {}) {
  const profile = typeof visaOrProfile === "object" && visaOrProfile !== null ? visaOrProfile : null;
  const visaType = profile
    ? profile.case?.visaType || profile.immigration?.currentVisaType || profile.beneficiary?.visaType
    : visaOrProfile;
  const dbRequirements = await requirementsFromCanonicalDb(visaType);
  if (dbRequirements.length) return dbRequirements;

  // Temporary Phase 2 migration path: configs remain seed/fallback inputs until
  // Phase 2.5 seeds and verifies every visa's canonical DB questionnaire.
  // The future DB-only cutover happens here by removing this fallback branch.
  if (options.format === "documentTypes") return requirementsForConfig(profile || { case: { visaType } });
  return generateConfigChecklist(visaType);
}

async function resolveDocumentRequirementTypes(profile = {}) {
  const requirements = await resolveDocumentRequirements(profile, { format: "documentTypes" });
  return requirements.map((item) => (typeof item === "string" ? item : item.documentType || item.name)).filter(Boolean);
}

module.exports = {
  resolveDocumentRequirements,
  resolveDocumentRequirementTypes,
};
