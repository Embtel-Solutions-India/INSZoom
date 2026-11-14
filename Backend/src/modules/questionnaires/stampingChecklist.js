// Stamping (Indian Timeline Cases): a visa type with NO subtype and ONE checklist, "stamping_checklist" - NONIMMIGRANT VISA - CONSULAR PROCESSING CHECKLIST (question keys "stmp_<name>").
// It is a DEFAULT checklist of the visa type "STAMPING" (isDefault + visaType + client role), so a case gets it when - and only when - its visa type is Stamping. Single-person, client
// role, NO USCIS forms, NO canonical mappings. Its questions are exactly those of the US Visitor Visa applicant checklist (one shared definition, not a copy) plus the third document,
// "Copy of Recent Approval Notice". Every question is ALWAYS visible; no "IMPORTANT INSTRUCTIONS" block, no e-mail wording, no physical photographs.
const { buildDefinition, APPLICANT_SPECS } = require("./usVisitorVisaChecklists");

const VISA_TYPE = "STAMPING";
const STAMPING_KEY = "stamping_checklist";
const STAMPING_TITLE = "Stamping - Nonimmigrant Visa Consular Processing Checklist";
const DOCUMENT_SECTION = "2. Required Document Checklist";

const SECTIONS = [...new Set(APPLICANT_SPECS.map((spec) => spec.section))];

// the shared specs with the approval notice added right after the photograph
const specs = APPLICANT_SPECS.flatMap((spec) => (spec.name === "doc_photograph"
  ? [spec, { section: DOCUMENT_SECTION, name: "doc_approval_notice", label: "Copy of Recent Approval Notice", type: "file", required: true }]
  : [spec]));

const buildStampingChecklist = () => buildDefinition({
  key: STAMPING_KEY, title: STAMPING_TITLE, order: 1, prefix: "stmp_", sections: SECTIONS, specs, visaType: VISA_TYPE,
  description: "Stamping: nonimmigrant visa consular processing checklist and applicant questionnaire.",
});

const STAMPING_DEFINITIONS = [buildStampingChecklist()];

module.exports = { VISA_TYPE, STAMPING_KEY, STAMPING_TITLE, STAMPING_DEFINITIONS, buildStampingChecklist };
