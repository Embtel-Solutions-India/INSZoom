const { normalizeVisaType, LEGACY_LABEL_FOR_CHECKLIST } = require("./visaTypes");
const questionnaireRegistry = require("../modules/employment-workflow/questionnaires/registry");

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
  "EB-1A": [
    { name: "Passport", description: "Valid passport", required: true, category: "identity" },
    { name: "Awards / Recognition", description: "Evidence of extraordinary ability", required: true, category: "evidence" },
    { name: "Publications", description: "Scholarly or professional publications", required: true, category: "evidence" },
    { name: "Recommendation Letters", description: "Letters from recognized field experts", required: true, category: "letters" },
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
  };
}

// Single entry point for "what documents does this visa need" used at case
// creation and by the admin "regenerate checklist" action. Prefers the
// comprehensive, actively-maintained employment-workflow questionnaire
// definitions (currently L-1A/H-1B) when one exists for the visa type, and
// falls back to the generic VISA_CHECKLISTS table above for every other type.
function generateChecklist(visaType) {
  const canonical = normalizeVisaType(visaType);
  const definition = canonical ? questionnaireRegistry.getDefinition(canonical) : null;
  if (definition) {
    return questionnaireRegistry.standardDocuments(canonical).map(toChecklistItem);
  }
  const legacyKey = (canonical && LEGACY_LABEL_FOR_CHECKLIST[canonical]) || visaType;
  const templates = VISA_CHECKLISTS[legacyKey] || [];
  return templates.map(toChecklistItem);
}

module.exports = { VISA_CHECKLISTS, generateChecklist };
