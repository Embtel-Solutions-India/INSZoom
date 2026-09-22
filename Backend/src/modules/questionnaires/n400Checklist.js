// Converts Form N-400's supplied questionnaire/checklist into a real
// Questionnaire/Question template definition, in the same shape as
// questionnaire.service.js's VISA_TEMPLATE_DEFINITIONS — mirrors
// n565Checklist.js's/i131Checklist.js's single-role ("client") conversion
// pattern EXACTLY (N-400 has one applicant, no petitioner/beneficiary/
// employer/employee split), but is its own separate, self-contained file.
//
// CRITICAL — deliberately NOT isDefault, and NOT scoped to any real visa
// type, for the identical reason i131Checklist.js's/n565Checklist.js's file
// banners explain: N-400 is an OPTIONAL independent immigration process,
// not a visa type. It must only ever reach a client through an explicit
// Case.questionnaireReferences entry, created at the exact moment a Case
// Manager/Team Lead approves it via visaFormMapping.service.js's
// recordConditionalDecision (see that file's CONDITIONAL_FORM_CHECKLIST_KEYS
// map and ADD branch — N-400 is registered there exactly like I-131/N-565
// are). visaType:"N400" below is a pseudo-value no real Case.visaType will
// ever equal — combined with isDefault:false, this is a double guarantee
// against the default-template auto-resolution path ever surfacing this
// checklist without an explicit staff approval action.
//
// The VisaFormMapping row that makes N-400 CONDITIONAL-offerable is
// registered under a new, dedicated pseudo-visaType, "Naturalization
// Eligible" (visaFormMappings.seed.js) — deliberately NOT reusing the
// existing "Naturalization" pseudo-type (that one is its OWN dedicated,
// AUTO_CREATE case type for a case whose entire purpose IS filing N-400 -
// see n565Checklist.js's own note on "Replacement Citizenship Certificate"
// vs the CONDITIONAL N-565 add-on for the identical precedent). N-400 as an
// ADD-ON must be offerable to an existing case of ANY underlying visa type
// without hardcoding a per-visa branch (§2/§15 of the integration prompt)
// - "Naturalization Eligible" is a generic, visa-agnostic marker a Case
// Manager selects once eligibility is confirmed, exactly mirroring how
// "Action on Approved Case" (I-824) already works as a cross-visa,
// CM-initiated pseudo-category in this same registry.
//
// Source: the supplied "Form N-400" document (Document Checklist +
// Questionnaire sections 1-7). Every field label/document name below is
// verbatim from that source.

const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];
const VISIBILITY = { roles: ["client", ...STAFF_ROLES], portals: ["client", "admin"] };

const MARITAL_STATUS_OPTIONS = ["Single, Never Married", "Married", "Divorced", "Widowed", "Marriage Annulled", "Separated"];

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

function buildN400Questionnaire() {
  const questions = [];

  // ── Section 1 — Personal Information ───────────────────────────────────
  const personalSection = "Personal Information";
  questions.push(
    buildQuestion("client_lastName", "Family/Last Name", "text", personalSection, 1, { required: true, canonicalPath: "applicant.lastName" }),
    buildQuestion("client_firstName", "Given/First Name", "text", personalSection, 2, { required: true, canonicalPath: "applicant.firstName" }),
    buildQuestion("client_middleName", "Middle Name", "text", personalSection, 3, { canonicalPath: "applicant.middleName" }),
    buildQuestion("client_otherNamesUsed", "Other Names Used", "text", personalSection, 4),
    buildQuestion("client_nameOnGreenCard", "Name as Shown on Green Card", "text", personalSection, 5, { required: true }),
    buildQuestion("client_gender", "Gender", "select", personalSection, 6, { required: true, options: ["Male", "Female"], canonicalPath: "applicant.gender" }),
    buildQuestion("client_dateOfBirth", "Date of Birth", "date", personalSection, 7, { required: true, canonicalPath: "applicant.dateOfBirth" }),
    buildQuestion("client_countryOfBirth", "Country of Birth", "text", personalSection, 8, { required: true, canonicalPath: "applicant.countryOfBirth" }),
    buildQuestion("client_countryOfCitizenship", "Country of Citizenship/Nationality", "text", personalSection, 9, { required: true, canonicalPath: "applicant.countryOfCitizenship" }),
    buildQuestion("client_aNumber", "A-Number", "text", personalSection, 10, { required: true, canonicalPath: "applicant.aNumber" }),
    buildQuestion("client_dateBecameLpr", "Date Became a Lawful Permanent Resident", "date", personalSection, 11, { required: true }),
    buildQuestion("client_ssn", "Social Security Number", "text", personalSection, 12, { required: true, canonicalPath: "applicant.ssn" }),
    buildQuestion("client_uscisOnlineAccountNumber", "USCIS Online Account Number", "text", personalSection, 13),
    buildQuestion("client_mobileNumber", "Mobile Number", "text", personalSection, 14, { required: true }),
    buildQuestion("client_secondaryPhone", "Secondary Telephone", "text", personalSection, 15),
    buildQuestion("client_email", "Email", "text", personalSection, 16, { required: true }),
    buildQuestion("client_height", "Height", "text", personalSection, 17),
    buildQuestion("client_weight", "Weight", "text", personalSection, 18),
    buildQuestion("client_eyeColor", "Eye Color", "text", personalSection, 19),
    buildQuestion("client_hairColor", "Hair Color", "text", personalSection, 20),
    // Drives the passport-photo document requirement (§9's "Residing
    // outside USA? -> Show passport-photo requirement" example) — not in
    // the source's own field list but required to make that example's
    // document conditional on something structured rather than assumed.
    buildQuestion("client_residingOutsideUsa", "Are you currently residing outside the United States?", "radio", personalSection, 21, { required: true, options: ["Yes", "No"] })
  );

  // ── Section 2 — 5-Year Residential History (repeatable) ────────────────
  const residentialSection = "5-Year Residential History";
  questions.push(
    repeatingGroup("client_residentialHistory", "Residential History (last 5 years)", residentialSection, 1, [
      { key: "streetAndNumber", label: "Street and Number", type: "text" },
      { key: "city", label: "City", type: "text" },
      { key: "stateProvince", label: "State/Province", type: "text" },
      { key: "country", label: "Country", type: "text" },
      { key: "fromMonth", label: "From Month", type: "text" },
      { key: "fromYear", label: "From Year", type: "text" },
      { key: "toMonth", label: "To Month", type: "text" },
      { key: "toYear", label: "To Year", type: "text" },
    ], { required: true, description: "Add every address you have lived at during the last 5 years." })
  );

  // ── Section 3 — 5-Year Employment History (repeatable) ─────────────────
  const employmentSection = "5-Year Employment History";
  questions.push(
    repeatingGroup("client_employmentHistory", "Employment History (last 5 years)", employmentSection, 1, [
      { key: "employerName", label: "Employer Name", type: "text" },
      { key: "employerAddress", label: "Employer Address", type: "text" },
      { key: "occupation", label: "Occupation", type: "text" },
      { key: "fromMonth", label: "From Month", type: "text" },
      { key: "fromYear", label: "From Year", type: "text" },
      { key: "toMonth", label: "To Month", type: "text" },
      { key: "toYear", label: "To Year", type: "text" },
    ], { required: true, description: "Add every employer (including self-employment/unemployment/school) during the last 5 years." })
  );

  // ── Section 4 — Parents ──────────────────────────────────────────────────
  const parentsSection = "Parents";
  const fatherIsCitizenGate = gate("client_fatherIsUsCitizen", "equals", "Yes");
  const motherIsCitizenGate = gate("client_motherIsUsCitizen", "equals", "Yes");
  questions.push(
    buildQuestion("client_parentsMarriedBefore18", "Were your parents married before your 18th birthday?", "radio", parentsSection, 1, { required: true, options: ["Yes", "No"] }),
    buildQuestion("client_fatherIsUsCitizen", "Is your father a U.S. citizen?", "radio", parentsSection, 2, { required: true, options: ["Yes", "No"] }),
    buildQuestion("client_father_lastName", "Father's Last Name", "text", parentsSection, 3, { conditionalLogic: fatherIsCitizenGate }),
    buildQuestion("client_father_firstName", "Father's First Name", "text", parentsSection, 4, { conditionalLogic: fatherIsCitizenGate }),
    buildQuestion("client_father_middleName", "Father's Middle Name", "text", parentsSection, 5, { conditionalLogic: fatherIsCitizenGate }),
    buildQuestion("client_father_dateOfBirth", "Father's Date of Birth", "date", parentsSection, 6, { conditionalLogic: fatherIsCitizenGate }),
    buildQuestion("client_father_dateBecameUsCitizen", "Date Father Became a U.S. Citizen", "date", parentsSection, 7, { conditionalLogic: fatherIsCitizenGate }),
    buildQuestion("client_father_aNumber", "Father's A-Number", "text", parentsSection, 8, { conditionalLogic: fatherIsCitizenGate }),
    buildQuestion("client_motherIsUsCitizen", "Is your mother a U.S. citizen?", "radio", parentsSection, 9, { required: true, options: ["Yes", "No"] }),
    buildQuestion("client_mother_lastName", "Mother's Last Name", "text", parentsSection, 10, { conditionalLogic: motherIsCitizenGate }),
    buildQuestion("client_mother_firstName", "Mother's First Name", "text", parentsSection, 11, { conditionalLogic: motherIsCitizenGate }),
    buildQuestion("client_mother_middleName", "Mother's Middle Name", "text", parentsSection, 12, { conditionalLogic: motherIsCitizenGate }),
    buildQuestion("client_mother_dateOfBirth", "Mother's Date of Birth", "date", parentsSection, 13, { conditionalLogic: motherIsCitizenGate }),
    buildQuestion("client_mother_dateBecameUsCitizen", "Date Mother Became a U.S. Citizen", "date", parentsSection, 14, { conditionalLogic: motherIsCitizenGate }),
    buildQuestion("client_mother_aNumber", "Mother's A-Number", "text", parentsSection, 15, { conditionalLogic: motherIsCitizenGate })
  );

  // ── Section 5 — Time Outside the USA ────────────────────────────────────
  const travelSection = "Time Outside the USA";
  questions.push(
    buildQuestion("client_totalDaysOutsideUs5Years", "Total days outside the United States during the last 5 years", "number", travelSection, 1, { required: true }),
    buildQuestion("client_tripsOver24Hours", "Number of trips lasting 24 hours or longer", "number", travelSection, 2, { required: true }),
    repeatingGroup("client_travelHistory", "Travel History", travelSection, 3, [
      { key: "dateLeftUS", label: "Date Left the U.S.", type: "date" },
      { key: "dateReturnedUS", label: "Date Returned to the U.S.", type: "date" },
      { key: "tripLastedSixMonthsOrMore", label: "Did this trip last six months or more?", type: "radio" },
      { key: "countriesVisited", label: "Countries Visited", type: "text" },
      { key: "totalDaysOutsideUS", label: "Total Days Outside the U.S. (this trip)", type: "text" },
    ], { description: "Add every trip of 24 hours or longer taken during the last 5 years." })
  );

  // ── Section 6 — Marital History ─────────────────────────────────────────
  const maritalSection = "Marital History";
  const currentlyMarriedGate = gate("client_currentMaritalStatus", "equals", "Married");
  const everMarriedGate = gate("client_currentMaritalStatus", "not_equals", "Single, Never Married");
  const spouseIsCitizenGate = gate("client_spouseIsUsCitizen", "equals", "Yes");
  questions.push(
    buildQuestion("client_currentMaritalStatus", "Current Marital Status", "select", maritalSection, 1, { required: true, options: MARITAL_STATUS_OPTIONS }),
    buildQuestion("client_numberOfMarriages", "Number of Marriages", "number", maritalSection, 2, { required: true }),
    buildQuestion("client_spouseInArmedForces", "Is your current spouse a member of the U.S. armed forces?", "radio", maritalSection, 3, { options: ["Yes", "No"], conditionalLogic: currentlyMarriedGate }),
    buildQuestion("client_spouseIsUsCitizen", "Is your current spouse a U.S. citizen?", "radio", maritalSection, 4, { options: ["Yes", "No"], conditionalLogic: currentlyMarriedGate }),
    buildQuestion("client_spouse_lastName", "Current Spouse's Last Name", "text", maritalSection, 5, { conditionalLogic: spouseIsCitizenGate }),
    buildQuestion("client_spouse_firstName", "Current Spouse's First Name", "text", maritalSection, 6, { conditionalLogic: spouseIsCitizenGate }),
    buildQuestion("client_spouse_middleName", "Current Spouse's Middle Name", "text", maritalSection, 7, { conditionalLogic: spouseIsCitizenGate }),
    buildQuestion("client_spouse_previousLegalName", "Spouse's Previous Legal Name", "text", maritalSection, 8, { conditionalLogic: spouseIsCitizenGate }),
    buildQuestion("client_spouse_dateOfBirth", "Spouse's Date of Birth", "date", maritalSection, 9, { conditionalLogic: spouseIsCitizenGate }),
    buildQuestion("client_spouse_marriageDate", "Marriage Date", "date", maritalSection, 10, { conditionalLogic: spouseIsCitizenGate }),
    buildQuestion("client_spouse_currentAddress", "Spouse's Current Address", "text", maritalSection, 11, { conditionalLogic: spouseIsCitizenGate }),
    buildQuestion("client_spouse_employerCompany", "Spouse's Employer/Company", "text", maritalSection, 12, { conditionalLogic: spouseIsCitizenGate }),
    buildQuestion("client_spouse_dateBecameUsCitizen", "Date Spouse Became a U.S. Citizen", "date", maritalSection, 13, { conditionalLogic: spouseIsCitizenGate }),
    buildQuestion("client_spouse_howBecameUsCitizen", "How Spouse Became a U.S. Citizen", "text", maritalSection, 14, { conditionalLogic: spouseIsCitizenGate }),
    buildQuestion("client_spouse_numberOfMarriages", "Number of Times Spouse Has Been Married", "number", maritalSection, 15, { conditionalLogic: spouseIsCitizenGate })
  );

  // ── Section 7 — Children ─────────────────────────────────────────────────
  const childrenSection = "Children";
  questions.push(
    buildQuestion("client_totalNumberOfChildren", "Total Number of Children", "number", childrenSection, 1, { required: true }),
    repeatingGroup("client_children", "Children", childrenSection, 2, [
      { key: "lastName", label: "Last Name", type: "text" },
      { key: "firstName", label: "First Name", type: "text" },
      { key: "middleName", label: "Middle Name", type: "text" },
      { key: "dateOfBirth", label: "Date of Birth", type: "date" },
      { key: "currentAddress", label: "Current Address", type: "text" },
      { key: "relationshipToApplicant", label: "Relationship to Applicant", type: "text" },
    ], { description: "Add every child, regardless of age, marital status, or where they live." })
  );

  // ── Documents Required — every conditional item gated exactly as the
  // source specifies; core documents are unconditional (a Green Card
  // holder's basic identity/status set), never invented as mandatory
  // beyond what the source lists. ─────────────────────────────────────────
  const docsSection = "Document Checklist";
  questions.push(
    documentQuestion("n400_doc_passportPhotos", "Two passport-sized photos (only if residing outside the USA)", docsSection, 1, { required: false, category: "identity", conditionalLogic: gate("client_residingOutsideUsa", "equals", "Yes") }),
    documentQuestion("n400_doc_greenCardFrontBack", "Green Card — front and back", docsSection, 2, { required: true, category: "identity" }),
    documentQuestion("n400_doc_foreignPassport", "Foreign passport — all pages", docsSection, 3, { required: true, category: "identity" }),
    documentQuestion("n400_doc_driversLicenseOrStateId", "Driver's License / State ID, if applicable", docsSection, 4, { required: false, category: "identity" }),
    documentQuestion("n400_doc_ssnCard", "Social Security Card", docsSection, 5, { required: true, category: "identity" }),
    documentQuestion("n400_doc_taxReturns5Years", "Tax returns for the last 5 years", docsSection, 6, { required: true, category: "financial" }),

    documentQuestion("n400_doc_marriageCertificates", "Marriage certificate(s)", docsSection, 7, { required: false, category: "immigration", conditionalLogic: everMarriedGate }),
    documentQuestion("n400_doc_divorceDecrees", "Divorce decree(s)", docsSection, 8, { required: false, category: "immigration", conditionalLogic: everMarriedGate }),
    documentQuestion("n400_doc_annulmentCertificates", "Annulment certificate(s)", docsSection, 9, { required: false, category: "immigration", conditionalLogic: everMarriedGate }),
    documentQuestion("n400_doc_deathCertificates", "Death certificate(s)", docsSection, 10, { required: false, category: "immigration", conditionalLogic: everMarriedGate }),

    documentQuestion("n400_doc_evidenceSpouseCitizenship", "Evidence of spouse's U.S. citizenship", docsSection, 11, { required: true, category: "immigration", conditionalLogic: spouseIsCitizenGate }),
    documentQuestion("n400_doc_jointBankCreditStatements", "Joint bank/credit-card statements", docsSection, 12, { required: true, category: "financial", conditionalLogic: spouseIsCitizenGate }),
    documentQuestion("n400_doc_jointLeasesMortgages", "Joint leases/mortgages", docsSection, 13, { required: true, category: "financial", conditionalLogic: spouseIsCitizenGate }),
    documentQuestion("n400_doc_childrenBirthCertificates", "Children's birth certificates", docsSection, 14, { required: false, category: "identity", conditionalLogic: spouseIsCitizenGate }),
    documentQuestion("n400_doc_jointInsurancePolicies", "Joint insurance policies", docsSection, 15, { required: true, category: "financial", conditionalLogic: spouseIsCitizenGate }),
    documentQuestion("n400_doc_jointTaxReturns3Years", "Joint income tax returns/tax transcripts for the past three filing years", docsSection, 16, { required: true, category: "financial", conditionalLogic: spouseIsCitizenGate }),
    documentQuestion("n400_doc_spousePriorMarriageTerminationDocs", "U.S.-citizen spouse's prior marriage termination documents, if applicable", docsSection, 17, { required: false, category: "immigration", conditionalLogic: spouseIsCitizenGate })
  );

  const sections = [personalSection, residentialSection, employmentSection, parentsSection, travelSection, maritalSection, childrenSection, docsSection];

  return {
    key: "n400_checklist",
    // Client-facing - what the client portal actually renders as the
    // checklist title. Never "N-400 Application"/"Apply for N-400".
    title: "Naturalization / U.S. Citizenship Checklist",
    // Pseudo visa type — see the file banner. Never matches a real
    // Case.visaType, and isDefault is false, so this template is reachable
    // ONLY through an explicit questionnaireReferences assignment (see
    // visaFormMapping.service.js's recordConditionalDecision).
    visaType: "N400",
    checklistRole: "client",
    isDefault: false,
    description: "",
    sections,
    questions,
  };
}

const N400_CHECKLIST_DEFINITION = buildN400Questionnaire();

module.exports = { N400_CHECKLIST_DEFINITION, MARITAL_STATUS_OPTIONS };
