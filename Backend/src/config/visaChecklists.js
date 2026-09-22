const { normalizeVisaType, LEGACY_LABEL_FOR_CHECKLIST } = require("./visaTypes");
const questionnaireRegistry = require("../modules/employment-workflow/questionnaires/registry");
const eb1a = require("./eb1a");
const { resolveWithHierarchyFallback } = require("./visaHierarchy");

const VISA_CHECKLISTS = {
  "F-1": [
    { name: "Passport", description: "Valid passport at least 6 months beyond intended stay", required: true, category: "identity" },
    { name: "I-20", description: "Certificate of Eligibility issued by school DSO", required: true, category: "immigration" },
    { name: "SEVIS Fee Receipt", description: "Proof of SEVIS I-901 fee payment", required: true, category: "immigration" },
    { name: "Financial Proof", description: "Bank statements or sponsor letter", required: true, category: "financial" },
  ],
  "H-1B": [
    { name: "Passport", description: "Valid passport", required: true, category: "identity" },
    { name: "Resume / CV", description: "Updated resume with work experience", required: true, category: "employment" },
    { name: "Degree Certificate", description: "Degree matching specialty occupation", required: true, category: "education" },
    { name: "Employment Offer Letter", description: "Signed offer letter", required: true, category: "employment" },
  ],
  "O-1": [
    { name: "Awards / Recognition", description: "Evidence of nationally or internationally recognized prizes", required: true, category: "evidence" },
    { name: "Publications", description: "Published articles in major trade or scholarly publications", required: true, category: "evidence" },
    { name: "Recommendation Letters", description: "Expert letters from leaders in the field", required: true, category: "letters" },
    { name: "Passport", description: "Valid passport", required: true, category: "identity" },
  ],
  "EB-2 NIW": [
    { name: "Passport", description: "Valid passport", required: true, category: "identity" },
    { name: "Resume / CV", description: "Comprehensive resume with work and research history", required: true, category: "employment" },
    { name: "Degree Certificate", description: "Advanced degree in field of endeavor", required: true, category: "education" },
    { name: "National Interest Evidence", description: "Evidence that work benefits the United States", required: true, category: "evidence" },
  ],
};

function toChecklistItem(template) {
  return {
    name: template.name,
    documentType: template.documentType,
    description: template.description,
    required: Boolean(template.required),
    category: template.category,
    targetRole: template.targetRole || "",
    status: "pending",
    uploadedFiles: [],
    adminNotes: "",
    notes: "",
    submittedAt: null,
    reviewedAt: null,
    // Only present for criterion-grouped checklists (currently EB-1A) — see
    // eb1a.js's toCaseChecklistItems(). Undefined for every other visa type.
    criterionId: template.criterionId,
  };
}

// Exact-match lookup for one visaType string - checked, in order: EB-1A's
// dedicated self-petition criteria checklist (eb1a.js — must come before the
// employer-sponsored registry below, since EB-1A has no employer/employee
// split and was never added to that registry), then the comprehensive,
// actively-maintained employment-workflow questionnaire definitions
// (H-1B/L-1A/P/O-1/EB-1B) when one exists for the visa type, and finally the
// generic VISA_CHECKLISTS table above for every other type. Returns [] when
// nothing matches - generateChecklist() below is what tries a parent visa
// before giving up.
function generateChecklistExact(visaType) {
  const canonical = normalizeVisaType(visaType);
  // eb1a.matches()/questionnaireRegistry's own per-definition matches()
  // (h1b.js/l1a.js/p.js/o1.js/eb1b.js) already do their own raw-string
  // regex, independent of normalizeVisaType - so a subtype absent from
  // visaTypes.js's own narrow VISA_TYPES allow-list (e.g. "P-1A"/"P-1B",
  // which normalize to canonical=null since only bare "P" is registered
  // there) must still get a chance to match on the RAW string, not be
  // silently skipped just because canonical normalization failed. Try
  // canonical first (existing behavior, unchanged), then the raw string.
  if ((canonical && eb1a.matches(canonical)) || eb1a.matches(visaType)) {
    return eb1a.toCaseChecklistItems().map(toChecklistItem);
  }
  const definition = (canonical && questionnaireRegistry.getDefinition(canonical)) || questionnaireRegistry.getDefinition(visaType);
  if (definition) {
    return questionnaireRegistry.standardDocuments(canonical || visaType).map(toChecklistItem);
  }
  const legacyKey = (canonical && LEGACY_LABEL_FOR_CHECKLIST[canonical]) || visaType;
  const templates = VISA_CHECKLISTS[legacyKey] || [];
  return templates.map(toChecklistItem);
}

// Single entry point for "what documents does this visa need" used at case
// creation and by the admin "regenerate checklist" action. Tries the exact
// visaType first (generateChecklistExact, unchanged behavior/priority); if
// that's empty, walks the canonical visa hierarchy (visaHierarchy.js — the
// SAME walker the VisaFormMapping resolver uses) up to a parent
// classification before giving up - fixes visa subtypes like P-1S/P-2S/
// P-3S/P-4 that previously resolved to an empty checklist. A visa with its
// own dedicated exact-match result never inherits a parent's - the walker
// only advances when the current level was genuinely empty.
async function generateChecklist(visaType) {
  const { result } = await resolveWithHierarchyFallback(
    visaType,
    (vt) => generateChecklistExact(vt),
    (items) => !items.length
  );
  return result;
}

module.exports = { VISA_CHECKLISTS, generateChecklist, generateChecklistExact };
