// Converts the supplied "Change of Status to F-1" questionnaire/checklist
// into ONE real Questionnaire template record — COS_TO_F1
// (cos_f1_questionnaire, visaType COSF1) — mirroring cosB1B2Checklist.js's/
// cosF2Checklist.js's single-party, single-combined-questionnaire pattern.
//
// This is a REAL, standalone, selectable case-creation visaType (COSF1 —
// see filingTypes.js's pre-existing COS_F1 entry, fromStatus:null so it
// already accepts ANY current status), isDefault:true — surfaced
// automatically via getQuestionnaireForCase's existing default-template
// matching, exactly like every other single-party filing checklist.
//
// "Current status remains dynamic": Current Nonimmigrant Status is a
// free-text question (same as every other COS checklist this session), not
// restricted to any specific source visa — B-2/H-1B/H-4/L-1/F-2/etc. all
// use this exact same checklist and VisaFormMapping (COSF1), never a
// per-source-visa variant.
//
// Financial sponsor: per the governing task's own explicit fallback ("if
// the existing participants[] architecture requires a separate record, use
// it — otherwise keep the sponsor information as case/questionnaire data"),
// this keeps the sponsor as plain questionnaire fields (no participants[]
// entry, no second checklistRole, no invite) — identical precedent to
// cosF2Checklist.js's own financial-sponsor section, since nothing in this
// checklist's flow requires the sponsor to log in or have a separate
// checklist assignment. Sponsor fields are deliberately NOT mapped onto the
// applicant's own "applicant.*" canonical namespace (distinct person).
//
// canonicalPath convention: reuses the exact same "applicant.*" canonical
// paths and question keys as h4Checklist.js/cosF2Checklist.js/
// cosB1B2Checklist.js for identical concepts, so the existing
// i539-h4-crosswalk.js autofill crosswalk (keyed on canonical paths/
// question keys, not visaType) also autofills these I-539 CaseForms with
// zero new crosswalk file.

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

function buildCosF1Questionnaire() {
  const questions = [];

  // ── Section 1 — Information About You ───────────────────────────────────
  const infoSection = "Information About You";
  const usPhysicalDifferentGate = gate("client_usPhysicalAddressDiffers", "equals", "Yes");
  questions.push(
    buildQuestion("client_familyName", "Family Name (Last Name)", "text", infoSection, 1, { required: true, canonicalPath: "applicant.lastName" }),
    buildQuestion("client_givenName", "Given Name (First Name)", "text", infoSection, 2, { required: true, canonicalPath: "applicant.firstName" }),
    buildQuestion("client_middleName", "Middle Name", "text", infoSection, 3, { canonicalPath: "applicant.middleName" }),
    buildQuestion("client_aNumber", "Alien Registration Number (A-Number), if any", "text", infoSection, 4, { canonicalPath: "applicant.aNumber" }),
    buildQuestion("client_uscisOnlineAccountNumber", "USCIS Online Account Number, if any", "text", infoSection, 5),
    buildQuestion("client_usMailingAddress", "U.S. Mailing Address", "text", infoSection, 6, { required: true, canonicalPath: "applicant.mailingAddress" }),
    buildQuestion("client_usPhysicalAddressDiffers", "Is your U.S. Physical Address different from your Mailing Address?", "radio", infoSection, 7, { required: true, options: ["Yes", "No"] }),
    buildQuestion("client_usPhysicalAddress", "U.S. Physical Address (If different from Mailing Address)", "text", infoSection, 8, { conditionalLogic: usPhysicalDifferentGate, canonicalPath: "applicant.physicalAddress" }),
    buildQuestion("client_countryOfBirth", "Country of Birth", "text", infoSection, 9, { required: true, canonicalPath: "applicant.countryOfBirth" }),
    buildQuestion("client_countryOfCitizenship", "Country of Citizenship", "text", infoSection, 10, { required: true, canonicalPath: "applicant.countryOfCitizenship" }),
    buildQuestion("client_dateOfBirth", "Date of Birth", "date", infoSection, 11, { required: true, canonicalPath: "applicant.dateOfBirth" }),
    // SSN has no existing canonical path in this codebase — left unmapped.
    buildQuestion("client_ssn", "U.S. Social Security Number, if any", "text", infoSection, 12),
    buildQuestion("client_daytimeTelephoneNumber", "Applicant's Daytime Telephone Number", "text", infoSection, 13, { required: true, canonicalPath: "applicant.phone" }),
    buildQuestion("client_emailAddress", "Applicant's Email Address", "email", infoSection, 14, { required: true, canonicalPath: "applicant.email" })
  );

  // ── Section 2 — Most Recent Entry into the United States ────────────────
  const lastEntrySection = "Most Recent Entry into the United States";
  questions.push(
    buildQuestion("client_dateOfLastArrival", "Date of Last Arrival into the United States", "date", lastEntrySection, 1, { required: true }),
    buildQuestion("client_i94Number", "I-94 Arrival-Departure Record Number", "text", lastEntrySection, 2, { required: true, canonicalPath: "applicant.i94Number" }),
    buildQuestion("client_passportNumber", "Passport Number", "text", lastEntrySection, 3, { required: true, canonicalPath: "applicant.passportNumber" }),
    buildQuestion("client_countryOfPassportIssuance", "Country of Passport Issuance", "text", lastEntrySection, 4, { required: true, canonicalPath: "applicant.passportCountry" }),
    buildQuestion("client_passportExpirationDate", "Passport Expiration Date", "date", lastEntrySection, 5, { required: true, canonicalPath: "applicant.passportExpirationDate" }),
    // Architecture rule (source's own instruction): free-text, populates
    // currentVisa/currentStatus — never hardcoded to H-1B/B-2/F-1/etc., so
    // the SAME checklist supports B-2->F-1, H-1B->F-1, H-4->F-1, L-1->F-1,
    // F-2->F-1, and every other supported source status.
    buildQuestion("client_currentNonimmigrantStatus", "Current Non-immigrant Status (e.g. F-1 student, H-4 dependent, etc.)", "text", lastEntrySection, 6, { required: true, canonicalPath: "applicant.currentVisaStatus" }),
    buildQuestion("client_expirationOfCurrentStatus", "Expiration Date of Current Status", "date", lastEntrySection, 7, { required: true, canonicalPath: "applicant.currentVisaExpiry" })
  );

  // ── Section 3 — Foreign Address ──────────────────────────────────────────
  const foreignAddressSection = "Foreign Address";
  questions.push(
    buildQuestion("client_foreignStreetNumberName", "Street Number and Name", "text", foreignAddressSection, 1, { required: true }),
    buildQuestion("client_foreignCityTown", "City or Town", "text", foreignAddressSection, 2, { required: true }),
    buildQuestion("client_foreignState", "State", "text", foreignAddressSection, 3),
    buildQuestion("client_foreignPostalCode", "Postal Code", "text", foreignAddressSection, 4, { required: true }),
    buildQuestion("client_foreignProvince", "Province", "text", foreignAddressSection, 5),
    buildQuestion("client_foreignCountry", "Country", "text", foreignAddressSection, 6, { required: true })
  );

  // ── Section 4 — Change of Status to F-1 ─────────────────────────────────
  // The destination is fixed by this checklist (task's own instruction: "Do
  // not make the client select B-1/B-2/etc. from this checklist") —
  // requestedNewStatus is locked to "F-1", never an open choice; the
  // effective date remains a genuine client-entered field.
  const cosSection = "Change of Status to F-1";
  questions.push(
    buildQuestion("client_requestedNewStatus", "Requested New Status", "text", cosSection, 1, {
      required: true,
      metadata: { defaultValue: "F-1", locked: true },
      description: "Fixed by this checklist — Change of Status to F-1.",
    }),
    buildQuestion("client_requestedEffectiveDate", "New Status Effective Date of Change", "date", cosSection, 2, { required: true }),
    buildQuestion("client_changeOfStatusRequested", "The Change of Status I am Requesting", "select", cosSection, 3, {
      required: true,
      options: ["F-1 Student Status"],
      metadata: { defaultValue: "F-1 Student Status", locked: true },
    })
  );

  // ── Section 5 — Financial Sponsor ────────────────────────────────────────
  // A genuinely different person's data — deliberately NOT mapped onto the
  // applicant's own "applicant.*" canonical namespace (see file banner).
  const sponsorInfoSection = "Financial Sponsor";
  const sponsorPhysicalDifferentGate = gate("client_sponsorUsPhysicalAddressDiffers", "equals", "Yes");
  questions.push(
    buildQuestion("client_sponsorFamilyName", "Sponsor Family Name (Last Name)", "text", sponsorInfoSection, 1, { required: true }),
    buildQuestion("client_sponsorGivenName", "Sponsor Given Name (First Name)", "text", sponsorInfoSection, 2, { required: true }),
    buildQuestion("client_sponsorANumber", "Sponsor Alien Registration Number (A-Number), if any", "text", sponsorInfoSection, 3),
    buildQuestion("client_sponsorUsMailingAddress", "Sponsor U.S. Mailing Address", "text", sponsorInfoSection, 4, { required: true }),
    buildQuestion("client_sponsorUsPhysicalAddressDiffers", "Is the sponsor's U.S. Physical Address different from their Mailing Address?", "radio", sponsorInfoSection, 5, { required: true, options: ["Yes", "No"] }),
    buildQuestion("client_sponsorUsPhysicalAddress", "Sponsor U.S. Physical Address (If different from Mailing Address)", "text", sponsorInfoSection, 6, { conditionalLogic: sponsorPhysicalDifferentGate }),
    buildQuestion("client_sponsorCountryOfBirth", "Sponsor Country of Birth", "text", sponsorInfoSection, 7, { required: true }),
    buildQuestion("client_sponsorCountryOfCitizenship", "Sponsor Country of Citizenship", "text", sponsorInfoSection, 8, { required: true }),
    buildQuestion("client_sponsorDateOfBirth", "Sponsor Date of Birth", "date", sponsorInfoSection, 9, { required: true }),
    buildQuestion("client_sponsorSsn", "Sponsor U.S. Social Security Number, if any", "text", sponsorInfoSection, 10),
    buildQuestion("client_sponsorDaytimeTelephoneNumber", "Sponsor Daytime Telephone Number", "text", sponsorInfoSection, 11, { required: true }),
    buildQuestion("client_sponsorEmailAddress", "Sponsor Email Address", "email", sponsorInfoSection, 12, { required: true })
  );

  // ── Section 6 — Sponsor Financial Information ───────────────────────────
  const sponsorFinancialSection = "Sponsor Financial Information";
  questions.push(
    buildQuestion("client_sponsorEmployerName", "Present Employer Name", "text", sponsorFinancialSection, 1, { required: true }),
    buildQuestion("client_sponsorEmployerAddress", "Present Employer Full Address", "text", sponsorFinancialSection, 2, { required: true }),
    buildQuestion("client_sponsorAnnualIncome", "Current Annual Income (in USD)", "currency", sponsorFinancialSection, 3, { required: true }),
    buildQuestion("client_sponsorBankBalance", "Bank Balance (in USD)", "currency", sponsorFinancialSection, 4, { required: true }),
    buildQuestion("client_sponsorOtherAssetsValue", "Other Assets Value (in USD)", "currency", sponsorFinancialSection, 5, { required: true })
  );

  // ── Section 7 — Applicant Document Checklist ────────────────────────────
  // Every item from the source is preserved. Conditional gating is added,
  // via driver questions, for exactly the items the source itself marks
  // "if applicable"/"conditional" — everything the source lists as
  // unconditional stays required. I-20 and SEVIS receipt are client
  // supporting documents here, never USCIS CaseForms (see file banner and
  // the VisaFormMapping seed's own COSF1 comment).
  const docsSection = "Applicant Document Checklist";
  const hasApprovalNoticesGate = gate("client_hasApprovalNotices", "equals", "Yes");
  const isEmployedGate = gate("client_isEmployed", "equals", "Yes");
  const needsAcademicEvaluationGate = gate("client_needsAcademicEvaluation", "equals", "Yes");
  const hasPreviousApprovalNoticeGate = gate("client_hasPreviousApprovalNotice", "equals", "Yes");

  questions.push(
    documentQuestion("cosf1_doc_passportAndI94", "Copy of passport and I-94", docsSection, 1, { required: true, category: "identity" }),

    buildQuestion("client_hasApprovalNotices", "Do you have any I-797 approval notices?", "radio", docsSection, 2, { required: true, options: ["Yes", "No"] }),
    documentQuestion("cosf1_doc_approvalNotices", "Copy of all I-797 approval notices, if any", docsSection, 3, { required: false, category: "immigration", classification: "conditional", conditionalLogic: hasApprovalNoticesGate }),

    documentQuestion("cosf1_doc_birthCertificate", "Copy of Birth Certificate", docsSection, 4, { required: true, category: "identity" }),

    buildQuestion("client_isEmployed", "Are you currently employed?", "radio", docsSection, 5, { required: true, options: ["Yes", "No"] }),
    documentQuestion("cosf1_doc_paystubsAndW2", "Copy of last 3 months paystubs and W-2, if employed", docsSection, 6, { required: false, category: "financial", classification: "conditional", conditionalLogic: isEmployedGate }),

    buildQuestion("client_needsAcademicEvaluation", "Was your prior education completed outside the United States (requiring a credential evaluation)?", "radio", docsSection, 7, { required: true, options: ["Yes", "No"] }),
    documentQuestion("cosf1_doc_academicDegreeTranscriptsEvaluation", "Copy of academic degree and transcripts, and Academic Evaluation if needed", docsSection, 8, { required: true, category: "immigration", classification: "conditional", description: "Academic Evaluation only required if your prior education was completed outside the United States.", conditionalLogic: needsAcademicEvaluationGate }),

    documentQuestion("cosf1_doc_i20", "Copy of I-20", docsSection, 9, { required: true, category: "immigration", description: "School-issued F-1 eligibility document. Client supporting document — never a USCIS CaseForm." }),
    documentQuestion("cosf1_doc_sevisReceipt", "Copy of SEVIS receipt", docsSection, 10, { required: true, category: "immigration", description: "Client supporting document — never a USCIS CaseForm." }),

    buildQuestion("client_hasPreviousApprovalNotice", "Do you have a previous approval notice (e.g. for a prior petition or status)?", "radio", docsSection, 11, { required: true, options: ["Yes", "No"] }),
    documentQuestion("cosf1_doc_previousApprovalNotice", "Copy of previous approval notice, if applicable", docsSection, 12, { required: false, category: "immigration", classification: "conditional", conditionalLogic: hasPreviousApprovalNoticeGate }),

    documentQuestion("cosf1_doc_resume", "Resume of the applicant", docsSection, 13, { required: true, category: "supporting" }),
    documentQuestion("cosf1_doc_tiesToHomeCountry", "Evidence of Applicant's Ties to Home Country", docsSection, 14, { required: true, category: "supporting" }),
    documentQuestion("cosf1_doc_maintainingStatusEvidence", "Evidence that you are maintaining your current visa status", docsSection, 15, { required: true, category: "immigration" })
  );

  const sections = [
    infoSection, lastEntrySection, foreignAddressSection, cosSection,
    sponsorInfoSection, sponsorFinancialSection, docsSection,
  ];

  return {
    key: "cos_f1_questionnaire",
    title: "Change of Status to F-1 — Applicant Checklist",
    visaType: "COSF1",
    checklistRole: "client",
    isDefault: true,
    description: "",
    sections,
    questions,
  };
}

const COS_F1_CHECKLIST_DEFINITIONS = [buildCosF1Questionnaire()];

module.exports = { COS_F1_CHECKLIST_DEFINITIONS };
