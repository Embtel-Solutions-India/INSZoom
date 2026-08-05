// Converts the family-workflow module's K-1/K-3 field/document definitions
// into real Questionnaire/Question template definitions, in the same shape
// as questionnaire.service.js's VISA_TEMPLATE_DEFINITIONS — mirrors
// employmentChecklists.js's own conversion pattern for H-1B/L-1A/P/O-1, but
// is its own separate, self-contained file (no shared helpers imported from
// employmentChecklists.js, so the employer/employee conversion file is never
// touched or depended on by the family path).
//
// Both K-1 and K-3 are real, verbatim content (K-1 authored first, K-3
// second) via the shared buildFamilyPetitionerChecklist/
// buildFamilyBeneficiaryChecklist builders below (select/radio options,
// conditional visibility, repeating groups) — each visa still gets its own,
// fully separate Questionnaire/Question records (own `key`, own `visaType`,
// own documents); only the generation code is shared between them.

const k1 = require("../family-workflow/questionnaires/k1");
const k3 = require("../family-workflow/questionnaires/k3");

const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];

function slugSection(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function buildQuestion(key, label, type, sectionTitle, order, extras = {}) {
  return {
    key,
    label,
    type,
    sectionKey: slugSection(sectionTitle),
    pageKey: slugSection(sectionTitle),
    order,
    required: Boolean(extras.required),
    description: extras.description,
    options: (extras.options || []).map((value) => (typeof value === "object" ? value : { label: value, value })),
    evidenceCategory: extras.evidenceCategory,
    metadata: extras.metadata || {},
    visibility: extras.visibility || {},
    conditionalLogic: extras.conditionalLogic || { mode: "all", rules: [], groups: [] },
    repeatable: Boolean(extras.repeatable),
  };
}

// A catalog entry may carry an optional `condition` ({field, operator, value},
// `field` a dotted fieldCatalog() path) — converted to the underscored key
// format questions are built with (same transform as the question's own
// key). Mirrors employmentChecklists.js's conditionalLogicFromEntry, kept as
// its own local copy so this file never imports from that one.
function conditionalLogicFromEntry(entry) {
  if (!entry.condition) return undefined;
  const rules = entry.condition.rules || [entry.condition];
  return {
    mode: entry.condition.mode || "all",
    rules: rules.map((rule) => ({ questionKey: rule.field.replace(/\./g, "_"), operator: rule.operator || "equals", value: rule.value })),
    groups: [],
  };
}

// Builds field (non-document) questions from a K-1/K-3-shaped fieldCatalog()
// array, filtered to entries belonging to `party` ("petitioner"/
// "beneficiary"). Section titles come directly from each entry's own
// `sectionTitle` (the verbatim source heading) rather than being inferred
// from the path, since these sections don't follow a small reusable prefix
// map the way H-1B/L-1A's do — tracks section order-of-first-appearance and
// a per-section counter so `order`/`sections` come out the same way
// ensureDefaultVisaTemplates() expects from every other definition in this
// codebase.
//
// Repeating groups: authored as `type: "repeating_group"` with their row
// columns under `metadata.fields` — NOT `repeatableConfig.fields`. Verified
// directly against the Question schema (Backend/src/models/Question.js):
// `repeatableConfig` is a declared strict subdocument with only
// {min, max, labelTemplate, allowClientAdd} — an unknown `fields` key placed
// there is silently stripped by Mongoose before save (confirmed via a direct
// schema construction test). `metadata` is Schema.Types.Mixed, so it's the
// only path that actually persists; the frontend's RepeatableGroupInput
// (BAIS/Frontend/src/components/questionnaire/QuestionInput.jsx) checks
// metadata.columns / metadata.fields / repeatableConfig.fields / fields, in
// that order — metadata.fields is the second-priority, and the first one
// that actually survives persistence, so that's what's populated here.
// `repeatableConfig` is left unset entirely so its schema defaults apply
// (min:0, max unset, allowClientAdd:true) — an unset `max` reads as `0` on
// the frontend's `Number(...)` cast, which its own `if (maxRows && ...)`
// guard treats as "no cap", so every repeating group here is add-as-many.
function fieldQuestionsFromCatalog(catalogEntries, party, visibility, repeatableFieldsMap) {
  const sectionOrder = [];
  const counters = new Map();
  const questions = catalogEntries.filter((entry) => entry.section === party).map((entry) => {
    const title = entry.sectionTitle;
    if (!sectionOrder.includes(title)) sectionOrder.push(title);
    const nextOrder = (counters.get(title) || 0) + 1;
    counters.set(title, nextOrder);
    const type = entry.repeatable ? "repeating_group" : (entry.type || "text");
    return buildQuestion(entry.path.replace(/\./g, "_"), entry.label, type, title, nextOrder, {
      required: Boolean(entry.required),
      options: entry.options || (type === "radio" ? ["Yes", "No"] : []),
      metadata: entry.repeatable
        ? { sourcePath: entry.path, fields: repeatableFieldsMap[entry.path] || [] }
        : { sourcePath: entry.path },
      visibility,
      repeatable: Boolean(entry.repeatable),
      conditionalLogic: conditionalLogicFromEntry(entry),
    });
  });
  return { sectionOrder, questions };
}

// Document questions keep their own section-order-of-first-appearance too,
// even though today every family checklist only uses a single named
// document section — mirrors employmentChecklists.js's documentQuestions() shape.
function familyDocumentQuestions(documents, sectionTitle, visibility) {
  return documents.map((doc, index) => buildQuestion(doc.documentType, doc.name, "file", sectionTitle, index + 1, {
    description: doc.description,
    required: Boolean(doc.required),
    evidenceCategory: doc.category,
    metadata: { documentType: doc.documentType, category: doc.category, hardCopy: Boolean(doc.hardCopy) },
    visibility,
  }));
}

function buildFamilyPetitionerChecklist(definition, visaTypeKey, title, docSectionTitle) {
  const visibility = { roles: ["petitioner", ...STAFF_ROLES], portals: ["client", "admin"] };
  const fieldResult = fieldQuestionsFromCatalog(definition.fieldCatalog(), "petitioner", visibility, definition.REPEATABLE_FIELDS);
  const docs = familyDocumentQuestions(definition.petitionerDocuments, docSectionTitle, visibility);
  return {
    key: `${definition.key}_petitioner_checklist`,
    title,
    visaType: visaTypeKey,
    checklistRole: "petitioner",
    isDefault: true,
    description: "",
    sections: [...fieldResult.sectionOrder, docSectionTitle],
    questions: [...fieldResult.questions, ...docs],
  };
}

function buildFamilyBeneficiaryChecklist(definition, visaTypeKey, title, docSectionTitle) {
  const visibility = { roles: ["beneficiary", ...STAFF_ROLES], portals: ["client", "admin"] };
  const fieldResult = fieldQuestionsFromCatalog(definition.fieldCatalog(), "beneficiary", visibility, definition.REPEATABLE_FIELDS);
  const docs = familyDocumentQuestions(definition.beneficiaryDocuments, docSectionTitle, visibility);
  return {
    key: `${definition.key}_beneficiary_checklist`,
    title,
    visaType: visaTypeKey,
    checklistRole: "beneficiary",
    isDefault: true,
    description: "",
    sections: [...fieldResult.sectionOrder, docSectionTitle],
    questions: [...fieldResult.questions, ...docs],
  };
}

const FAMILY_CHECKLIST_DEFINITIONS = [
  buildFamilyPetitionerChecklist(k1, "K1", "Information Required from U.S Sponsor/Petitioner (Required from US Citizen)", "From US Sponsor/ Petitioner:"),
  buildFamilyBeneficiaryChecklist(k1, "K1", "Information Required from Beneficiary (Required from Fiancee of US Citizen)", "Documents required from Beneficiary:"),
  buildFamilyPetitionerChecklist(k3, "K3", "Information Required from U.S Sponsor/Petitioner (Required from US Citizen)", "From US Sponsor/ Petitioner:"),
  buildFamilyBeneficiaryChecklist(k3, "K3", "Information Required from Beneficiary (Required from Spouse of US Citizen)", "Documents required from Beneficiary:"),
];

module.exports = { FAMILY_CHECKLIST_DEFINITIONS };
