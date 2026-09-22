// "Renew, Replace, Correct or Update Green Card" — a SERVICE for an
// EXISTING Green Card holder (Form I-90), not a new Green Card application.
// Completely separate from the I-130 family petition, Green Card/AOS, and
// GC-NVC/Consular workflows (family-workflow module) - this case never has
// a petitioner/beneficiary split.
//
// Reuses the existing single-party mechanism (checklistRole: "client", the
// same pattern singlePartyChecklists.js/i907_premium_processing_profile/
// h1b_questionnaire etc. already use for a one-person filing) - not a new
// architecture. Case.visaType for this service is the literal string
// "Green Card Renewal", already registered (with caseStructure: "single",
// forms: ["i-90"]) in config/visaCategories.js and already mapped to Form
// I-90 (and ONLY I-90 - no I-130/I-485/DS-260/I-864/I-765/I-131) in the
// existing VisaFormMapping seed (visaFormMappings.seed.js's "Green Card
// Renewal" -> I-90 AUTO_CREATE row) - both pre-existing, confirmed via
// inspection, neither touched here.
//
// The Questionnaire's own `visaType` below is deliberately space/dash-free
// ("GreenCardRenewal") to match getQuestionnaireForCase's normalized
// (space/dash-stripped, uppercased) comparison against Case.visaType -
// same convention every other single-party visaType in this codebase uses.
//
// Client-facing title is "Renew, Replace, Correct or Update Green Card" -
// never "I-90 Checklist" - set directly on the Questionnaire's `title`
// (what the client portal actually renders). Case Managers see the more
// technical "Green Card Renewal / Replacement / Correction / Update" via
// an explicit title override where this checklist is rendered in the CRM
// (CRMCaseDetail.jsx), plus the underlying form number, which is fine for
// staff.

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
    repeatable: false,
  };
}

const REASON_SECTION = "Application Reason";
const PERSONAL_SECTION = "Information About You";
const HISTORY_SECTION = "Green Card History";
const DOCUMENTS_SECTION = "Document Checklist";

// The structured reason field (§3 of the spec) - a real select-type
// question, not free text, so future conditional rules (e.g.
// replacement/lost-stolen-specific questions) can key off it exactly like
// every other conditional field in this system. Values are the internal
// codes; labels are the client-facing option text.
function buildReasonQuestion(visibility) {
  return buildQuestion("client_greenCardUpdateReason", "What do you need to do with your Green Card?", "select", REASON_SECTION, 1, {
    required: true,
    options: [
      { label: "Renew my Green Card", value: "RENEWAL" },
      { label: "Replace my Green Card", value: "REPLACEMENT" },
      { label: "Correct information on my Green Card", value: "CORRECTION" },
      { label: "Update my Green Card", value: "UPDATE" },
    ],
    description: "Renewal: your card has expired or expires within 6 months. Replacement: your card was lost, stolen, destroyed, or mutilated. Correction: your card has incorrect data or a typographical error. Update: your name or other biographic information has legally changed since your card was issued.",
    metadata: { sourcePath: "client.greenCardUpdateReason" },
    visibility,
  });
}

function fieldQuestions(visibility) {
  const fields = [
    { key: "client_aNumber", label: "A Number", required: false },
    { key: "client_gcSsn", label: "Social Security Number" },
    { key: "client_gcUscisOnlineAccountNumber", label: "USCIS Online Account Number (if any)", required: false },
    { key: "client_gcLastName", label: "Last Name" },
    { key: "client_gcFirstName", label: "First Name" },
    { key: "client_gcMiddleName", label: "Middle Name", required: false },
    { key: "client_gcGender", label: "Gender" },
    { key: "client_gcDateOfBirth", label: "Date of Birth", type: "date" },
    { key: "client_gcCityOfBirth", label: "City/Town of Birth" },
    { key: "client_gcCountryOfBirth", label: "Country of Birth" },
    { key: "client_gcHeight", label: "Height (ft/inches)" },
    { key: "client_gcWeight", label: "Weight (in pounds)" },
    { key: "client_gcEyeColor", label: "Eye Colour" },
    { key: "client_gcHairColor", label: "Hair Colour" },
    { key: "client_gcMothersName", label: "Mother's Name" },
    { key: "client_gcFathersName", label: "Father's Name" },
    { key: "client_gcMailingAddress", label: "Mailing Address" },
    { key: "client_gcPhysicalAddress", label: "Physical Address (if different from mailing address)", required: false },
  ].map((field, index) => buildQuestion(field.key, field.label, field.type || "text", PERSONAL_SECTION, index + 1, {
    required: field.required !== false,
    metadata: { sourcePath: `client.${field.key.replace("client_", "")}` },
    visibility,
  }));

  const history = [
    { key: "client_gcClassOfAdmission", label: "Class of Admission" },
    { key: "client_gcDateOfAdmission", label: "Date of Admission", type: "date" },
    { key: "client_gcApplicationLocation", label: "Location where you applied for a Green Card" },
    { key: "client_gcIssuingConsulateOrOffice", label: "Location of U.S. Consulate or USCIS Office where your Green Card was issued" },
    { key: "client_gcDestinationInUs", label: "Destination in the United States at the time of admission" },
    { key: "client_gcPortOfEntry", label: "Port-of-Entry where admitted to the United States (City & State)" },
  ].map((field, index) => buildQuestion(field.key, field.label, field.type || "text", HISTORY_SECTION, index + 1, {
    required: true,
    metadata: { sourcePath: `client.${field.key.replace("client_", "")}` },
    visibility,
  }));

  return [...fields, ...history];
}

function documentQuestions(visibility) {
  const documents = [
    { name: "2×2 Passport-size photos", documentType: "gc_renewal_passport_photos" },
    { name: "Copy of Passport", documentType: "gc_renewal_passport_copy" },
    { name: "Copy of Previous Permanent Residence Card", documentType: "gc_renewal_previous_green_card" },
    { name: "Copy of Driver's license or State Identification Card", documentType: "gc_renewal_drivers_license_or_state_id" },
    { name: "Copy of SSN", documentType: "gc_renewal_ssn_copy" },
    { name: "Copy of Tax Returns for the last three years", documentType: "gc_renewal_tax_returns" },
    { name: "Copy of Birth Certificate", documentType: "gc_renewal_birth_certificate" },
  ];
  return documents.map((doc, index) => buildQuestion(doc.documentType, doc.name, "file", DOCUMENTS_SECTION, index + 1, {
    required: true,
    evidenceCategory: "identity",
    metadata: { documentType: doc.documentType },
    visibility,
  }));
}

function buildGreenCardRenewalChecklist() {
  const visibility = { roles: ["client", ...STAFF_ROLES], portals: ["client", "admin"] };
  return {
    key: "green_card_renewal_checklist",
    // Client-facing - what the client portal actually renders as the
    // checklist title. Never "I-90 Checklist".
    title: "Renew, Replace, Correct or Update Green Card",
    visaType: "GreenCardRenewal",
    checklistRole: "client",
    isDefault: true,
    description: "",
    sections: [REASON_SECTION, PERSONAL_SECTION, HISTORY_SECTION, DOCUMENTS_SECTION],
    questions: [buildReasonQuestion(visibility), ...fieldQuestions(visibility), ...documentQuestions(visibility)],
  };
}

const GREEN_CARD_RENEWAL_DEFINITIONS = [buildGreenCardRenewalChecklist()];

module.exports = { GREEN_CARD_RENEWAL_DEFINITIONS, buildGreenCardRenewalChecklist };
