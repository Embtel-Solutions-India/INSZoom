// Converts Form N-565's supplied questionnaire/checklist into a real
// Questionnaire/Question template definition, in the same shape as
// questionnaire.service.js's VISA_TEMPLATE_DEFINITIONS — mirrors
// i131Checklist.js's single-role ("client") conversion pattern EXACTLY
// (N-565 has one applicant, no petitioner/beneficiary/employer/employee
// split), but is its own separate, self-contained file.
//
// CRITICAL — deliberately NOT isDefault, and NOT scoped to any real visa
// type, for the identical reason i131Checklist.js's file banner explains:
// N-565 is an OPTIONAL independent USCIS form under the Single Person
// category, not a visa type. It must only ever reach a client through an
// explicit Case.questionnaireReferences entry, created at the exact moment
// a Case Manager/Team Lead approves it via visaFormMapping.service.js's
// recordConditionalDecision (see that file's CONDITIONAL_FORM_CHECKLIST_KEYS
// map and ADD branch — N-565 is registered there exactly like I-131 is).
// visaType:"N565" below is a pseudo-value no real Case.visaType will ever
// equal — combined with isDefault:false, this is a double guarantee against
// the default-template auto-resolution path ever surfacing this checklist
// without an explicit staff approval action.
//
// The VisaFormMapping rows that make N-565 CONDITIONAL-offerable are
// registered under "Naturalization" and "Certificate of Citizenship" only
// (visaFormMappings.seed.js) — the two existing Single Person case types
// this document genuinely applies to (an existing naturalization/
// citizenship certificate holder needing a correction/replacement/update).
// Never registered under EB-1A/EB-2/EB-3/H-1B/L-1/family/employer-employee.
//
// Source: the supplied "Form N-565" document (Document Checklist +
// Questionnaire sections 1-7). Every field label/document name below is
// verbatim from that source. Section 3's "Reason to apply" multi-select is
// the authoritative driver for every conditional section/document below,
// exactly as the source specifies (§5 of the integration prompt).

const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];
const VISIBILITY = { roles: ["client", ...STAFF_ROLES], portals: ["client", "admin"] };

const APPLYING_FOR = {
  NEW_CERTIFICATE_OF_CITIZENSHIP: "NEW_CERTIFICATE_OF_CITIZENSHIP",
  NEW_CERTIFICATE_OF_NATURALIZATION: "NEW_CERTIFICATE_OF_NATURALIZATION",
  NEW_CERTIFICATE_OF_REPATRIATION: "NEW_CERTIFICATE_OF_REPATRIATION",
  NEW_DECLARATION_OF_INTENTION: "NEW_DECLARATION_OF_INTENTION",
  SPECIAL_CERTIFICATE_OF_NATURALIZATION: "SPECIAL_CERTIFICATE_OF_NATURALIZATION",
};
const APPLYING_FOR_OPTIONS = [
  { label: "New Certificate of Citizenship", value: APPLYING_FOR.NEW_CERTIFICATE_OF_CITIZENSHIP },
  { label: "New Certificate of Naturalization", value: APPLYING_FOR.NEW_CERTIFICATE_OF_NATURALIZATION },
  { label: "New Certificate of Repatriation", value: APPLYING_FOR.NEW_CERTIFICATE_OF_REPATRIATION },
  { label: "New Declaration of Intention", value: APPLYING_FOR.NEW_DECLARATION_OF_INTENTION },
  { label: "Special Certificate of Naturalization", value: APPLYING_FOR.SPECIAL_CERTIFICATE_OF_NATURALIZATION },
];

const REASON = {
  LOST_STOLEN_DESTROYED: "LOST_STOLEN_DESTROYED",
  MUTILATED: "MUTILATED",
  USCIS_ERROR: "USCIS_ERROR",
  NAME_CHANGE: "NAME_CHANGE",
  DOB_CHANGE: "DOB_CHANGE",
  GENDER_CHANGE: "GENDER_CHANGE",
};
const REASON_OPTIONS = [
  { label: "My certificate was Lost, Stolen or Destroyed", value: REASON.LOST_STOLEN_DESTROYED },
  { label: "My certificate was Mutilated", value: REASON.MUTILATED },
  { label: "My certificate has a typographical or clerical error made by USCIS", value: REASON.USCIS_ERROR },
  { label: "My name has changed legally", value: REASON.NAME_CHANGE },
  { label: "My date of birth has legally changed", value: REASON.DOB_CHANGE },
  { label: "My gender has changed legally", value: REASON.GENDER_CHANGE },
];

function slugSection(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

// reasonIncludes — the multi-select equivalent of i131Checklist.js's
// purposeIn: "reason" (client_reason) is a multi-select (checkbox-group),
// so the gate must check "does the selected array CONTAIN this value",
// not "does it equal this value" - "contains" is exactly what the
// conditionalLogic operator whitelist already supports.
function reasonIncludes(value) {
  return { mode: "all", rules: [{ questionKey: "client_reason", operator: "contains", value }], groups: [] };
}
function applyingForEquals(value) {
  return { mode: "all", rules: [{ questionKey: "client_applyingFor", operator: "equals", value }], groups: [] };
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
    metadata: { documentType, category: extras.category },
    visibility: VISIBILITY,
    conditionalLogic: extras.conditionalLogic,
  });
}

function buildN565Questionnaire() {
  const questions = [];

  // ── §1 — Information as mentioned on Naturalization/Citizenship Certificate ──
  const certSection = "Information as Mentioned on Naturalization/Citizenship Certificate";
  questions.push(
    buildQuestion("client_cert_lastName", "Last Name", "text", certSection, 1, { required: true }),
    buildQuestion("client_cert_firstName", "First Name", "text", certSection, 2, { required: true }),
    buildQuestion("client_cert_middleName", "Middle Name", "text", certSection, 3),
    buildQuestion("client_cert_dateOfBirth", "Date of Birth", "date", certSection, 4, { required: true }),
    buildQuestion("client_cert_countryOfPreviousCitizenship", "Country of Previous Citizenship", "text", certSection, 5, { required: true }),
    buildQuestion("client_cert_certificateNumber", "Certificate Number", "text", certSection, 6, { required: true }),
    buildQuestion("client_cert_aNumber", "Alien Registration Number (A-Number)", "text", certSection, 7, { required: true, canonicalPath: "applicant.aNumber" }),
    buildQuestion("client_cert_issuingOfficeOrCourt", "USCIS Office or Name of Court Where Certificate Was Issued", "text", certSection, 8, { required: true }),
    buildQuestion("client_cert_dateOfIssuance", "Date of Issuance", "date", certSection, 9, { required: true })
  );

  // ── §2 — Current Information About You ─────────────────────────────────
  const currentSection = "Current Information About You";
  const MARITAL_STATUS_OPTIONS = ["Single, Never Married", "Married", "Divorced", "Widowed", "Marriage Annulled"];
  questions.push(
    buildQuestion("client_current_lastName", "Last Name", "text", currentSection, 1, { required: true, canonicalPath: "applicant.lastName" }),
    buildQuestion("client_current_firstName", "First Name", "text", currentSection, 2, { required: true, canonicalPath: "applicant.firstName" }),
    buildQuestion("client_current_middleName", "Middle Name", "text", currentSection, 3, { canonicalPath: "applicant.middleName" }),
    buildQuestion("client_current_otherNamesUsed", "Other Names Used (if any)", "text", currentSection, 4),
    buildQuestion("client_current_mailingAddress", "Current Mailing Address", "text", currentSection, 5, { required: true }),
    buildQuestion("client_current_maritalStatus", "Your Current Marital Status", "select", currentSection, 6, { required: true, options: MARITAL_STATUS_OPTIONS }),
    buildQuestion("client_current_lostOrRenouncedCitizenship", "Since becoming a U.S. Citizen, have you lost or renounced your U.S. citizenship in any manner?", "radio", currentSection, 7, { required: true, options: ["Yes", "No"] })
  );

  // ── §3 — I am applying for / Reason (the two authoritative drivers) ────
  const applyingForSection = "I am applying for";
  questions.push(
    buildQuestion("client_applyingFor", "I am applying for", "select", applyingForSection, 1, { required: true, options: APPLYING_FOR_OPTIONS })
  );
  const reasonSection = "Reason to Apply for a New Certificate or Declaration";
  questions.push(
    buildQuestion("client_reason", "Reason to apply for a new Certificate or Declaration", "multiselect", reasonSection, 1, { required: true, options: REASON_OPTIONS })
  );

  // ── §4 — USCIS Typographical or Clerical Error (gated on REASON.USCIS_ERROR) ──
  const errorSection = "USCIS Typographical or Clerical Error";
  const errorGate = reasonIncludes(REASON.USCIS_ERROR);
  const ERROR_LOCATION_OPTIONS = ["Name", "Date of Birth", "Gender", "Other"];
  questions.push(
    buildQuestion("client_error_location", "Select where the typographical or clerical error is in your document", "select", errorSection, 1, { required: true, options: ERROR_LOCATION_OPTIONS, conditionalLogic: errorGate }),
    buildQuestion("client_error_correctName", "Correct Name", "text", errorSection, 2, { conditionalLogic: { mode: "all", rules: [{ questionKey: "client_error_location", operator: "equals", value: "Name" }], groups: [] } }),
    buildQuestion("client_error_correctDateOfBirth", "Correct Date of Birth", "date", errorSection, 3, { conditionalLogic: { mode: "all", rules: [{ questionKey: "client_error_location", operator: "equals", value: "Date of Birth" }], groups: [] } }),
    buildQuestion("client_error_correctGender", "Correct Gender", "text", errorSection, 4, { conditionalLogic: { mode: "all", rules: [{ questionKey: "client_error_location", operator: "equals", value: "Gender" }], groups: [] } }),
    buildQuestion("client_error_otherExplain", "Explain", "textarea", errorSection, 5, { conditionalLogic: { mode: "all", rules: [{ questionKey: "client_error_location", operator: "equals", value: "Other" }], groups: [] } })
  );

  // ── §4A — Legal Name Change (gated on REASON.NAME_CHANGE) ───────────────
  const nameChangeSection = "Legal Name Change";
  const nameChangeGate = reasonIncludes(REASON.NAME_CHANGE);
  questions.push(
    buildQuestion("client_nameChange_how", "Mention how your name changed (for example through Court Order, Marriage, Divorce)", "text", nameChangeSection, 1, { required: true, conditionalLogic: nameChangeGate }),
    buildQuestion("client_nameChange_dateOfEvent", "Date of Event", "date", nameChangeSection, 2, { required: true, conditionalLogic: nameChangeGate }),
    buildQuestion("client_nameChange_newLegalName", "New Legal Name", "text", nameChangeSection, 3, { required: true, conditionalLogic: nameChangeGate })
  );

  // ── §5 — Official Date of Birth Change (gated on REASON.DOB_CHANGE) ─────
  const dobChangeSection = "Official Date of Birth Change";
  const dobChangeGate = reasonIncludes(REASON.DOB_CHANGE);
  questions.push(
    buildQuestion("client_dobChange_how", "Mention how your Date of Birth changed (for example through Court Order, U.S. Government Issued Document)", "text", dobChangeSection, 1, { required: true, conditionalLogic: dobChangeGate }),
    buildQuestion("client_dobChange_dateOfDocument", "Date of Court Order or U.S. Government Document Issuance", "date", dobChangeSection, 2, { required: true, conditionalLogic: dobChangeGate }),
    buildQuestion("client_dobChange_newDateOfBirth", "New Date of Birth", "date", dobChangeSection, 3, { required: true, conditionalLogic: dobChangeGate })
  );

  // ── §6 — Official Gender Change (gated on REASON.GENDER_CHANGE) ─────────
  const genderChangeSection = "Official Gender Change";
  const genderChangeGate = reasonIncludes(REASON.GENDER_CHANGE);
  questions.push(
    buildQuestion("client_genderChange_how", "Mention how your gender officially changed (for example through Court Order, U.S. Government Issued Document, Licensed Health Care Professional's Certification of Gender)", "text", genderChangeSection, 1, { required: true, conditionalLogic: genderChangeGate }),
    buildQuestion("client_genderChange_currentGender", "Current Gender", "select", genderChangeSection, 2, { required: true, options: ["Male", "Female"], conditionalLogic: genderChangeGate })
  );

  // ── §7 — Special Certificate of Recognition (gated on APPLYING_FOR.SPECIAL_CERTIFICATE_OF_NATURALIZATION) ──
  const specialCertSection = "Special Certificate of Recognition";
  const specialCertGate = applyingForEquals(APPLYING_FOR.SPECIAL_CERTIFICATE_OF_NATURALIZATION);
  questions.push(
    buildQuestion("client_specialCert_foreignCountry", "Name of Foreign Country", "text", specialCertSection, 1, { required: true, conditionalLogic: specialCertGate }),
    buildQuestion("client_specialCert_officialLastName", "Last Name (of requesting foreign government official)", "text", specialCertSection, 2, { required: true, conditionalLogic: specialCertGate }),
    buildQuestion("client_specialCert_officialFirstName", "First Name (of requesting foreign government official)", "text", specialCertSection, 3, { required: true, conditionalLogic: specialCertGate }),
    buildQuestion("client_specialCert_officialMiddleName", "Middle Name (of requesting foreign government official)", "text", specialCertSection, 4, { conditionalLogic: specialCertGate }),
    buildQuestion("client_specialCert_governmentAgency", "Name of Government Agency", "text", specialCertSection, 5, { required: true, conditionalLogic: specialCertGate }),
    buildQuestion("client_specialCert_officerTitle", "Title of the Officer", "text", specialCertSection, 6, { required: true, conditionalLogic: specialCertGate }),
    buildQuestion("client_specialCert_officialAddress", "Address of the Official", "text", specialCertSection, 7, { required: true, conditionalLogic: specialCertGate })
  );

  // ── Documents Required — every item conditional exactly as the source
  // specifies (§3/§5 of the integration prompt); nothing shown as
  // mandatory that the source marks conditional. ──────────────────────────
  const docsSection = "Document Checklist";
  const lostStolenDestroyedGate = reasonIncludes(REASON.LOST_STOLEN_DESTROYED);
  questions.push(
    documentQuestion("n565_doc_passportPhotosOutsideUs", "Two identical passport-style photographs (if you live outside the United States)", docsSection, 1, { required: false, category: "identity" }),
    documentQuestion("n565_doc_originalCertificate", "Your original document or certificate (name, date of birth, or gender change)", docsSection, 2, {
      required: false, category: "identity",
      conditionalLogic: { mode: "any", rules: [{ questionKey: "client_reason", operator: "contains", value: REASON.NAME_CHANGE }, { questionKey: "client_reason", operator: "contains", value: REASON.DOB_CHANGE }, { questionKey: "client_reason", operator: "contains", value: REASON.GENDER_CHANGE }], groups: [] },
    }),
    documentQuestion("n565_doc_copyOfOriginalDocument", "A copy of the original document (replacement of a lost, stolen, or destroyed document)", docsSection, 3, { required: false, category: "identity", conditionalLogic: lostStolenDestroyedGate }),
    documentQuestion("n565_doc_policeReportOrSwornStatement", "A police report or a sworn statement (lost, stolen, or destroyed document)", docsSection, 4, { required: false, category: "other", conditionalLogic: lostStolenDestroyedGate }),
    documentQuestion("n565_doc_uscisErrorEvidence", "Evidence of a USCIS typographical or clerical error", docsSection, 5, { required: false, category: "immigration", conditionalLogic: errorGate }),
    documentQuestion("n565_doc_nameChangeEvidence", "Evidence of your legal name change", docsSection, 6, { required: false, category: "immigration", conditionalLogic: nameChangeGate }),
    documentQuestion("n565_doc_dobChangeEvidence", "Evidence of your legal date of birth change", docsSection, 7, { required: false, category: "immigration", conditionalLogic: dobChangeGate }),
    documentQuestion("n565_doc_genderChangeEvidence", "Evidence of your legal gender change", docsSection, 8, { required: false, category: "immigration", conditionalLogic: genderChangeGate }),
    documentQuestion("n565_doc_maritalStatusChangeEvidence", "Evidence of your marital status change (such as marriage certificate, divorce decree or death certificate)", docsSection, 9, { required: false, category: "immigration" }),
    documentQuestion("n565_doc_originalNaturalizationCertificate", "A copy of your original naturalization certificate (special certificate of naturalization)", docsSection, 10, { required: false, category: "immigration", conditionalLogic: specialCertGate })
  );

  const sections = [
    certSection, currentSection, applyingForSection, reasonSection,
    errorSection, nameChangeSection, dobChangeSection, genderChangeSection, specialCertSection,
    docsSection,
  ];

  return {
    key: "n565_checklist",
    title: "N-565 — Replacement Naturalization/Citizenship Document",
    // Pseudo visa type — see the file banner. Never matches a real
    // Case.visaType, and isDefault is false, so this template is reachable
    // ONLY through an explicit questionnaireReferences assignment (see
    // visaFormMapping.service.js's recordConditionalDecision).
    visaType: "N565",
    checklistRole: "client",
    isDefault: false,
    description: "",
    sections,
    questions,
  };
}

const N565_CHECKLIST_DEFINITION = buildN565Questionnaire();

module.exports = { N565_CHECKLIST_DEFINITION, APPLYING_FOR, REASON };
