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
    // F-4 fix: immigration-knowledge-engine.service.js's applicableQuestionnaires()
    // already scopes its own questionnaire query to module "cases"/"clients" -
    // this resolver had no such filter, so an auto-generated "uscis_forms"-module
    // reference/definition questionnaire (e.g. IntelligentQuestionnaireService's
    // regenerated per-case "Filing Intake" composite, hundreds of questions) could
    // contribute document requirements no real checklist UI ever surfaced.
    module: { $in: ["cases", "clients"] },
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
    active: true,
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

// F-4 fix: DocumentsValidator (CanonicalSectionValidators.js) used to
// require this case's Document records to cover the visa's ENTIRE
// employer+employee combined document set - resolveDocumentRequirements
// returns every role's requirements together (by design, for createCase's
// per-case-role filtering in case.controller.js), with no role split
// applied here. For a single case (e.g. the employee child case) that can
// never be satisfied, since e.g. business_license belongs to the
// principal/employer case's own Documents, not this one's. Mirrors
// case.controller.js's filterChecklistForRole exactly: keep an item if it
// has no targetRole (shared) or its targetRole matches this case's role.
function expectedDocumentRoleForCase(caseInfo = {}) {
  if (caseInfo.caseStructure === "employer_employee") {
    if (caseInfo.caseRole === "principal") return "employer";
    if (caseInfo.caseRole === "employee") return "employee";
  }
  if (caseInfo.caseStructure === "family") {
    if (caseInfo.caseRole === "principal") return "petitioner";
    if (caseInfo.caseRole === "beneficiary") return "beneficiary";
  }
  return null;
}

async function resolveDocumentRequirementTypes(profile = {}) {
  const requirements = await resolveDocumentRequirements(profile, { format: "documentTypes" });
  const expectedRole = expectedDocumentRoleForCase(profile.case || {});
  const scoped = requirements
    .filter((item) => typeof item === "string" || !item.targetRole || item.targetRole === expectedRole || !expectedRole)
    // F-4 fix: every item's own `required` flag (question.required !== false,
    // set by fileQuestionToRequirement) was being discarded by the final
    // .map() below, so DocumentsValidator treated every OPTIONAL document
    // question (most of the H-1B employee checklist's file questions -
    // academic_certificates, dependent_*, previous_i797_notices, etc.) as
    // mandatory for canonical completeness, blocking Generate Forms on
    // documents the real checklist never marked with a REQUIRED badge.
    // String items (the config-fallback path, no per-item required info)
    // keep their original all-required semantics.
    .filter((item) => typeof item === "string" || item.required !== false);
  return scoped.map((item) => (typeof item === "string" ? item : item.documentType || item.name)).filter(Boolean);
}

module.exports = {
  resolveDocumentRequirements,
  resolveDocumentRequirementTypes,
};
