// Converts Form N-600's supplied questionnaire/checklist into a real
// Questionnaire/Question template definition, in the same shape as
// questionnaire.service.js's VISA_TEMPLATE_DEFINITIONS — mirrors
// n400Checklist.js's/n565Checklist.js's single-role ("client") conversion
// pattern EXACTLY (N-600 is completed by ONE applicant; the U.S.-citizen
// parent is an information/document SOURCE inside that same checklist, not
// a second checklist owner or a second login — see §7/§19 of the
// integration prompt), but is its own separate, self-contained file.
//
// CRITICAL — deliberately NOT isDefault, and NOT scoped to any real visa
// type, for the identical reason n400Checklist.js's file banner explains:
// N-600 is an OPTIONAL, visa-agnostic add-on process. It must only ever
// reach a client through an explicit Case.questionnaireReferences entry,
// created at the exact moment a Case Manager approves it via
// case.controller.js's approveN600Process — the SAME generalized pattern
// (Case-level approval flag + direct assignQuestionnaireIfNotActive +
// uscisFormService.ensureAssignedForms) approveN400Process already uses,
// not the VisaFormMapping CONDITIONAL/recordConditionalDecision mechanism
// (that one requires an exact caseData.visaType match — the wrong fit for
// a process attachable to a case of ANY visa type). visaType:"N600" below
// is a pseudo-value no real Case.visaType will ever equal — combined with
// isDefault:false, this is a double guarantee against the default-template
// auto-resolution path ever surfacing this checklist without an explicit
// staff approval action.
//
// N-600 already exists in the VisaFormMapping registry as its own
// dedicated AUTO_CREATE row under the "Certificate of Citizenship" case
// type (visaFormMappings.seed.js, pre-existing, untouched by this task) —
// exactly the same "already registered, just needed the add-on checklist
// wired up" situation N-400 was in under "Naturalization".
//
// Source: the supplied "Form N-600" document (Questionnaire §1-7 +
// Document Checklist). Every field label/document name below is verbatim
// from that source.

const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];
const VISIBILITY = { roles: ["client", ...STAFF_ROLES], portals: ["client", "admin"] };

const MARITAL_STATUS_OPTIONS = ["Single", "Married", "Divorced", "Widowed", "Annulled", "Separated"];
const IMMIGRATION_STATUS_OPTIONS = ["Lawful Permanent Resident / Green Card Holder", "Non-Immigrant", "Refugee/Asylee", "Other"];
const CITIZENSHIP_METHOD_OPTIONS = ["By Birth in USA", "By Birth Abroad to U.S. Citizen Parents", "By Naturalization"];
const SPOUSE_IMMIGRATION_STATUS_OPTIONS = ["U.S. Citizen", "Lawful Permanent Resident"];
const DISCHARGE_TYPE_OPTIONS = ["Honorable", "Other than Honorable", "Dishonorable"];

function slugSection(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function gate(questionKey, operator, value) {
  return { mode: "all", rules: [{ questionKey, operator, value }], groups: [] };
}
function anyGate(rules) {
  return { mode: "any", rules, groups: [] };
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

// Father's/Mother's citizenship-method + marital/spouse sub-block is
// IDENTICAL in structure between the two parents (source §5/§6) - built
// once here and invoked twice with a different prefix/label rather than
// hand-duplicated, so the two sections can never silently drift apart.
function buildParentSection(prefix, parentLabel, sectionTitle, startOrder) {
  const q = [];
  let order = startOrder;
  const p = (suffix) => `client_${prefix}_${suffix}`;

  q.push(
    buildQuestion(p("firstName"), `${parentLabel}'s First Name`, "text", sectionTitle, order++, { required: true }),
    buildQuestion(p("middleName"), `${parentLabel}'s Middle Name`, "text", sectionTitle, order++),
    buildQuestion(p("lastName"), `${parentLabel}'s Last Name`, "text", sectionTitle, order++, { required: true }),
    buildQuestion(p("dateOfBirth"), `${parentLabel}'s Date of Birth`, "date", sectionTitle, order++, { required: true }),
    buildQuestion(p("countryOfBirth"), `${parentLabel}'s Country of Birth`, "text", sectionTitle, order++, { required: true }),
    buildQuestion(p("countryOfCitizenship"), `${parentLabel}'s Country of Citizenship or Nationality`, "text", sectionTitle, order++, { required: true }),
    buildQuestion(p("ssn"), `${parentLabel}'s SSN`, "text", sectionTitle, order++),
    buildQuestion(p("physicalAddress"), `${parentLabel}'s Physical Address`, "text", sectionTitle, order++, { required: true })
  );

  const methodKey = p("citizenshipMethod");
  q.push(buildQuestion(methodKey, `How did ${parentLabel.toLowerCase()} become a U.S. Citizen?`, "select", sectionTitle, order++, { required: true, options: CITIZENSHIP_METHOD_OPTIONS }));

  const birthAbroadGate = gate(methodKey, "equals", "By Birth Abroad to U.S. Citizen Parents");
  q.push(
    buildQuestion(p("certOfCitizenshipNumber"), "Certificate of Citizenship Number", "text", sectionTitle, order++, { conditionalLogic: birthAbroadGate }),
    buildQuestion(p("birthAbroadANumber"), "A-Number (if any)", "text", sectionTitle, order++, { conditionalLogic: birthAbroadGate })
  );

  const naturalizationGate = gate(methodKey, "equals", "By Naturalization");
  q.push(
    buildQuestion(p("naturalizationPlace"), "Place of Naturalization (Name of Court or USCIS Office Location)", "text", sectionTitle, order++, { conditionalLogic: naturalizationGate }),
    buildQuestion(p("naturalizationCity"), "City/Town", "text", sectionTitle, order++, { conditionalLogic: naturalizationGate }),
    buildQuestion(p("naturalizationState"), "State", "text", sectionTitle, order++, { conditionalLogic: naturalizationGate }),
    buildQuestion(p("naturalizationCertNumber"), "Certificate of Naturalization Number", "text", sectionTitle, order++, { conditionalLogic: naturalizationGate }),
    buildQuestion(p("naturalizationANumber"), "A-Number (if any)", "text", sectionTitle, order++, { conditionalLogic: naturalizationGate }),
    buildQuestion(p("naturalizationDate"), "Date of Naturalization", "date", sectionTitle, order++, { conditionalLogic: naturalizationGate })
  );

  const maritalStatusKey = p("maritalStatus");
  q.push(
    buildQuestion(maritalStatusKey, `${parentLabel}'s Current Marital Status`, "select", sectionTitle, order++, { required: true, options: MARITAL_STATUS_OPTIONS }),
    buildQuestion(p("numberOfMarriages"), `How many times has ${parentLabel.toLowerCase()} been married (including annulled marriages and marriages to the same person)?`, "number", sectionTitle, order++, { required: true })
  );

  const marriedGate = gate(maritalStatusKey, "equals", "Married");
  const spousePrefix = `${prefix}Spouse`;
  const s = (suffix) => `client_${spousePrefix}_${suffix}`;
  q.push(
    buildQuestion(s("firstName"), `${parentLabel}'s Current Spouse — First Name`, "text", sectionTitle, order++, { conditionalLogic: marriedGate }),
    buildQuestion(s("middleName"), `${parentLabel}'s Current Spouse — Middle Name`, "text", sectionTitle, order++, { conditionalLogic: marriedGate }),
    buildQuestion(s("lastName"), `${parentLabel}'s Current Spouse — Last Name`, "text", sectionTitle, order++, { conditionalLogic: marriedGate }),
    buildQuestion(s("dateOfBirth"), `${parentLabel}'s Current Spouse — Date of Birth`, "date", sectionTitle, order++, { conditionalLogic: marriedGate }),
    buildQuestion(s("countryOfBirth"), `${parentLabel}'s Current Spouse — Country of Birth`, "text", sectionTitle, order++, { conditionalLogic: marriedGate }),
    buildQuestion(s("countryOfCitizenship"), `${parentLabel}'s Current Spouse — Country of Citizenship or Nationality`, "text", sectionTitle, order++, { conditionalLogic: marriedGate }),
    buildQuestion(s("physicalAddress"), `${parentLabel}'s Current Spouse — Physical Address`, "text", sectionTitle, order++, { conditionalLogic: marriedGate }),
    buildQuestion(s("marriageDate"), "Date of Marriage", "date", sectionTitle, order++, { conditionalLogic: marriedGate }),
    buildQuestion(s("marriagePlace"), "Place of Marriage (City, State & Country)", "text", sectionTitle, order++, { conditionalLogic: marriedGate }),
    buildQuestion(s("immigrationStatus"), "Spouse's Immigration Status", "select", sectionTitle, order++, { options: SPOUSE_IMMIGRATION_STATUS_OPTIONS, conditionalLogic: marriedGate })
  );

  const spouseIsOtherParentKey = prefix === "father" ? "client_fatherSpouseIsMother" : "client_motherSpouseIsFather";
  const spouseIsOtherParentLabel = prefix === "father"
    ? "Is your father's current spouse also your biological (or adopted) mother?"
    : "Is your mother's current spouse also your biological (or adopted) father?";
  q.push(buildQuestion(spouseIsOtherParentKey, spouseIsOtherParentLabel, "radio", sectionTitle, order++, { options: ["Yes", "No"], conditionalLogic: marriedGate }));

  return { questions: q, maritalStatusKey };
}

function buildN600Questionnaire() {
  const questions = [];

  // ── Section 1 — Applicant / Minor Child of U.S. Citizen ("Your Information") ──
  const applicantSection = "Your Information";
  questions.push(
    buildQuestion("client_lastName", "Last Name", "text", applicantSection, 1, { required: true, canonicalPath: "applicant.lastName" }),
    buildQuestion("client_firstName", "First Name", "text", applicantSection, 2, { required: true, canonicalPath: "applicant.firstName" }),
    buildQuestion("client_middleName", "Middle Name", "text", applicantSection, 3, { canonicalPath: "applicant.middleName" }),
    buildQuestion("client_otherNamesUsed", "Other Names Used (if any)", "text", applicantSection, 4),
    // Deliberately separate from the legal name above - "do not combine
    // the applicant's current legal name with the name shown on the Green
    // Card" (§8 of the integration prompt).
    buildQuestion("client_gcLastName", "Last Name as Shown on Green Card", "text", applicantSection, 5, { required: true }),
    buildQuestion("client_gcFirstName", "First Name as Shown on Green Card", "text", applicantSection, 6, { required: true }),
    buildQuestion("client_gcMiddleName", "Middle Name as Shown on Green Card", "text", applicantSection, 7),
    buildQuestion("client_gender", "Gender", "select", applicantSection, 8, { required: true, options: ["Male", "Female"], canonicalPath: "applicant.gender" }),
    buildQuestion("client_dateOfBirth", "Date of Birth", "date", applicantSection, 9, { required: true, canonicalPath: "applicant.dateOfBirth" }),
    buildQuestion("client_countryOfBirth", "Country of Birth", "text", applicantSection, 10, { required: true, canonicalPath: "applicant.countryOfBirth" }),
    buildQuestion("client_countryOfCitizenship", "Country of Citizenship/Nationality", "text", applicantSection, 11, { required: true }),
    buildQuestion("client_aNumber", "A-Number", "text", applicantSection, 12, { canonicalPath: "applicant.aNumber" }),
    buildQuestion("client_ssn", "SSN", "text", applicantSection, 13, { canonicalPath: "applicant.ssn" }),
    buildQuestion("client_height", "Height", "text", applicantSection, 14),
    buildQuestion("client_weight", "Weight (in pounds)", "text", applicantSection, 15),
    buildQuestion("client_eyeColor", "Eye Colour", "text", applicantSection, 16),
    buildQuestion("client_hairColor", "Hair Colour", "text", applicantSection, 17),
    buildQuestion("client_mailingAddress", "Mailing Address", "text", applicantSection, 18, { required: true }),
    buildQuestion("client_physicalAddress", "Physical Address (if different from Mailing Address)", "text", applicantSection, 19),
    buildQuestion("client_maritalStatus", "Your Current Marital Status", "select", applicantSection, 20, { required: true, options: MARITAL_STATUS_OPTIONS }),
    buildQuestion("client_armedForcesMember", "Are you a member or veteran of any branch of the U.S. Armed Forces?", "radio", applicantSection, 21, { required: true, options: ["Yes", "No"] })
  );

  // ── Section 2 — Admission into the United States ───────────────────────
  const admissionSection = "Your Admission and Immigration History";
  questions.push(
    buildQuestion("client_entryCity", "City or Town of Entry in the USA", "text", admissionSection, 1, { required: true }),
    buildQuestion("client_entryState", "State of Entry in the USA", "text", admissionSection, 2, { required: true }),
    buildQuestion("client_entryDate", "Date of Entry", "date", admissionSection, 3, { required: true }),
    buildQuestion("client_admissionPassportNumber", "Passport Number Used at Time of Admission", "text", admissionSection, 4, { required: true }),
    buildQuestion("client_passportIssuingCountry", "Country of Issuance of Passport", "text", admissionSection, 5, { required: true }),
    buildQuestion("client_passportIssueDate", "Date Passport was Issued", "date", admissionSection, 6, { required: true })
  );

  // ── Section 3 — Current Immigration Status ──────────────────────────────
  const statusKey = "client_immigrationStatus";
  questions.push(
    buildQuestion(statusKey, "Select Your Current Immigration Status", "select", admissionSection, 7, { required: true, options: IMMIGRATION_STATUS_OPTIONS }),
    buildQuestion("client_immigrationStatusOtherExplain", "Explain", "text", admissionSection, 8, { conditionalLogic: gate(statusKey, "equals", "Other") })
  );
  const lprGate = gate(statusKey, "equals", "Lawful Permanent Resident / Green Card Holder");
  const absentGate = gate("client_everAbsentFromUs", "equals", "Yes");
  questions.push(
    buildQuestion("client_dateBecameLpr", "Date You Became a Lawful Permanent Resident/Green Card Holder", "date", admissionSection, 9, { conditionalLogic: lprGate }),
    buildQuestion("client_lprGrantingOffice", "USCIS Office That Granted My LPR Status or Location Where I Was Admitted", "text", admissionSection, 10, { conditionalLogic: lprGate }),
    buildQuestion("client_previouslyAppliedCertOrPassport", "Have you previously applied for a Certificate of Citizenship or U.S. Passport?", "radio", admissionSection, 11, { options: ["Yes", "No"], conditionalLogic: lprGate }),
    buildQuestion("client_everAbandonedLpr", "Have you ever abandoned or lost your LPR status?", "radio", admissionSection, 12, { options: ["Yes", "No"], conditionalLogic: lprGate }),
    buildQuestion("client_everAbsentFromUs", "Have you been absent from the United States since you first arrived?", "radio", admissionSection, 13, { options: ["Yes", "No"], conditionalLogic: lprGate }),
    repeatingGroup("client_absenceHistory", "Absences from the United States", admissionSection, 14, [
      { key: "dateLeftUS", label: "Date You Left the USA", type: "date" },
      { key: "dateReturnedUS", label: "Date You Returned to the USA", type: "date" },
      { key: "placeOfEntryUponReturn", label: "Place of Entry Upon Return (City and State)", type: "text" },
    ], { conditionalLogic: absentGate }),
    buildQuestion("client_parentsMarriedAtBirth", "Were your parents married to each other when you were born (or adopted)?", "radio", admissionSection, 15, { required: true, options: ["Yes", "No"] }),
    buildQuestion("client_parentsMarriedAfterBirth", "Did your parents marry after you were born?", "radio", admissionSection, 16, { required: true, options: ["Yes", "No"] }),
    buildQuestion("client_residesInLegalPhysicalCustody", "Do you regularly reside in the United States in the legal and physical custody of your U.S. citizen parents?", "radio", admissionSection, 17, { required: true, options: ["Yes", "No"] })
  );

  // ── Section 4 — Adoption ────────────────────────────────────────────────
  const adoptionSection = "Adoption Information";
  const wasAdoptedGate = gate("client_wasAdopted", "equals", "Yes");
  const wasReAdoptedGate = gate("client_wasReAdopted", "equals", "Yes");
  questions.push(
    buildQuestion("client_wasAdopted", "Were you adopted?", "radio", adoptionSection, 1, { required: true, options: ["Yes", "No"] }),
    buildQuestion("client_adoption_place", "Place of Final Adoption (City, State & Country)", "text", adoptionSection, 2, { conditionalLogic: wasAdoptedGate }),
    buildQuestion("client_adoption_date", "Date of Adoption", "date", adoptionSection, 3, { conditionalLogic: wasAdoptedGate }),
    buildQuestion("client_adoption_legalCustodyDate", "Date Legal Custody Began", "date", adoptionSection, 4, { conditionalLogic: wasAdoptedGate }),
    buildQuestion("client_adoption_physicalCustodyDate", "Date Physical Custody Began", "date", adoptionSection, 5, { conditionalLogic: wasAdoptedGate }),
    buildQuestion("client_wasReAdopted", "Did you have to be re-adopted in the United States?", "radio", adoptionSection, 6, { options: ["Yes", "No"], conditionalLogic: wasAdoptedGate }),
    buildQuestion("client_reAdoption_place", "Place of Final Adoption (City, State & Country)", "text", adoptionSection, 7, { conditionalLogic: wasReAdoptedGate }),
    buildQuestion("client_reAdoption_date", "Date of Adoption", "date", adoptionSection, 8, { conditionalLogic: wasReAdoptedGate }),
    buildQuestion("client_reAdoption_legalCustodyDate", "Date Legal Custody Began", "date", adoptionSection, 9, { conditionalLogic: wasReAdoptedGate }),
    buildQuestion("client_reAdoption_physicalCustodyDate", "Date Physical Custody Began", "date", adoptionSection, 10, { conditionalLogic: wasReAdoptedGate })
  );

  // ── Section 5 — U.S.-Citizen Father / Section 6 — U.S.-Citizen Mother ──
  const fatherSection = "Your U.S. Citizen Parent's Information — Father";
  const motherSection = "Your U.S. Citizen Parent's Information — Mother";
  const father = buildParentSection("father", "Father", fatherSection, 1);
  const mother = buildParentSection("mother", "Mother", motherSection, 1);
  questions.push(...father.questions, ...mother.questions);

  // ── Section 7 — U.S.-Citizen Parent Physical Presence ───────────────────
  const presenceSection = "U.S. Citizen Parent's U.S. Residence History";
  const militaryGate = gate("client_parentServedMilitary", "equals", "Yes");
  questions.push(
    repeatingGroup("client_parentPhysicalPresence", "Dates Your U.S. Citizen Father or Mother Was Physically Present in the United States", presenceSection, 1, [
      { key: "parent", label: "Father or Mother", type: "select" },
      { key: "fromDate", label: "From", type: "date" },
      { key: "toDate", label: "To", type: "date" },
    ], { required: true, description: "Include all dates from your birth until the date you file Form N-600. Add as many entries as needed." }),
    buildQuestion("client_parentServedMilitary", "Has your U.S. citizen parent served in the U.S. Armed Forces?", "radio", presenceSection, 2, { required: true, options: ["Yes", "No"] }),
    buildQuestion("client_militaryServiceParent", "Who served in the U.S. Military?", "select", presenceSection, 3, { options: ["Father", "Mother"], conditionalLogic: militaryGate }),
    buildQuestion("client_militaryServiceStartDate", "Dates of Service — From", "date", presenceSection, 4, { conditionalLogic: militaryGate }),
    buildQuestion("client_militaryServiceEndDate", "Dates of Service — To", "date", presenceSection, 5, { conditionalLogic: militaryGate }),
    buildQuestion("client_militaryDischargeType", "Type of Discharge", "select", presenceSection, 6, { options: DISCHARGE_TYPE_OPTIONS, conditionalLogic: militaryGate })
  );

  // ── Document Checklist — Applicant ──────────────────────────────────────
  const applicantDocsSection = "Documents You Need to Provide";
  questions.push(
    documentQuestion("n600_doc_passportPhotos", "Two identical color passport-style photographs (2x2), taken within 30 days of filing", applicantDocsSection, 1, { required: true, category: "identity" }),
    documentQuestion("n600_doc_passportCopy", "Copy of Passport", applicantDocsSection, 2, { required: true, category: "identity" }),
    documentQuestion("n600_doc_ssnCard", "Copy of Social Security Card, if available", applicantDocsSection, 3, { required: false, category: "identity" }),
    documentQuestion("n600_doc_birthCertificate", "Copy of Birth Certificate", applicantDocsSection, 4, { required: true, category: "identity" }),
    documentQuestion("n600_doc_greenCardCopy", "Copy of Permanent Resident Card, if available", applicantDocsSection, 5, { required: false, category: "immigration" })
  );

  // ── Document Checklist — U.S.-Citizen Parent (§17/§18 - kept as
  // individual document items, never one generic "proof of physical
  // presence" upload) ──────────────────────────────────────────────────────
  const parentDocsSection = "Documents Needed From Your U.S. Citizen Parent";
  const fatherOrMotherMarriedGate = anyGate([
    { questionKey: father.maritalStatusKey, operator: "equals", value: "Married" },
    { questionKey: mother.maritalStatusKey, operator: "equals", value: "Married" },
  ]);
  const priorMarriageEndedGate = anyGate([
    { questionKey: father.maritalStatusKey, operator: "equals", value: "Divorced" },
    { questionKey: father.maritalStatusKey, operator: "equals", value: "Widowed" },
    { questionKey: father.maritalStatusKey, operator: "equals", value: "Annulled" },
    { questionKey: mother.maritalStatusKey, operator: "equals", value: "Divorced" },
    { questionKey: mother.maritalStatusKey, operator: "equals", value: "Widowed" },
    { questionKey: mother.maritalStatusKey, operator: "equals", value: "Annulled" },
  ]);
  // Legitimation only applies to an applicant born out-of-wedlock whose
  // father is the qualifying U.S. citizen parent, and only when that
  // out-of-wedlock status was never cured by the parents later marrying.
  const legitimationGate = { mode: "all", rules: [{ questionKey: "client_parentsMarriedAtBirth", operator: "equals", value: "No" }, { questionKey: "client_parentsMarriedAfterBirth", operator: "equals", value: "No" }], groups: [] };
  questions.push(
    documentQuestion("n600_doc_parentUsPassport", "Copy of U.S. Passport", parentDocsSection, 1, { required: true, category: "identity" }),
    documentQuestion("n600_doc_parentProofOfCitizenship", "Proof of U.S. Citizenship of one or both parents (Naturalization certificate or birth certificate)", parentDocsSection, 2, { required: true, category: "immigration" }),
    documentQuestion("n600_doc_parentMarriageCertificate", "Copy of Marriage Certificate of U.S. Citizen Parent", parentDocsSection, 3, { required: false, category: "immigration", conditionalLogic: fatherOrMotherMarriedGate }),
    documentQuestion("n600_doc_parentMarriageTerminationDocs", "Documents Showing the Marriage Termination (certified divorce decree, death certificate, or annulment document), if applicable", parentDocsSection, 4, { required: false, category: "immigration", conditionalLogic: priorMarriageEndedGate }),
    documentQuestion("n600_doc_legitimationProof", "Proof of Legitimation (only required if you were born out-of-wedlock and your father is your U.S. citizen parent)", parentDocsSection, 5, { required: false, category: "immigration", conditionalLogic: legitimationGate }),
    documentQuestion("n600_doc_driversLicenseOrStateId", "Copy of Driver's License or State Identification Card", parentDocsSection, 6, { required: true, category: "identity" }),
    documentQuestion("n600_doc_parentSsnCard", "Copy of SSN", parentDocsSection, 7, { required: true, category: "identity" }),
    documentQuestion("n600_doc_parentTaxReturns3Years", "Copy of Tax Returns for the Last 3 Years", parentDocsSection, 8, { required: true, category: "financial" }),
    // Physical-presence evidence - 5 separate items, per §17's explicit
    // "do not collapse these into one generic upload" instruction.
    documentQuestion("n600_doc_physicalPresence_schoolEmploymentMilitaryRecords", "Proof of Physical Presence: School, employment, or military records", parentDocsSection, 9, { required: false, category: "other" }),
    documentQuestion("n600_doc_physicalPresence_deedsMortgagesLeases", "Proof of Physical Presence: Deeds, mortgages, or leases showing residence", parentDocsSection, 10, { required: false, category: "other" }),
    documentQuestion("n600_doc_physicalPresence_churchUnionAttestations", "Proof of Physical Presence: Attestations by churches, unions, or other organizations", parentDocsSection, 11, { required: false, category: "other" }),
    documentQuestion("n600_doc_physicalPresence_ssaQuarterlyReports", "Proof of Physical Presence: U.S. Social Security quarterly reports", parentDocsSection, 12, { required: false, category: "other" }),
    documentQuestion("n600_doc_physicalPresence_thirdPartyAffidavits", "Proof of Physical Presence: Affidavits of third parties having knowledge of the residence and physical presence", parentDocsSection, 13, { required: false, category: "statement" })
  );

  const sections = [
    applicantSection, admissionSection, adoptionSection, fatherSection, motherSection, presenceSection,
    applicantDocsSection, parentDocsSection,
  ];

  return {
    key: "n600_checklist",
    // Client-facing - what the client portal actually renders as the
    // checklist title. Never "N-600 Application"/"Apply for N-600".
    title: "Certificate of Citizenship Checklist",
    // Pseudo visa type — see the file banner. Never matches a real
    // Case.visaType, and isDefault is false, so this template is reachable
    // ONLY through an explicit questionnaireReferences assignment (see
    // case.controller.js's approveN600Process).
    visaType: "N600",
    checklistRole: "client",
    isDefault: false,
    description: "",
    sections,
    questions,
  };
}

const N600_CHECKLIST_DEFINITION = buildN600Questionnaire();

module.exports = { N600_CHECKLIST_DEFINITION, MARITAL_STATUS_OPTIONS, IMMIGRATION_STATUS_OPTIONS, CITIZENSHIP_METHOD_OPTIONS };
