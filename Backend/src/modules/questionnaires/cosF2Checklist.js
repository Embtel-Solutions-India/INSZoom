// Converts the COS-to-F-2 filing type's supplied questionnaire/checklist
// ("BAIS CHECKLIST for COS to F2.docx") into a real Questionnaire/Question
// template definition, in the same shape as questionnaire.service.js's
// VISA_TEMPLATE_DEFINITIONS — mirrors h4Checklist.js's/sb1Checklist.js's
// single-party conversion pattern.
//
// This is a REAL, standalone, selectable case-creation visaType (COSF2 —
// see Backend/src/config/filingTypes.js's COS_F2 entry), exactly like
// H4EXTENSION/H4EAD/H4EXTENSIONEAD. isDefault:true, real visaType — the
// existing default-template auto-resolution in getQuestionnaireForCase
// surfaces it automatically the moment a case is created with visaType
// "COSF2".
//
// ONE COMBINED QUESTIONNAIRE, not three: per the governing task's own
// "COS Visa Architecture Rule" (COS is a transition/workflow type, not a
// case-party structure) and this task's explicit decision, the F-2
// applicant, the F-1 principal's document requirements, and the financial
// sponsor's information/documents are all sections of this ONE
// questionnaire, sent only to the F-2 applicant (checklistRole: "client")
// — there is no separate portal login/checklist assignment for the F-1
// principal or the financial sponsor. This deliberately does NOT follow
// family-workflow's one-questionnaire-per-role convention (petitioner/
// beneficiary/joint_sponsor each get their own) because there is no
// second/third portal user here to send a separate checklist to — the F-2
// applicant is responsible for coordinating and uploading everyone's
// documents.
//
// canonicalPath convention: reuses h4Checklist.js's/sb1Checklist.js's
// existing "applicant.*" canonicalPath convention AND, critically, the
// EXACT SAME question keys h4Checklist.js already uses for the identical
// concepts (client_familyName, client_ssn, client_uscisOnlineAccountNumber,
// client_dateOfLastArrival, etc.) — this is not incidental: it lets the
// existing i539-h4-crosswalk.js field-mapping (already seeded this
// session, keyed on these same canonicalPath/raw.questionnaireAnswers
// paths, not on visaType) autofill I-539 for a COS-to-F-2 case with zero
// new crosswalk file, since MappingResolver/FormMappingService resolve by
// canonical/question-key data, not by visaType. The F-1 principal's and
// financial sponsor's own fields are a genuinely different person's data —
// deliberately left WITHOUT a canonicalPath (no such person's canonical
// profile exists in this codebase; do not conflate their identity with the
// F-2 applicant's own person.*/applicant.* canonical fields).

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

function buildCosF2Questionnaire() {
  const questions = [];

  // ── F-2 Applicant: Information about You ──────────────────────────────
  const infoSection = "Information about You (F-2 Applicant)";
  questions.push(
    buildQuestion("client_familyName", "Family Name", "text", infoSection, 1, { required: true, canonicalPath: "applicant.lastName" }),
    buildQuestion("client_givenName", "Given Name", "text", infoSection, 2, { required: true, canonicalPath: "applicant.firstName" }),
    buildQuestion("client_middleName", "Middle Name", "text", infoSection, 3, { canonicalPath: "applicant.middleName" }),
    buildQuestion("client_aNumber", "A-Number, if any", "text", infoSection, 4, { canonicalPath: "applicant.aNumber" }),
    buildQuestion("client_uscisOnlineAccountNumber", "USCIS Online Account Number, if any", "text", infoSection, 5),
    buildQuestion("client_usMailingAddress", "US Mailing Address", "text", infoSection, 6, { required: true, canonicalPath: "applicant.mailingAddress" }),
    buildQuestion("client_usPhysicalAddress", "US Physical Address, if different from Mailing Address", "text", infoSection, 7, { canonicalPath: "applicant.physicalAddress" })
  );

  const otherInfoSection = "Other Information (F-2 Applicant)";
  questions.push(
    buildQuestion("client_countryOfBirth", "Country of Birth", "text", otherInfoSection, 1, { required: true, canonicalPath: "applicant.countryOfBirth" }),
    buildQuestion("client_countryOfCitizenship", "Country of Citizenship", "text", otherInfoSection, 2, { required: true, canonicalPath: "applicant.countryOfCitizenship" }),
    buildQuestion("client_dateOfBirth", "Date of Birth", "date", otherInfoSection, 3, { required: true, canonicalPath: "applicant.dateOfBirth" }),
    // SSN has no existing canonical path in this codebase — left unmapped.
    buildQuestion("client_ssn", "U.S. Social Security Number, if any", "text", otherInfoSection, 4),
    buildQuestion("client_daytimeTelephoneNumber", "Applicant's Daytime Telephone Number", "text", otherInfoSection, 5, { required: true, canonicalPath: "applicant.phone" }),
    buildQuestion("client_emailAddress", "Applicant's Email Address", "text", otherInfoSection, 6, { required: true, canonicalPath: "applicant.email" })
  );

  const lastEntrySection = "Most Recent Entry in USA";
  questions.push(
    buildQuestion("client_dateOfLastArrival", "Date of Last Arrival Into the United States", "date", lastEntrySection, 1, { required: true }),
    buildQuestion("client_i94Number", "I-94 Arrival-Departure Record Number", "text", lastEntrySection, 2, { required: true, canonicalPath: "applicant.i94Number" }),
    buildQuestion("client_passportNumber", "Passport Number", "text", lastEntrySection, 3, { required: true, canonicalPath: "applicant.passportNumber" }),
    buildQuestion("client_countryOfPassportIssuance", "Country of Passport Issuance", "text", lastEntrySection, 4, { required: true, canonicalPath: "applicant.passportCountry" }),
    buildQuestion("client_passportExpirationDate", "Passport Expiration Date", "date", lastEntrySection, 5, { required: true, canonicalPath: "applicant.passportExpirationDate" }),
    buildQuestion("client_currentNonimmigrantStatus", "Current Nonimmigrant Status (e.g. F-1 student, H-4 dependent, etc.)", "text", lastEntrySection, 6, { required: true, canonicalPath: "applicant.currentVisaStatus" }),
    buildQuestion("client_expirationOfCurrentStatus", "Expiration Date of Current Status", "date", lastEntrySection, 7, { required: true, canonicalPath: "applicant.currentVisaExpiry" })
  );

  // Physical Address Outside USA — component fields have no existing
  // canonical path, left unmapped (same as h4Checklist.js's equivalent).
  const outsideUsSection = "Physical Address Outside the USA";
  questions.push(
    buildQuestion("client_outsideUsStreetNumberName", "Street Number and Name", "text", outsideUsSection, 1),
    buildQuestion("client_outsideUsCityTown", "City or Town", "text", outsideUsSection, 2),
    buildQuestion("client_outsideUsState", "State", "text", outsideUsSection, 3),
    buildQuestion("client_outsideUsPostalCode", "Postal Code", "text", outsideUsSection, 4),
    buildQuestion("client_outsideUsProvince", "Province", "text", outsideUsSection, 5),
    buildQuestion("client_outsideUsCountry", "Country", "text", outsideUsSection, 6)
  );

  // Application Type — this filing type is always Change of Status (the
  // client entered the dedicated COS-to-F-2 workflow already), but the
  // source questionnaire's own application-type question and its "if
  // Change of Status" follow-ups are preserved verbatim per the task's
  // "do not silently remove source questions" rule, with Change of Status
  // pre-selected/expected rather than exposing Reinstatement/Extension as
  // meaningfully different destinations for this specific workflow.
  const appTypeSection = "Application Type";
  const APPLICATION_TYPE_OPTIONS = [
    "Reinstatement to student status",
    "An extension of stay in my current status",
    "Change of status",
  ];
  const changeOfStatusGate = gate("client_applicationType", "equals", "Change of status");
  questions.push(
    buildQuestion("client_applicationType", "Application Type — select only one", "radio", appTypeSection, 1, { required: true, options: APPLICATION_TYPE_OPTIONS, metadata: { defaultValue: "Change of status" } }),
    buildQuestion("client_changeOfStatusNewStatusAndDate", "New Status and Effective Date of Change", "text", appTypeSection, 2, { conditionalLogic: changeOfStatusGate }),
    buildQuestion("client_changeOfStatusRequested", "The Change of Status I am Requesting", "textarea", appTypeSection, 3, { conditionalLogic: changeOfStatusGate })
  );

  // ── F-2 Applicant's relationship to the F-1 principal ──────────────────
  // Drives the marriage-certificate document below (source lists it as
  // "if any" generically; relationship=Spouse is the real-world condition
  // that makes it apply — birth certificate stays unconditionally required
  // either way, per the source, so no separate gate is needed for it).
  const relationshipSection = "F-1 Principal Information";
  const spouseRelationshipGate = gate("client_relationshipToF1Principal", "equals", "Spouse");
  questions.push(
    buildQuestion("client_relationshipToF1Principal", "Your Relationship to the F-1 Student", "radio", relationshipSection, 1, { required: true, options: ["Spouse", "Child"] }),
    buildQuestion("client_f1PrincipalFullName", "F-1 Student's Full Name", "text", relationshipSection, 2, { required: true })
  );

  // ── F-2 Applicant Document Checklist ───────────────────────────────────
  const applicantDocsSection = "Documents Required from Applicant";
  questions.push(
    documentQuestion("cosf2_doc_passportAndI94", "Copy of passport and I-94", applicantDocsSection, 1, { required: true, category: "identity" }),
    documentQuestion("cosf2_doc_approvalNotices", "Copy of all I-797 approval notices, if any", applicantDocsSection, 2, { required: false, category: "immigration" }),
    documentQuestion("cosf2_doc_birthCertificate", "Copy of the Birth Certificate", applicantDocsSection, 3, { required: true, category: "identity" }),
    documentQuestion("cosf2_doc_marriageCertificate", "Copy of Marriage Certificate, if any", applicantDocsSection, 4, { required: false, category: "identity", classification: "conditional", conditionalLogic: spouseRelationshipGate }),
    documentQuestion("cosf2_doc_i20F2Notice", "Copy of I-20/F-2 Notice from the College/University", applicantDocsSection, 5, { required: true, category: "immigration" })
  );

  // ── Documents from the F-1 Visa Holder Spouse/Parent (the principal) ───
  const f1PrincipalDocsSection = "Documents from the F-1 Visa Holder Spouse/Parent";
  questions.push(
    documentQuestion("cosf2_doc_f1PrincipalPassportAndI94", "Copy of passport and I-94 (F-1 principal)", f1PrincipalDocsSection, 1, { required: true, category: "identity" }),
    documentQuestion("cosf2_doc_f1PrincipalApprovalNotices", "Copy of all I-797 approval notices, if any (F-1 principal)", f1PrincipalDocsSection, 2, { required: false, category: "immigration" }),
    documentQuestion("cosf2_doc_f1PrincipalI20Notice", "Copy of I-20/F-1 Notice from the College/University", f1PrincipalDocsSection, 3, { required: true, category: "immigration" }),
    documentQuestion("cosf2_doc_f1PrincipalAcceptanceLetter", "Acceptance Letter from the College/University", f1PrincipalDocsSection, 4, { required: true, category: "immigration" }),
    documentQuestion("cosf2_doc_f1PrincipalTranscripts", "Copy of Recent Academic Transcripts from the US College/University", f1PrincipalDocsSection, 5, { required: true, category: "immigration" }),
    documentQuestion("cosf2_doc_f1PrincipalEad", "Copy of EAD, if any (F-1 principal)", f1PrincipalDocsSection, 6, { required: false, category: "immigration" }),
    documentQuestion("cosf2_doc_f1PrincipalSsn", "Copy of SSN, if any (F-1 principal)", f1PrincipalDocsSection, 7, { required: false, category: "identity" }),
    documentQuestion("cosf2_doc_f1PrincipalDriversLicense", "Copy of Driver's License or State Identification Card, if any (F-1 principal)", f1PrincipalDocsSection, 8, { required: false, category: "identity" })
  );

  // ── Information About the Sponsor ──────────────────────────────────────
  // A genuinely different person's data — deliberately NOT mapped to the
  // F-2 applicant's own "applicant.*" canonical namespace (see file
  // banner). No canonical profile exists for a financial sponsor in this
  // codebase; left as plain, unmapped fields.
  const sponsorInfoSection = "Information About the Sponsor";
  questions.push(
    buildQuestion("client_sponsorFamilyName", "Sponsor Family Name", "text", sponsorInfoSection, 1, { required: true }),
    buildQuestion("client_sponsorGivenName", "Sponsor Given Name", "text", sponsorInfoSection, 2, { required: true }),
    buildQuestion("client_sponsorANumber", "Sponsor A-Number, if any", "text", sponsorInfoSection, 3),
    buildQuestion("client_sponsorUsMailingAddress", "Sponsor US Mailing Address", "text", sponsorInfoSection, 4, { required: true }),
    buildQuestion("client_sponsorUsPhysicalAddress", "Sponsor US Physical Address, if different from Mailing Address", "text", sponsorInfoSection, 5),
    buildQuestion("client_sponsorCountryOfBirth", "Sponsor Country of Birth", "text", sponsorInfoSection, 6, { required: true }),
    buildQuestion("client_sponsorCountryOfCitizenship", "Sponsor Country of Citizenship", "text", sponsorInfoSection, 7, { required: true }),
    buildQuestion("client_sponsorDateOfBirth", "Sponsor Date of Birth", "date", sponsorInfoSection, 8, { required: true }),
    buildQuestion("client_sponsorSsn", "Sponsor U.S. Social Security Number, if any", "text", sponsorInfoSection, 9),
    buildQuestion("client_sponsorDaytimeTelephoneNumber", "Sponsor Daytime Telephone Number", "text", sponsorInfoSection, 10, { required: true }),
    buildQuestion("client_sponsorEmailAddress", "Sponsor Email Address", "text", sponsorInfoSection, 11, { required: true })
  );

  const sponsorEmploymentSection = "Sponsor Employment Information";
  questions.push(
    buildQuestion("client_sponsorEmployerName", "Present Employer Name", "text", sponsorEmploymentSection, 1, { required: true }),
    buildQuestion("client_sponsorEmployerAddress", "Present Employer Full Address", "text", sponsorEmploymentSection, 2, { required: true }),
    buildQuestion("client_sponsorAnnualIncome", "Current Annual Income (in USD)", "currency", sponsorEmploymentSection, 3, { required: true }),
    buildQuestion("client_sponsorBankBalance", "Bank Balance (in USD)", "currency", sponsorEmploymentSection, 4, { required: true }),
    buildQuestion("client_sponsorOtherAssetsValue", "Other Assets Value (in USD)", "currency", sponsorEmploymentSection, 5)
  );

  // ── Documents Required from the Sponsor ────────────────────────────────
  const sponsorDocsSection = "Documents Required from the Sponsor";
  questions.push(
    documentQuestion("cosf2_doc_sponsorTaxReturns", "Copy of Tax Returns for the Most Recent Year", sponsorDocsSection, 1, { required: true, category: "financial" }),
    documentQuestion("cosf2_doc_sponsorPaystubs3Months", "Copy of Paystubs for Last 3 Months", sponsorDocsSection, 2, { required: true, category: "financial" }),
    documentQuestion("cosf2_doc_sponsorBankStatements3Months", "Copy of Bank Statements for Last 3 Months", sponsorDocsSection, 3, { required: true, category: "financial" })
  );

  // Conditional: only shown/collected if the sponsor is inside the USA
  // (task spec §14/§15 — a real conditional rule, not documents merely
  // marked optional while always displayed).
  const sponsorInsideUsaGate = gate("client_sponsorInsideUsa", "equals", "Yes");
  questions.push(
    buildQuestion("client_sponsorInsideUsa", "Is the Financial Sponsor Currently Inside the United States?", "radio", sponsorDocsSection, 4, { required: true, options: ["Yes", "No"] }),
    documentQuestion("cosf2_doc_sponsorProofOfUsStatus", "Proof of US Status (e.g. green card, Citizenship certificate, I-797 Approval notice, etc.)", sponsorDocsSection, 5, { required: false, category: "immigration", classification: "conditional", conditionalLogic: sponsorInsideUsaGate }),
    documentQuestion("cosf2_doc_sponsorPassport", "Copy of Passport (Sponsor)", sponsorDocsSection, 6, { required: false, category: "identity", classification: "conditional", conditionalLogic: sponsorInsideUsaGate }),
    documentQuestion("cosf2_doc_sponsorDriversLicense", "Copy of Driver's License (Sponsor)", sponsorDocsSection, 7, { required: false, category: "identity", classification: "conditional", conditionalLogic: sponsorInsideUsaGate }),
    documentQuestion("cosf2_doc_sponsorSsnCard", "Copy of SSN (Sponsor)", sponsorDocsSection, 8, { required: false, category: "identity", classification: "conditional", conditionalLogic: sponsorInsideUsaGate }),
    documentQuestion("cosf2_doc_sponsorW2", "Copy of W-2 for the Year 2023 (Sponsor)", sponsorDocsSection, 9, { required: false, category: "financial", classification: "conditional", conditionalLogic: sponsorInsideUsaGate })
  );

  const sections = [
    infoSection, otherInfoSection, lastEntrySection, outsideUsSection, appTypeSection,
    relationshipSection, applicantDocsSection, f1PrincipalDocsSection,
    sponsorInfoSection, sponsorEmploymentSection, sponsorDocsSection,
  ];

  return {
    key: "cos_f2_questionnaire",
    title: "Change of Status to F-2 — Applicant Checklist",
    visaType: "COSF2",
    checklistRole: "client",
    isDefault: true,
    description: "",
    sections,
    questions,
  };
}

const COS_F2_CHECKLIST_DEFINITIONS = [buildCosF2Questionnaire()];

module.exports = { COS_F2_CHECKLIST_DEFINITIONS };
