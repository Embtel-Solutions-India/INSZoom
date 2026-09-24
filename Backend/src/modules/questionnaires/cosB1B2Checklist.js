// Converts the supplied "Change of Status" questionnaire/checklist into TWO
// INDEPENDENT real Questionnaire template records — COS_TO_B1
// (cos_b1_questionnaire, visaType COSB1) and COS_TO_B2 (cos_b2_questionnaire,
// visaType COSB2) — per the governing task's explicit requirement: two
// separate checklist records, never a shared/parent one, so B-1 and B-2
// content/mapping can diverge independently later.
//
// Per task item 14 ("do not duplicate the questionnaire engine itself"), the
// duplication lives ONLY at the checklist-configuration/record level: one
// shared builder function (buildCosToChecklist) is parameterized by
// destination status and produces two independent definition objects. The
// question-definition helpers, condition engine, answer storage, and
// checklist-assignment machinery are the exact same shared code every other
// checklist in this codebase already uses (mirrors cosF2Checklist.js's/
// h4Checklist.js's pattern).
//
// Both are REAL, standalone, selectable case-creation visaTypes (COSB1,
// COSB2 — see filingTypes.js's COS_B1/COS_B2, and F1_TO_B2 which shares
// COSB2's content), isDefault:true, real visaType — surfaced automatically
// via getQuestionnaireForCase's existing default-template matching, exactly
// like every other single-party filing checklist.
//
// "Current status remains dynamic" (task item 12): neither checklist is
// restricted to a specific source visa — "Current Nonimmigrant Status" is a
// free-text question filled in by the applicant, exactly as the source
// document has it, and both COSB1/COSB2 VisaFormMapping rows are keyed only
// on the DESTINATION visaType, never the source status.
//
// canonicalPath convention: reuses h4Checklist.js's/cosF2Checklist.js's
// existing "applicant.*" canonicalPath convention and identical question
// keys for the same concepts (client_familyName, client_ssn, etc.), so the
// existing i539-h4-crosswalk.js autofill crosswalk (keyed on canonical
// paths/question keys, not visaType) also autofills these I-539 CaseForms
// with zero new crosswalk file.

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

// destinationStatus: "B-1" | "B-2". Produces one complete, independent
// Questionnaire definition — called once per destination below.
function buildCosToChecklist({ key, visaType, destinationStatus, destinationLabel }) {
  const questions = [];

  const infoSection = "Information about You (Applicant)";
  questions.push(
    buildQuestion("client_familyName", "Family Name", "text", infoSection, 1, { required: true, canonicalPath: "applicant.lastName" }),
    buildQuestion("client_givenName", "Given Name", "text", infoSection, 2, { required: true, canonicalPath: "applicant.firstName" }),
    buildQuestion("client_middleName", "Middle Name", "text", infoSection, 3, { canonicalPath: "applicant.middleName" }),
    buildQuestion("client_aNumber", "A-Number, if any", "text", infoSection, 4, { canonicalPath: "applicant.aNumber" }),
    buildQuestion("client_uscisOnlineAccountNumber", "USCIS Online Account Number, if any", "text", infoSection, 5),
    buildQuestion("client_usMailingAddress", "US Mailing Address", "text", infoSection, 6, { required: true, canonicalPath: "applicant.mailingAddress" }),
    buildQuestion("client_usPhysicalAddress", "US Physical Address, if different from Mailing Address", "text", infoSection, 7, { canonicalPath: "applicant.physicalAddress" })
  );

  const otherInfoSection = "Other Information";
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
    // Deliberately free-text, not a fixed/enumerated value — task item 12:
    // the CURRENT status must remain fully dynamic (any supported source
    // status: H-1B, F-1, L-1A, H-4, F-2, etc.), unlike the REQUESTED status
    // below, which this checklist itself fixes.
    buildQuestion("client_currentNonimmigrantStatus", "Current Nonimmigrant Status (e.g. H-1B, F-1 student, H-4 dependent, etc.)", "text", lastEntrySection, 6, { required: true, canonicalPath: "applicant.currentVisaStatus" }),
    buildQuestion("client_expirationOfCurrentStatus", "Expiration Date of Current Status", "date", lastEntrySection, 7, { required: true, canonicalPath: "applicant.currentVisaExpiry" })
  );

  const outsideUsSection = "Physical Address Outside the USA";
  questions.push(
    buildQuestion("client_outsideUsStreetNumberName", "Street Number and Name", "text", outsideUsSection, 1),
    buildQuestion("client_outsideUsCityTown", "City or Town", "text", outsideUsSection, 2),
    buildQuestion("client_outsideUsState", "State", "text", outsideUsSection, 3),
    buildQuestion("client_outsideUsPostalCode", "Postal Code", "text", outsideUsSection, 4),
    buildQuestion("client_outsideUsProvince", "Province", "text", outsideUsSection, 5),
    buildQuestion("client_outsideUsCountry", "Country", "text", outsideUsSection, 6)
  );

  // Application Type — preserved verbatim from the source (task item 4/
  // "do not silently remove source questions"), with Change of Status
  // expected for this workflow. Requested New Status is fixed by which of
  // the two checklists this is (task item 4: "do not require the client to
  // manually select a different destination status if it is already
  // determined by the checklist") — shown as a locked/pre-filled value, not
  // an open choice, and the effective date remains a real client-entered
  // field (genuinely their own data, not determined by the checklist).
  const appTypeSection = "Application Type";
  const APPLICATION_TYPE_OPTIONS = [
    "Reinstatement to student status",
    "An extension of stay in my current status",
    "Change of status",
  ];
  questions.push(
    buildQuestion("client_applicationType", "Application Type — select only one", "radio", appTypeSection, 1, { required: true, options: APPLICATION_TYPE_OPTIONS, metadata: { defaultValue: "Change of status" } })
  );

  const cosInfoSection = "Change of Status Information";
  questions.push(
    buildQuestion("client_requestedNewStatus", "Requested New Status", "text", cosInfoSection, 1, {
      required: true,
      metadata: { defaultValue: destinationStatus, locked: true },
      description: `Fixed by this checklist — ${destinationLabel}.`,
    }),
    buildQuestion("client_requestedEffectiveDate", "Requested Effective Date of Change", "date", cosInfoSection, 2, { required: true }),
    buildQuestion("client_changeOfStatusRequested", "The Change of Status I am Requesting", "textarea", cosInfoSection, 3, { required: true, metadata: { defaultValue: `Change of status to ${destinationStatus}` } })
  );

  // ── Document Checklist ──────────────────────────────────────────────────
  // Every item from the source is preserved (task item 5). Conditional
  // gating (task item 6) is added, via driver questions, for exactly the
  // categories the task calls out as needing inspection (I-20, EAD,
  // academic documents, approval notice, W-2, assets) plus the source's own
  // explicit conditional (pay stubs "if employed") — everything else stays
  // required, matching the source's plain (non-conditional) phrasing.
  const docsSection = "Document Checklist";
  const wasStudentGate = gate("client_wasF1OrF2Student", "equals", "Yes");
  const hasEadGate = gate("client_hasEadCard", "equals", "Yes");
  const hasApprovalNoticeGate = gate("client_hasPriorApprovalNotice", "equals", "Yes");
  const employedGate = gate("client_isEmployed", "equals", "Yes");
  const hasAssetsGate = gate("client_hasOtherAssets", "equals", "Yes");

  questions.push(
    documentQuestion("cosb1b2_doc_passportAndI94", "Copy of passport and I-94", docsSection, 1, { required: true, category: "identity" }),

    buildQuestion("client_wasF1OrF2Student", "Were you most recently in F-1 or F-2 student status?", "radio", docsSection, 2, { required: true, options: ["Yes", "No"] }),
    documentQuestion("cosb1b2_doc_latestI20", "Copy of latest I-20", docsSection, 3, { required: false, category: "immigration", classification: "conditional", conditionalLogic: wasStudentGate }),
    documentQuestion("cosb1b2_doc_academicCertTranscript", "Copy of recent academic certificate and transcript", docsSection, 4, { required: false, category: "immigration", classification: "conditional", conditionalLogic: wasStudentGate }),

    buildQuestion("client_hasEadCard", "Do you currently have an EAD (Employment Authorization Document) card?", "radio", docsSection, 5, { required: true, options: ["Yes", "No"] }),
    documentQuestion("cosb1b2_doc_eadCard", "Copy of EAD card", docsSection, 6, { required: false, category: "immigration", classification: "conditional", conditionalLogic: hasEadGate }),

    documentQuestion("cosb1b2_doc_resume", "Copy of the resume of the applicant", docsSection, 7, { required: true, category: "supporting" }),

    buildQuestion("client_hasPriorApprovalNotice", "Do you have a prior USCIS approval notice (e.g. I-797) for your current status?", "radio", docsSection, 8, { required: true, options: ["Yes", "No"] }),
    documentQuestion("cosb1b2_doc_latestApprovalNotice", "Copy of latest approval notice", docsSection, 9, { required: false, category: "immigration", classification: "conditional", conditionalLogic: hasApprovalNoticeGate }),

    documentQuestion("cosb1b2_doc_driversLicenseAndSsn", "Copy of Driving License and SSN of the applicant", docsSection, 10, { required: true, category: "identity" }),

    buildQuestion("client_isEmployed", "Are you currently employed?", "radio", docsSection, 11, { required: true, options: ["Yes", "No"] }),
    documentQuestion("cosb1b2_doc_payStubs3Months", "Copy of the applicant's recent (3 months) pay stubs, if employed", docsSection, 12, { required: false, category: "financial", classification: "conditional", conditionalLogic: employedGate }),
    documentQuestion("cosb1b2_doc_w2", "Copy of W-2 of the applicant", docsSection, 13, { required: false, category: "financial", classification: "conditional", conditionalLogic: employedGate }),

    buildQuestion("client_hasOtherAssets", "Do you have other assets to show availability of funds?", "radio", docsSection, 14, { required: true, options: ["Yes", "No"] }),
    documentQuestion("cosb1b2_doc_otherAssets", "Copy of other assets to show availability of funds", docsSection, 15, { required: false, category: "financial", classification: "conditional", conditionalLogic: hasAssetsGate }),

    documentQuestion("cosb1b2_doc_bankStatements3Months", "Copy of last 3 months' bank statements", docsSection, 16, { required: true, category: "financial" }),

    buildQuestion("client_usContactName", "Name of a friend/relative in the USA", "text", docsSection, 17, { required: true }),
    buildQuestion("client_usContactPhone", "Contact number of friend/relative in the USA", "text", docsSection, 18, { required: true }),
    buildQuestion("client_usContactEmail", "Email of friend/relative in the USA", "text", docsSection, 19, { required: true }),

    documentQuestion("cosb1b2_doc_tiesToHomeCountry", "Evidence of Applicant's Ties to Home Country", docsSection, 20, { required: true, category: "supporting" })
  );

  const sections = [infoSection, otherInfoSection, lastEntrySection, outsideUsSection, appTypeSection, cosInfoSection, docsSection];

  return {
    key,
    title: `Change of Status to ${destinationStatus} — Applicant Checklist`,
    visaType,
    checklistRole: "client",
    isDefault: true,
    description: "",
    sections,
    questions,
  };
}

const COS_B1_B2_CHECKLIST_DEFINITIONS = [
  buildCosToChecklist({ key: "cos_b1_questionnaire", visaType: "COSB1", destinationStatus: "B-1", destinationLabel: "Change of Status to B-1 (Business Visitor)" }),
  buildCosToChecklist({ key: "cos_b2_questionnaire", visaType: "COSB2", destinationStatus: "B-2", destinationLabel: "Change of Status to B-2 (Tourist Visitor)" }),
];

module.exports = { COS_B1_B2_CHECKLIST_DEFINITIONS };
