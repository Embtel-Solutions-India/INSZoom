// Converts the three H-4 filing types' supplied questionnaires/checklists
// (H-4 Extension, H-4 EAD, H-4 Extension + EAD) into real Questionnaire/
// Question template definitions, in the same shape as questionnaire.
// service.js's VISA_TEMPLATE_DEFINITIONS — mirrors sb1Checklist.js's/
// n400Checklist.js's single-party conversion pattern (H-4 has one primary
// applicant — the H-4 dependent — no petitioner/beneficiary/employer/
// employee split).
//
// These are REAL, standalone, selectable case-creation visaTypes (H4EXTENSION,
// H4EAD, H4EXTENSIONEAD — see Backend/src/config/filingTypes.js), exactly
// like SB-1/EB-1A/EB-2 NIW/"Green Card Renewal". So each definition here IS
// isDefault:true and its visaType IS the literal, real filingTypes.js
// visaType — the existing default-template auto-resolution in
// getQuestionnaireForCase (isDefault + checklistRole + visaType match)
// surfaces it automatically the moment a case is created with that visaType.
//
// Role: same as every other single-applicant case in this codebase
// (SB-1, N-400, N-565, N-600, I-131) — checklistRole is "client".
//
// These three filing types are deliberately EXCLUDED from
// singlePartyChecklists.js's generic 3-field SCAFFOLD generator (see that
// file's own filter) — this file is their real, follow-up content, exactly
// the same "scaffold now, real content later" progression sb1Checklist.js/
// n400Checklist.js/etc. already went through for their own filing types.
//
// Combined checklist note: H4_EXTENSION_EAD is its OWN single Questionnaire,
// not a concatenation of the H4_EXTENSION and H4_EAD definitions below — its
// content comes from its own combined source document, per the governing
// task spec. A case of visaType H4EXTENSIONEAD is assigned this ONE
// checklist only, never two.
//
// canonicalPath convention: reuses sb1Checklist.js's/n400Checklist.js's
// existing "applicant.*" canonicalPath convention for concepts already
// covered by profileCanonicalMap.js's EMPLOYEE_PROFILE_TO_CANONICAL (name,
// DOB, gender, country of birth/citizenship, address, passport fields,
// i94Number, alienRegistrationNumber, email, phone, currentVisaStatus/
// currentVisaExpiry) rather than inventing a new canonical namespace. SSN,
// USCIS Online Account Number, parents' names, and the physical-address-
// outside-US fields have no existing canonical path in this codebase, so
// those are left unmapped rather than inventing one (per the governing task
// spec).

const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];
const VISIBILITY = { roles: ["client", ...STAFF_ROLES], portals: ["client", "admin"] };

function slugSection(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function gate(questionKey, operator, value) {
  return { mode: "all", rules: [{ questionKey, operator, value }], groups: [] };
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
    ...(extras.canonicalPath ? { mapping: { canonicalPath: extras.canonicalPath } } : {}),
    visibility: extras.visibility || VISIBILITY,
    conditionalLogic: extras.conditionalLogic || { mode: "all", rules: [], groups: [] },
    repeatable: Boolean(extras.repeatable),
  };
}

function repeatingGroup(key, label, sectionTitle, order, columns, extras = {}) {
  return buildQuestion(key, label, "repeating_group", sectionTitle, order, {
    ...extras,
    repeatable: true,
    metadata: { sourcePath: key, fields: columns },
  });
}

// classification: "required" | "conditional" | "supporting" — informational
// metadata (Question.metadata is Mixed), alongside the real `required`
// boolean that actually drives completion/progress tracking. Mirrors
// sb1Checklist.js's documentQuestion helper exactly.
function documentQuestion(documentType, name, sectionTitle, order, extras = {}) {
  return buildQuestion(documentType, name, "file", sectionTitle, order, {
    description: extras.description,
    required: Boolean(extras.required),
    evidenceCategory: extras.category,
    metadata: { documentType, category: extras.category, classification: extras.classification || (extras.required ? "required" : "supporting") },
    visibility: VISIBILITY,
    conditionalLogic: extras.conditionalLogic,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// H-4 Extension (visaType: H4EXTENSION, key: h4_extension_questionnaire)
// ─────────────────────────────────────────────────────────────────────────
function buildH4ExtensionQuestionnaire() {
  const questions = [];

  const infoSection = "Information about You";
  questions.push(
    buildQuestion("client_familyName", "Family Name", "text", infoSection, 1, { required: true, canonicalPath: "applicant.lastName" }),
    buildQuestion("client_givenName", "Given Name", "text", infoSection, 2, { required: true, canonicalPath: "applicant.firstName" }),
    buildQuestion("client_middleName", "Middle Name", "text", infoSection, 3, { canonicalPath: "applicant.middleName" }),
    buildQuestion("client_aNumber", "A-Number", "text", infoSection, 4, { canonicalPath: "applicant.aNumber" }),
    buildQuestion("client_uscisOnlineAccountNumber", "USCIS Online Account Number", "text", infoSection, 5),
    buildQuestion("client_usMailingAddress", "US Mailing Address", "text", infoSection, 6, { required: true, canonicalPath: "applicant.mailingAddress" }),
    buildQuestion("client_usPhysicalAddress", "US Physical Address, if different", "text", infoSection, 7, { canonicalPath: "applicant.physicalAddress" })
  );

  const otherInfoSection = "Other Information";
  questions.push(
    buildQuestion("client_countryOfBirth", "Country of Birth", "text", otherInfoSection, 1, { required: true, canonicalPath: "applicant.countryOfBirth" }),
    buildQuestion("client_countryOfCitizenship", "Country of Citizenship", "text", otherInfoSection, 2, { required: true, canonicalPath: "applicant.countryOfCitizenship" }),
    buildQuestion("client_dateOfBirth", "Date of Birth", "date", otherInfoSection, 3, { required: true, canonicalPath: "applicant.dateOfBirth" }),
    // SSN has no existing canonical path in this codebase — left unmapped
    // per the governing task spec (do not invent one).
    buildQuestion("client_ssn", "SSN, if any", "text", otherInfoSection, 4),
    buildQuestion("client_daytimeTelephoneNumber", "Daytime Telephone Number", "text", otherInfoSection, 5, { required: true, canonicalPath: "applicant.phone" }),
    buildQuestion("client_emailAddress", "Email Address", "text", otherInfoSection, 6, { required: true, canonicalPath: "applicant.email" })
  );

  const lastEntrySection = "Most Recent Entry in USA";
  questions.push(
    buildQuestion("client_dateOfLastArrival", "Date of Last Arrival", "date", lastEntrySection, 1, { required: true }),
    buildQuestion("client_i94Number", "I-94 Number", "text", lastEntrySection, 2, { required: true, canonicalPath: "applicant.i94Number" }),
    buildQuestion("client_passportNumber", "Passport Number", "text", lastEntrySection, 3, { required: true, canonicalPath: "applicant.passportNumber" }),
    buildQuestion("client_countryOfPassportIssuance", "Country of Passport Issuance", "text", lastEntrySection, 4, { required: true, canonicalPath: "applicant.passportCountry" }),
    buildQuestion("client_passportExpirationDate", "Passport Expiration Date", "date", lastEntrySection, 5, { required: true, canonicalPath: "applicant.passportExpirationDate" }),
    buildQuestion("client_currentNonimmigrantStatus", "Current Nonimmigrant Status", "text", lastEntrySection, 6, { required: true, canonicalPath: "applicant.currentVisaStatus" }),
    buildQuestion("client_expirationOfCurrentStatus", "Expiration Date of Current Status", "date", lastEntrySection, 7, { required: true, canonicalPath: "applicant.currentVisaExpiry" })
  );

  // Physical Address Outside USA — component fields have no existing
  // canonical path (per the governing task spec), left unmapped.
  const outsideUsSection = "Physical Address Outside USA";
  questions.push(
    buildQuestion("client_outsideUsStreetNumberName", "Street Number and Name", "text", outsideUsSection, 1),
    buildQuestion("client_outsideUsCityTown", "City/Town", "text", outsideUsSection, 2),
    buildQuestion("client_outsideUsState", "State", "text", outsideUsSection, 3),
    buildQuestion("client_outsideUsPostalCode", "Postal Code", "text", outsideUsSection, 4),
    buildQuestion("client_outsideUsProvince", "Province", "text", outsideUsSection, 5),
    buildQuestion("client_outsideUsCountry", "Country", "text", outsideUsSection, 6)
  );

  const appTypeSection = "Application Type";
  const APPLICATION_TYPE_OPTIONS = [
    "Reinstatement to student status",
    "An extension of stay in my current status",
    "Change of status",
  ];
  const changeOfStatusGate = gate("client_applicationType", "equals", "Change of status");
  questions.push(
    buildQuestion("client_applicationType", "Application Type — select only one", "radio", appTypeSection, 1, { required: true, options: APPLICATION_TYPE_OPTIONS }),
    buildQuestion("client_changeOfStatusNewStatus", "New Status", "text", appTypeSection, 2, { conditionalLogic: changeOfStatusGate }),
    buildQuestion("client_changeOfStatusEffectiveDate", "Effective Date of New Status", "date", appTypeSection, 3, { conditionalLogic: changeOfStatusGate }),
    buildQuestion("client_changeOfStatusRequested", "Change of Status I am Requesting", "textarea", appTypeSection, 4, { conditionalLogic: changeOfStatusGate })
  );

  const docsSection = "Document Checklist";
  questions.push(
    documentQuestion("h4ext_doc_passportAndI94", "Copy of passport and I-94", docsSection, 1, { required: true, category: "identity" }),
    documentQuestion("h4ext_doc_ssn", "Copy of SSN, if any", docsSection, 2, { required: false, category: "identity" }),
    documentQuestion("h4ext_doc_eadCard", "Copy of EAD card, if any", docsSection, 3, { required: false, category: "immigration" }),
    documentQuestion("h4ext_doc_driversLicenseOrStateId", "Copy of driver's license or state ID", docsSection, 4, { required: false, category: "identity" }),
    documentQuestion("h4ext_doc_allApprovalNotices", "Copy of all approval notices", docsSection, 5, { required: true, category: "immigration" }),
    documentQuestion("h4ext_doc_relationshipEvidence", "Evidence of relationship to H-1B holder (marriage/birth certificate)", docsSection, 6, { required: true, category: "immigration" }),
    documentQuestion("h4ext_doc_h1bHolderPassportPaystubsApproval", "Copy of passport, latest 3 paystubs, and latest approval notice of H-1B holder", docsSection, 7, { required: true, category: "financial" })
  );

  const sections = [infoSection, otherInfoSection, lastEntrySection, outsideUsSection, appTypeSection, docsSection];

  return {
    key: "h4_extension_questionnaire",
    title: "H-4 Extension — Applicant Checklist",
    visaType: "H4EXTENSION",
    checklistRole: "client",
    isDefault: true,
    description: "",
    sections,
    questions,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// H-4 EAD (visaType: H4EAD, key: h4_ead_questionnaire)
// ─────────────────────────────────────────────────────────────────────────
function buildH4EadQuestionnaire() {
  const questions = [];

  const eadTypeSection = "EAD Application Type";
  const EAD_APPLICATION_TYPE_OPTIONS = [
    "New EAD card",
    "Replacement of lost, stolen, or damaged EAD card",
    "Renewal of your EAD card",
  ];
  questions.push(
    buildQuestion("client_eadApplicationType", "EAD Application Type — select only one", "radio", eadTypeSection, 1, { required: true, options: EAD_APPLICATION_TYPE_OPTIONS }),
    // Drives the spouse-relationship document block below.
    buildQuestion("client_eadBasedOnH1bSpouse", "Are you applying for this EAD based on the H-1B status of your spouse?", "radio", eadTypeSection, 2, { required: true, options: ["Yes", "No"] })
  );

  const infoSection = "Information about You";
  questions.push(
    buildQuestion("client_familyName", "Family Name", "text", infoSection, 1, { required: true, canonicalPath: "applicant.lastName" }),
    buildQuestion("client_givenName", "Given Name", "text", infoSection, 2, { required: true, canonicalPath: "applicant.firstName" }),
    buildQuestion("client_middleName", "Middle Name", "text", infoSection, 3, { canonicalPath: "applicant.middleName" }),
    buildQuestion("client_otherNamesUsed", "Other Names Used", "text", infoSection, 4),
    buildQuestion("client_gender", "Gender", "select", infoSection, 5, { options: ["Male", "Female"], canonicalPath: "applicant.gender" }),
    buildQuestion("client_dateOfBirth", "Date of Birth", "date", infoSection, 6, { required: true, canonicalPath: "applicant.dateOfBirth" }),
    // Source presents this as one combined field, distinct from the
    // dedicated "Country of Birth" field the combined H4_EXTENSION_EAD
    // checklist has — kept as a single free-text field rather than
    // splitting it (not itself named in the source as three fields), and
    // left without a canonicalPath since it mixes city/state with country.
    buildQuestion("client_cityStateCountryOfBirth", "City/State/Country of Birth", "text", infoSection, 7, { required: true }),
    buildQuestion("client_aNumber", "A-Number", "text", infoSection, 8, { canonicalPath: "applicant.aNumber" }),
    buildQuestion("client_uscisOnlineAccountNumber", "USCIS Online Account Number", "text", infoSection, 9),
    buildQuestion("client_usMailingAddress", "US Mailing Address", "text", infoSection, 10, { required: true, canonicalPath: "applicant.mailingAddress" }),
    buildQuestion("client_usPhysicalAddress", "US Physical Address, if different", "text", infoSection, 11, { canonicalPath: "applicant.physicalAddress" }),
    // SSN has no existing canonical path in this codebase — left unmapped.
    buildQuestion("client_ssn", "SSN, if any", "text", infoSection, 12)
  );

  // Only shown/collected if the applicant is requesting that an SSN be
  // issued — mirrors sb1Checklist.js's client_hasReentryPermit driver-field
  // precedent for expressing a source's own conditional rule as a real gate.
  const ssnSection = "Social Security Information";
  const wantsSsnGate = gate("client_wantsSsnIssued", "equals", "Yes");
  questions.push(
    buildQuestion("client_wantsSsnIssued", "Do you want the SSA to issue you a Social Security number?", "radio", ssnSection, 1, { required: true, options: ["Yes", "No"] }),
    buildQuestion("client_fatherFirstName", "Father's First Name", "text", ssnSection, 2, { conditionalLogic: wantsSsnGate }),
    buildQuestion("client_fatherLastName", "Father's Last Name", "text", ssnSection, 3, { conditionalLogic: wantsSsnGate }),
    buildQuestion("client_motherFirstName", "Mother's First Name", "text", ssnSection, 4, { conditionalLogic: wantsSsnGate }),
    buildQuestion("client_motherLastName", "Mother's Last Name", "text", ssnSection, 5, { conditionalLogic: wantsSsnGate })
  );

  const lastArrivalSection = "Last Arrival in USA";
  questions.push(
    buildQuestion("client_i94Number", "I-94 Number", "text", lastArrivalSection, 1, { required: true, canonicalPath: "applicant.i94Number" }),
    buildQuestion("client_passportNumber", "Passport Number", "text", lastArrivalSection, 2, { required: true, canonicalPath: "applicant.passportNumber" }),
    buildQuestion("client_countryOfPassportIssuance", "Country of Passport Issuance", "text", lastArrivalSection, 3, { required: true, canonicalPath: "applicant.passportCountry" }),
    buildQuestion("client_passportExpirationDate", "Passport Expiration Date", "date", lastArrivalSection, 4, { required: true, canonicalPath: "applicant.passportExpirationDate" }),
    buildQuestion("client_dateOfLastArrival", "Date of Last Arrival", "date", lastArrivalSection, 5, { required: true }),
    buildQuestion("client_currentNonimmigrantStatus", "Current Nonimmigrant Status", "text", lastArrivalSection, 6, { required: true, canonicalPath: "applicant.currentVisaStatus" }),
    buildQuestion("client_placeOfLastArrival", "Place of Last Arrival", "text", lastArrivalSection, 7, { required: true })
  );

  const docsSection = "Document Checklist";
  const spouseH1bGate = gate("client_eadBasedOnH1bSpouse", "equals", "Yes");
  questions.push(
    documentQuestion("h4ead_doc_passportPhotos", "Two identical passport-size photographs", docsSection, 1, { required: true, category: "identity" }),
    documentQuestion("h4ead_doc_recentApprovalNotice", "Copy of recent approval notice", docsSection, 2, { required: true, category: "immigration" }),
    documentQuestion("h4ead_doc_passportAndI94", "Copy of passport and I-94", docsSection, 3, { required: true, category: "identity" }),
    documentQuestion("h4ead_doc_ssn", "Copy of SSN, if any", docsSection, 4, { required: false, category: "identity" }),
    documentQuestion("h4ead_doc_driversLicenseOrStateId", "Copy of driver's license or state ID, if any", docsSection, 5, { required: false, category: "identity" }),
    documentQuestion("h4ead_doc_previousEadCard", "Copy of previous EAD card, if any", docsSection, 6, { required: false, category: "immigration" }),
    // "If applying for EAD based on H1B visa of your spouse" block.
    documentQuestion("h4ead_doc_spouseMarriageCertificate", "Marriage Certificate", docsSection, 7, { required: false, category: "immigration", classification: "conditional", conditionalLogic: spouseH1bGate }),
    documentQuestion("h4ead_doc_spouseH1bApprovalNotice", "H-1B approval notice of spouse", docsSection, 8, { required: false, category: "immigration", classification: "conditional", conditionalLogic: spouseH1bGate }),
    documentQuestion("h4ead_doc_spousePassportAndI94", "Passport and I-94 of spouse", docsSection, 9, { required: false, category: "identity", classification: "conditional", conditionalLogic: spouseH1bGate }),
    documentQuestion("h4ead_doc_spouseI140ApprovalNotice", "I-140 approval notice of spouse", docsSection, 10, { required: false, category: "immigration", classification: "conditional", conditionalLogic: spouseH1bGate }),
    documentQuestion("h4ead_doc_spousePaystubs3Months", "Last 3 months' pay stubs of spouse", docsSection, 11, { required: false, category: "financial", classification: "conditional", conditionalLogic: spouseH1bGate }),
    documentQuestion("h4ead_doc_spouseW2_2024", "W-2 2024 of spouse", docsSection, 12, { required: false, category: "financial", classification: "conditional", conditionalLogic: spouseH1bGate })
  );

  const sections = [eadTypeSection, infoSection, ssnSection, lastArrivalSection, docsSection];

  return {
    key: "h4_ead_questionnaire",
    title: "H-4 EAD — Applicant Checklist",
    visaType: "H4EAD",
    checklistRole: "client",
    isDefault: true,
    description: "",
    sections,
    questions,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// H-4 Extension + EAD, combined (visaType: H4EXTENSIONEAD,
// key: h4_extension_ead_questionnaire) — its OWN single Questionnaire, built
// from the combined source's own structure, never a concatenation of the
// two definitions above.
// ─────────────────────────────────────────────────────────────────────────
function buildH4ExtensionEadQuestionnaire() {
  const questions = [];

  const personalSection = "Personal Information of the Applicant";
  questions.push(
    buildQuestion("client_familyName", "Family Name", "text", personalSection, 1, { required: true, canonicalPath: "applicant.lastName" }),
    buildQuestion("client_givenName", "Given Name", "text", personalSection, 2, { required: true, canonicalPath: "applicant.firstName" }),
    buildQuestion("client_middleName", "Middle Name", "text", personalSection, 3, { canonicalPath: "applicant.middleName" }),
    buildQuestion("client_otherNamesUsed", "Other Names Used", "text", personalSection, 4),
    buildQuestion("client_gender", "Gender", "select", personalSection, 5, { options: ["Male", "Female"], canonicalPath: "applicant.gender" }),
    buildQuestion("client_dateOfBirth", "Date of Birth", "date", personalSection, 6, { required: true, canonicalPath: "applicant.dateOfBirth" }),
    // Source lists both a combined free-text field AND a dedicated
    // "Country of Birth" field — kept as two separate questions to avoid
    // dropping either source item (see file banner: transcribe faithfully).
    buildQuestion("client_cityStateCountryOfBirth", "City/State/Country of Birth", "text", personalSection, 7, { required: true }),
    buildQuestion("client_countryOfBirth", "Country of Birth", "text", personalSection, 8, { required: true, canonicalPath: "applicant.countryOfBirth" }),
    buildQuestion("client_countryOfCitizenship", "Country of Citizenship", "text", personalSection, 9, { required: true, canonicalPath: "applicant.countryOfCitizenship" }),
    buildQuestion("client_aNumber", "A-Number", "text", personalSection, 10, { canonicalPath: "applicant.aNumber" }),
    buildQuestion("client_uscisOnlineAccountNumber", "USCIS Online Account Number", "text", personalSection, 11),
    // SSN has no existing canonical path in this codebase — left unmapped.
    buildQuestion("client_ssn", "SSN, if any", "text", personalSection, 12),
    buildQuestion("client_daytimeTelephoneNumber", "Daytime Telephone Number", "text", personalSection, 13, { required: true, canonicalPath: "applicant.phone" }),
    buildQuestion("client_emailAddress", "Email Address", "text", personalSection, 14, { required: true, canonicalPath: "applicant.email" })
  );

  const addressSection = "Address Information";
  questions.push(
    buildQuestion("client_usMailingAddress", "US Mailing Address", "text", addressSection, 1, { required: true, canonicalPath: "applicant.mailingAddress" }),
    buildQuestion("client_usPhysicalAddress", "US Physical Address, if different", "text", addressSection, 2, { canonicalPath: "applicant.physicalAddress" }),
    // Physical Address Outside US — component fields have no existing
    // canonical path (per the governing task spec), left unmapped.
    buildQuestion("client_outsideUsStreetNumberName", "Street Number and Name (Outside US)", "text", addressSection, 3),
    buildQuestion("client_outsideUsCityTown", "City/Town (Outside US)", "text", addressSection, 4),
    buildQuestion("client_outsideUsState", "State (Outside US)", "text", addressSection, 5),
    buildQuestion("client_outsideUsProvince", "Province (Outside US)", "text", addressSection, 6),
    buildQuestion("client_outsideUsPostalCode", "Postal Code (Outside US)", "text", addressSection, 7),
    buildQuestion("client_outsideUsCountry", "Country (Outside US)", "text", addressSection, 8)
  );

  const lastEntrySection = "Most Recent Entry to US";
  questions.push(
    buildQuestion("client_dateOfLastArrival", "Date of Last Arrival", "date", lastEntrySection, 1, { required: true }),
    buildQuestion("client_placeOfLastArrival", "Place of Last Arrival", "text", lastEntrySection, 2, { required: true }),
    buildQuestion("client_i94Number", "I-94 Number", "text", lastEntrySection, 3, { required: true, canonicalPath: "applicant.i94Number" }),
    buildQuestion("client_passportNumber", "Passport Number", "text", lastEntrySection, 4, { required: true, canonicalPath: "applicant.passportNumber" }),
    buildQuestion("client_countryOfPassportIssuance", "Country of Passport Issuance", "text", lastEntrySection, 5, { required: true, canonicalPath: "applicant.passportCountry" }),
    buildQuestion("client_passportExpirationDate", "Passport Expiration Date", "date", lastEntrySection, 6, { required: true, canonicalPath: "applicant.passportExpirationDate" }),
    buildQuestion("client_currentNonimmigrantStatus", "Current Nonimmigrant Status", "text", lastEntrySection, 7, { required: true, canonicalPath: "applicant.currentVisaStatus" }),
    buildQuestion("client_expirationOfCurrentStatus", "Expiration Date of Current Status", "date", lastEntrySection, 8, { required: true, canonicalPath: "applicant.currentVisaExpiry" })
  );

  const eadTypeSection = "EAD Application Type (I-765)";
  const EAD_APPLICATION_TYPE_OPTIONS = [
    "New EAD Card",
    "Replacement of lost, stolen, or damaged EAD card",
    "Renewal of EAD card",
  ];
  questions.push(
    buildQuestion("client_eadApplicationType", "EAD Application Type — select only one", "radio", eadTypeSection, 1, { required: true, options: EAD_APPLICATION_TYPE_OPTIONS })
  );

  // Only shown/collected if the applicant is requesting that an SSN be
  // issued — same gating pattern as h4_ead_questionnaire above.
  const ssnSection = "Social Security Information";
  const wantsSsnGate = gate("client_wantsSsnIssued", "equals", "Yes");
  questions.push(
    buildQuestion("client_wantsSsnIssued", "Do you want the SSA to issue you a Social Security number?", "radio", ssnSection, 1, { required: true, options: ["Yes", "No"] }),
    buildQuestion("client_fatherFirstName", "Father's First Name", "text", ssnSection, 2, { conditionalLogic: wantsSsnGate }),
    buildQuestion("client_fatherLastName", "Father's Last Name", "text", ssnSection, 3, { conditionalLogic: wantsSsnGate }),
    buildQuestion("client_motherFirstName", "Mother's First Name", "text", ssnSection, 4, { conditionalLogic: wantsSsnGate }),
    buildQuestion("client_motherLastName", "Mother's Last Name", "text", ssnSection, 5, { conditionalLogic: wantsSsnGate })
  );

  const applicantDocsSection = "Applicant Documents";
  questions.push(
    documentQuestion("h4extead_doc_passport", "Copy of passport", applicantDocsSection, 1, { required: true, category: "identity" }),
    documentQuestion("h4extead_doc_i94", "Copy of I-94 record", applicantDocsSection, 2, { required: true, category: "identity" }),
    documentQuestion("h4extead_doc_ssn", "Copy of SSN, if any", applicantDocsSection, 3, { required: false, category: "identity" }),
    documentQuestion("h4extead_doc_driversLicenseOrStateId", "Copy of driver's license/state ID, if any", applicantDocsSection, 4, { required: false, category: "identity" }),
    documentQuestion("h4extead_doc_previousApprovalNotices", "Copy of all previous approval notices, if any", applicantDocsSection, 5, { required: false, category: "immigration" }),
    documentQuestion("h4extead_doc_previousEadCard", "Copy of previous EAD card, if any", applicantDocsSection, 6, { required: false, category: "immigration" }),
    documentQuestion("h4extead_doc_passportPhotos", "Two identical passport photographs (for EAD)", applicantDocsSection, 7, { required: true, category: "identity" }),
    documentQuestion("h4extead_doc_relationshipEvidence", "Evidence of relationship to H-1B holder (Marriage/Birth Certificate)", applicantDocsSection, 8, { required: true, category: "immigration" })
  );

  const h1bHolderDocsSection = "H-1B Holder Documents";
  questions.push(
    documentQuestion("h4extead_doc_h1bHolderPassport", "Copy of passport of H-1B holder", h1bHolderDocsSection, 1, { required: true, category: "identity" }),
    documentQuestion("h4extead_doc_h1bApprovalNoticeI797", "Copy of H-1B approval notice (I-797)", h1bHolderDocsSection, 2, { required: true, category: "immigration" }),
    documentQuestion("h4extead_doc_spouseI94", "Copy of spouse's I-94", h1bHolderDocsSection, 3, { required: true, category: "identity" }),
    documentQuestion("h4extead_doc_spouseI140ApprovalNotice", "Copy of I-140 approval notice of spouse", h1bHolderDocsSection, 4, { required: false, category: "immigration" }),
    documentQuestion("h4extead_doc_h1bHolderPaystubs3Months", "Copy of last 3 months' pay stubs of H-1B holder", h1bHolderDocsSection, 5, { required: true, category: "financial" }),
    documentQuestion("h4extead_doc_h1bHolderW2_2024", "Copy of W-2 for 2024 of H-1B holder", h1bHolderDocsSection, 6, { required: true, category: "financial" })
  );

  const sections = [personalSection, addressSection, lastEntrySection, eadTypeSection, ssnSection, applicantDocsSection, h1bHolderDocsSection];

  return {
    key: "h4_extension_ead_questionnaire",
    title: "H-4 Extension + EAD — Applicant Checklist",
    visaType: "H4EXTENSIONEAD",
    checklistRole: "client",
    isDefault: true,
    description: "",
    sections,
    questions,
  };
}

const H4_CHECKLIST_DEFINITIONS = [
  buildH4ExtensionQuestionnaire(),
  buildH4EadQuestionnaire(),
  buildH4ExtensionEadQuestionnaire(),
];

module.exports = { H4_CHECKLIST_DEFINITIONS };
