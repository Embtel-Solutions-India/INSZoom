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
const familyBasedImmigrantPetition = require("../family-workflow/questionnaires/familyBasedImmigrantPetition");

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
// (Immiglance/Client/src/components/questionnaire/QuestionInput.jsx — path
// updated after the Landing/Client frontend split) checks
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

function buildFamilyBeneficiaryChecklist(definition, visaTypeKey, title, docSectionTitle, options = {}) {
  const visibility = { roles: ["beneficiary", ...STAFF_ROLES], portals: ["client", "admin"] };
  const fieldResult = fieldQuestionsFromCatalog(definition.fieldCatalog(), "beneficiary", visibility, definition.REPEATABLE_FIELDS);
  const docs = familyDocumentQuestions(definition.beneficiaryDocuments, docSectionTitle, visibility);
  return {
    key: `${definition.key}_beneficiary_checklist`,
    title,
    visaType: visaTypeKey,
    checklistRole: "beneficiary",
    // isDefault: false for the optional GC-NVC checklist (see
    // buildGcNvcChecklist below) - never auto-resolved/auto-assigned by
    // getQuestionnaireForCase's default-template fallback, only ever
    // reached via its own explicit key lookup after Case Manager approval.
    // Every existing caller (Green Card AOS, I-130, etc.) omits `options`
    // and keeps the original isDefault: true, unchanged.
    isDefault: options.isDefault !== false,
    description: "",
    sections: [...fieldResult.sectionOrder, docSectionTitle],
    questions: [...fieldResult.questions, ...docs],
  };
}

// I-864 joint sponsor - a third party distinct from the petitioner,
// collected only when the petitioner alone doesn't meet the income
// threshold. Its own role/checklist (not folded into "petitioner") per the
// new "joint_sponsor" enum value on Case.js/Questionnaire.js.
function buildFamilyJointSponsorChecklist(definition, visaTypeKey, title, docSectionTitle) {
  const visibility = { roles: ["joint_sponsor", ...STAFF_ROLES], portals: ["client", "admin"] };
  const fieldResult = fieldQuestionsFromCatalog(definition.fieldCatalog(), "joint_sponsor", visibility, definition.REPEATABLE_FIELDS);
  const docs = familyDocumentQuestions(definition.jointSponsorDocuments, docSectionTitle, visibility);
  return {
    key: `${definition.key}_joint_sponsor_checklist`,
    title,
    visaType: visaTypeKey,
    checklistRole: "joint_sponsor",
    // Not isDefault - only assigned when the petitioner's own I-864 income
    // doesn't meet the threshold and a joint sponsor is actually added to
    // the case, mirroring i131Checklist.js's own "never isDefault, assigned
    // explicitly" convention for a conditionally-needed checklist.
    isDefault: false,
    description: "",
    sections: [...fieldResult.sectionOrder, docSectionTitle],
    questions: [...fieldResult.questions, ...docs],
  };
}

// Every visaType familyBased() (Backend/src/modules/form-registry/seeds/
// visaFormMappings.seed.js) already generates a correct I-130/I-864/I-485
// VisaFormMapping package for - the checklist content (I-130/Green Card/
// I-864, all real, business-supplied, see familyBasedImmigrantPetition.js)
// has no visa-specific variation, so every one of them gets the same 5
// checklist templates. Each of the THREE separate source definitions
// (i130/greenCard/i864) needs its own key override per visaType (their
// shared base `key`s - "i130"/"green_card"/"i864" - would otherwise collide
// across all 12 visa types, exactly the bug fixed earlier this session for
// the single merged definition).
const FAMILY_VISA_TYPES = ["IR-1", "CR-1", "IR-2", "CR-2", "IR-3", "IR-4", "IR-5", "F1", "F2A", "F2B", "F3", "F4"];
function visaSlug(visaType) {
  return visaType.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function withKey(definition, key) {
  return { ...definition, key };
}

// The business's explicit composition rule (never "assign all three
// checklists always"): I-130's beneficiary checklist and the Green Card
// checklist collect materially the same beneficiary information (identity/
// address/marital history/children) from the same real intake - assigning
// both would ask the beneficiary to answer it twice. Petition Only never
// needs the Green Card/I-864 checklists at all (nothing beyond the petition
// itself is being filed yet).
//
// Returns the exact Questionnaire.key values FAMILY_CHECKLIST_DEFINITIONS
// above actually produces for this visaType, so a caller (case creation,
// the processing-path-change handler) can look them up and assign via the
// shared dedup-safe helper without re-deriving the key formula itself.
function resolveFamilyChecklistKeys(visaType, processingPath) {
  const slug = visaSlug(visaType);
  const i130Petitioner = `i130_${slug}_petitioner_checklist`;
  const i130Beneficiary = `i130_${slug}_beneficiary_checklist`;
  const greenCardBeneficiary = `green_card_${slug}_beneficiary_checklist`;
  const i864Sponsor = `i864_${slug}_petitioner_checklist`;
  if (processingPath === "ADJUSTMENT_OF_STATUS" || processingPath === "CONSULAR") {
    // Deliberately the SAME automatic baseline for both paths - the
    // separate, optional "Green Card – National Visa Center (NVC) /
    // Consular Processing Checklist" (gc_nvc_<slug>_checklist, see
    // resolveGcNvcChecklistKey below) is NEVER included here. It must not
    // become client-visible merely because processingPath === CONSULAR -
    // it is only ever assigned via family-workflow.controller.js's
    // approveGcNvcChecklist, on explicit Case Manager approval.
    return [i130Petitioner, greenCardBeneficiary, i864Sponsor];
  }
  // PETITION_ONLY, "", or anything else not yet chosen - petition-only is
  // the safe default (never silently assumes the client wants the fuller
  // Green Card package).
  return [i130Petitioner, i130Beneficiary];
}

// The optional GC-NVC checklist's key, for the ONE explicit call site that
// is allowed to assign it (approveGcNvcChecklist) - deliberately not part
// of resolveFamilyChecklistKeys()'s automatic composition above. Matches
// buildFamilyBeneficiaryChecklist's own `${definition.key}_beneficiary_checklist`
// formula exactly (definition.key here is `gc_nvc_${slug}`, set via
// withKey() below) - not a separately-invented format.
function resolveGcNvcChecklistKey(visaType) {
  return `gc_nvc_${visaSlug(visaType)}_beneficiary_checklist`;
}

const FAMILY_CHECKLIST_DEFINITIONS = [
  buildFamilyPetitionerChecklist(k1, "K1", "Information Required from U.S Sponsor/Petitioner (Required from US Citizen)", "From US Sponsor/ Petitioner:"),
  buildFamilyBeneficiaryChecklist(k1, "K1", "Information Required from Beneficiary (Required from Fiancee of US Citizen)", "Documents required from Beneficiary:"),
  buildFamilyPetitionerChecklist(k3, "K3", "Information Required from U.S Sponsor/Petitioner (Required from US Citizen)", "From US Sponsor/ Petitioner:"),
  buildFamilyBeneficiaryChecklist(k3, "K3", "Information Required from Beneficiary (Required from Spouse of US Citizen)", "Documents required from Beneficiary:"),
  ...FAMILY_VISA_TYPES.flatMap((visaType) => {
    const slug = visaSlug(visaType);
    const i130Definition = withKey(familyBasedImmigrantPetition.i130, `i130_${slug}`);
    const greenCardDefinition = withKey(familyBasedImmigrantPetition.greenCard, `green_card_${slug}`);
    const i864Definition = withKey(familyBasedImmigrantPetition.i864, `i864_${slug}`);
    const gcNvcDefinition = withKey(familyBasedImmigrantPetition.gcNvc, `gc_nvc_${slug}`);
    return [
      buildFamilyPetitionerChecklist(i130Definition, visaType, "Questionnaire for Petition for Alien Relative — Petitioner Information", "Documents required from Petitioner:"),
      buildFamilyBeneficiaryChecklist(i130Definition, visaType, "Questionnaire for Petition for Alien Relative — Beneficiary Information", "Documents required from Beneficiary:"),
      buildFamilyBeneficiaryChecklist(greenCardDefinition, visaType, "Green Card Checklist", "Documents Required:"),
      buildFamilyPetitionerChecklist(i864Definition, visaType, "Affidavit of Support (I-864) — Sponsor/Petitioner", "List of documents from the petitioner:"),
      buildFamilyJointSponsorChecklist(i864Definition, visaType, "Affidavit of Support (I-864) — Joint Sponsor", "Documents Required from Joint Sponsor:"),
      // Optional, Case-Manager-approved only - see resolveGcNvcChecklistKey
      // and family-workflow.controller.js's approveGcNvcChecklist. Not
      // returned by resolveFamilyChecklistKeys, so ensureFamilyChecklistReferences
      // (case creation / processingPath change) never auto-assigns it.
      buildFamilyBeneficiaryChecklist(
        gcNvcDefinition,
        visaType,
        "Green Card – National Visa Center (NVC) / Consular Processing Checklist",
        "Documents Required:",
        { isDefault: false }
      ),
    ];
  }),
];

module.exports = { FAMILY_CHECKLIST_DEFINITIONS, FAMILY_VISA_TYPES, resolveFamilyChecklistKeys, resolveGcNvcChecklistKey, visaSlug };
