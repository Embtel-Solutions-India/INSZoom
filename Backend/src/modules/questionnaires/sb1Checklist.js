// Converts SB-1 (Returning Resident Visa)'s supplied questionnaire/checklist
// into a real Questionnaire/Question template definition, in the same
// shape as questionnaire.service.js's VISA_TEMPLATE_DEFINITIONS — mirrors
// singlePartyChecklists.js's/i131Checklist.js's single-role conversion
// pattern (SB-1 has one primary applicant, no petitioner/beneficiary/
// employer/employee split — see the integration prompt's §1).
//
// UNLIKE n565Checklist.js/n400Checklist.js/n600Checklist.js (optional
// add-on processes attached to an EXISTING case of some other visa type,
// reached only via an explicit Case Manager approval action), SB-1 is a
// REAL, standalone, selectable case-creation visaType — exactly like
// EB-1A/EB-2 NIW/"Green Card Renewal". So this checklist IS isDefault:true
// and its visaType IS the literal, real "SB-1" (not a pseudo-value) — the
// existing default-template auto-resolution in getQuestionnaireForCase
// (isDefault + checklistRole + visaType match) surfaces it automatically
// the moment a case is created with visaType "SB-1", with zero extra
// case-creation code, exactly like it already does for every other
// single-party visa.
//
// Role: the prompt's own classification table describes the conceptual
// role as "applicant" (§1) - CHECKLIST_ROLES (models/Questionnaire.js) has
// no such literal value, and the existing "client" role already serves
// this exact purpose for every other single-applicant case in this
// codebase (EB-1A, EB-2 NIW, Green Card Renewal, N-400, N-565, N-600) — per
// the prompt's own repeated instruction to "reuse the existing single-
// person case architecture wherever possible" rather than adding a new
// role, checklistRole here is "client", consistent with that whole series.
//
// Source: the supplied SB-1 questionnaire (§1 Information About You
// through §13 Employment Outside the United States) + the supplied
// document checklist. Every field label/document name is verbatim from
// that source; client_hasReentryPermit is the one small structural driver
// field added (not itself a named source field) to make the source's own
// explicit "Has Re-entry Permit = Yes -> show/upload" conditional rule
// (integration prompt §12) expressible as a real structured gate, exactly
// the same kind of minimal addition n400Checklist.js's
// client_residingOutsideUsa driver field already established precedent
// for.

const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];
const VISIBILITY = { roles: ["client", ...STAFF_ROLES], portals: ["client", "admin"] };

const MARITAL_STATUS_OPTIONS = ["Single", "Married", "Widowed", "Divorced"];

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

// classification: "required" | "conditional" | "supporting" (§4 of the
// integration prompt) - stored as informational metadata (Question.metadata
// is Mixed, so this is additive, not a schema change) alongside the real
// `required` boolean that actually drives completion/progress tracking.
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

function buildSb1Questionnaire() {
  const questions = [];

  // ── Section 1 — Information About You ───────────────────────────────────
  const infoSection = "Information About You";
  questions.push(
    buildQuestion("client_firstName", "First Name", "text", infoSection, 1, { required: true, canonicalPath: "applicant.firstName" }),
    buildQuestion("client_middleName", "Middle Name", "text", infoSection, 2, { canonicalPath: "applicant.middleName" }),
    buildQuestion("client_lastName", "Last Name", "text", infoSection, 3, { required: true, canonicalPath: "applicant.lastName" }),
    buildQuestion("client_otherNamesUsed", "Other Names Used", "text", infoSection, 4),
    buildQuestion("client_currentHomeAddress", "Current Home Address", "text", infoSection, 5, { required: true }),
    buildQuestion("client_telephoneNumber", "Telephone Number", "text", infoSection, 6, { required: true }),
    buildQuestion("client_placeOfBirthCity", "Place of Birth — City", "text", infoSection, 7, { required: true }),
    buildQuestion("client_placeOfBirthState", "Place of Birth — State/Province", "text", infoSection, 8),
    buildQuestion("client_placeOfBirthCountry", "Place of Birth — Country", "text", infoSection, 9, { required: true, canonicalPath: "applicant.countryOfBirth" }),
    buildQuestion("client_dateOfBirth", "Date of Birth", "date", infoSection, 10, { required: true, canonicalPath: "applicant.dateOfBirth" }),
    // Drives the Re-entry Permit document requirement (integration prompt
    // §12's own example) - see the file banner.
    buildQuestion("client_hasReentryPermit", "Do you have a Re-entry Permit?", "radio", infoSection, 11, { required: true, options: ["Yes", "No"] })
  );

  // ── Section 2 — Marital Information ─────────────────────────────────────
  const maritalSection = "Marital Information";
  const marriedGate = gate("client_maritalStatus", "equals", "Married");
  questions.push(
    buildQuestion("client_maritalStatus", "Current Marital Status", "select", maritalSection, 1, { required: true, options: MARITAL_STATUS_OPTIONS }),
    buildQuestion("client_spouseFirstName", "Spouse First Name", "text", maritalSection, 2, { conditionalLogic: marriedGate }),
    buildQuestion("client_spouseMiddleName", "Spouse Middle Name", "text", maritalSection, 3, { conditionalLogic: marriedGate }),
    buildQuestion("client_spouseLastName", "Spouse Last Name", "text", maritalSection, 4, { conditionalLogic: marriedGate }),
    buildQuestion("client_spouseCurrentAddress", "Spouse Current Address", "text", maritalSection, 5, { conditionalLogic: marriedGate }),
    buildQuestion("client_spousePlaceOfBirth", "Spouse Place of Birth", "text", maritalSection, 6, { conditionalLogic: marriedGate }),
    buildQuestion("client_spouseDateOfBirth", "Spouse Date of Birth", "date", maritalSection, 7, { conditionalLogic: marriedGate }),
    buildQuestion("client_spouseUsResidenceStatus", "Spouse U.S. Residence Status", "text", maritalSection, 8, { conditionalLogic: marriedGate }),
    buildQuestion("client_dateOfMarriage", "Date of Marriage", "date", maritalSection, 9, { conditionalLogic: marriedGate })
  );

  // ── Section 3 — Close Family Members in the United States (repeatable) ──
  const familySection = "Close Family Members in the United States";
  questions.push(
    repeatingGroup("client_closeFamilyMembers", "Close Family Members in the United States", familySection, 1, [
      { key: "fullName", label: "Full Name", type: "text" },
      { key: "relationshipToApplicant", label: "Relationship to Applicant", type: "text" },
      { key: "residentStatus", label: "Resident Status", type: "text" },
      { key: "fullUsAddress", label: "Full U.S. Address", type: "text" },
    ], { description: "Add every close family member in the United States." })
  );

  // ── Section 4 — Previous Immigration Record ─────────────────────────────
  const priorRecordSection = "Previous Immigration Record";
  questions.push(
    buildQuestion("client_aNumber", "A-Number", "text", priorRecordSection, 1, { required: true, canonicalPath: "applicant.aNumber" }),
    buildQuestion("client_immigrationCategory", "Immigration Category", "text", priorRecordSection, 2, { required: true })
  );

  // ── Section 5 — Previous Immigrant Visa ─────────────────────────────────
  const priorVisaSection = "Previous Immigrant Visa";
  questions.push(
    buildQuestion("client_immigrantVisaDateOfIssue", "Date of Issue", "date", priorVisaSection, 1, { required: true }),
    buildQuestion("client_immigrantVisaPlaceOfIssue", "Place of Issue", "text", priorVisaSection, 2, { required: true })
  );

  // ── Section 6 — Adjustment of Status ─────────────────────────────────────
  const adjustmentSection = "Adjustment of Status";
  const adjustedGate = gate("client_didAdjustStatus", "equals", "Yes");
  questions.push(
    buildQuestion("client_didAdjustStatus", "Did you ever adjust status?", "radio", adjustmentSection, 1, { required: true, options: ["Yes", "No"] }),
    buildQuestion("client_adjustmentDate", "Date of Adjustment of Status", "date", adjustmentSection, 2, { conditionalLogic: adjustedGate }),
    buildQuestion("client_adjustmentPlace", "Place of Adjustment of Status", "text", adjustmentSection, 3, { conditionalLogic: adjustedGate })
  );

  // ── Section 7 — Initial Entry as Lawful Permanent Resident ──────────────
  const initialEntrySection = "Initial Entry as Lawful Permanent Resident";
  questions.push(
    buildQuestion("client_initialLprEntryDate", "Date of Entry", "date", initialEntrySection, 1, { required: true }),
    buildQuestion("client_initialLprPortOfEntry", "Port of Entry", "text", initialEntrySection, 2, { required: true })
  );

  // ── Section 8 — Last Entry as Lawful Permanent Resident ─────────────────
  const lastEntrySection = "Last Entry as Lawful Permanent Resident";
  questions.push(
    buildQuestion("client_lastLprEntryDate", "Date of Entry", "date", lastEntrySection, 1, { required: true }),
    buildQuestion("client_lastLprPortOfEntry", "Port of Entry", "text", lastEntrySection, 2, { required: true })
  );

  // ── Section 9 — Most Recent Departure ────────────────────────────────────
  const departureSection = "Most Recent Departure";
  questions.push(
    buildQuestion("client_mostRecentDepartureDate", "Date of Departure", "date", departureSection, 1, { required: true }),
    buildQuestion("client_mostRecentDestination", "Destination", "text", departureSection, 2, { required: true }),
    buildQuestion("client_reasonForLeavingUs", "Reason for Leaving the United States", "text", departureSection, 3, { required: true })
  );

  // ── Section 10 — Continuing U.S. Ties ────────────────────────────────────
  const tiesSection = "Continuing U.S. Ties";
  questions.push(
    buildQuestion("client_continuingUSTies", "What continuing ties have you maintained with the United States? What efforts have you made to avoid abandoning your permanent resident status?", "textarea", tiesSection, 1, { required: true, metadata: { sourcePath: "client.continuingUSTies" } })
  );

  // ── Section 11 — Reason for Delayed Return ───────────────────────────────
  const delayedReturnSection = "Reason for Delayed Return";
  questions.push(
    buildQuestion("client_reasonForNotReturning", "What were the reasons for not returning to the United States until the time of this application?", "textarea", delayedReturnSection, 1, { required: true, metadata: { sourcePath: "client.reasonForNotReturning" } })
  );

  // ── Section 12 — Periods Outside the United States (repeatable) ─────────
  const periodsOutsideSection = "Periods Outside the United States";
  questions.push(
    repeatingGroup("client_periodsOutsideUs", "Periods Outside the United States", periodsOutsideSection, 1, [
      { key: "from", label: "From", type: "date" },
      { key: "to", label: "To", type: "date" },
      { key: "country", label: "Country", type: "text" },
    ], { required: true, description: "Add every period spent outside the United States. Add as many entries as needed." })
  );

  // ── Section 13 — Employment Outside the United States ───────────────────
  const foreignEmploymentSection = "Employment Outside the United States";
  const employedOutsideGate = gate("client_employedOutsideUs", "equals", "Yes");
  questions.push(
    buildQuestion("client_employedOutsideUs", "Have you been employed outside of the United States since your most recent departure?", "radio", foreignEmploymentSection, 1, { required: true, options: ["Yes", "No"] }),
    repeatingGroup("client_foreignEmployment", "Employment Outside the United States", foreignEmploymentSection, 2, [
      { key: "employerName", label: "Employer Name", type: "text" },
      { key: "employerAddress", label: "Employer Full Address", type: "text" },
      { key: "from", label: "From", type: "date" },
      { key: "to", label: "To", type: "date" },
    ], { conditionalLogic: employedOutsideGate, description: "Add every employer outside the United States since your most recent departure." })
  );

  // ── Document Checklist ────────────────────────────────────────────────────
  const identitySection = "Identity and Immigration Status";
  questions.push(
    documentQuestion("sb1_doc_passport", "Passport — all pages except blank pages", identitySection, 1, { required: true, category: "identity", classification: "required" }),
    documentQuestion("sb1_doc_greenCard", "Permanent Resident Card (Form I-551)", identitySection, 2, { required: true, category: "identity", classification: "required" }),
    documentQuestion("sb1_doc_reentryPermit", "Re-entry Permit, if available", identitySection, 3, { required: false, category: "immigration", classification: "conditional", conditionalLogic: gate("client_hasReentryPermit", "equals", "Yes") })
  );

  const travelHistorySection = "Travel History";
  questions.push(
    documentQuestion("sb1_doc_travelRecords", "Airline tickets/travel records showing dates of travel outside the United States", travelHistorySection, 1, { required: true, category: "other", classification: "required" }),
    documentQuestion("sb1_doc_passportEntryExitStamps", "Passport pages containing relevant entry/exit stamps", travelHistorySection, 2, { required: true, category: "identity", classification: "required" })
  );

  const tiesEvidenceSection = "Evidence of U.S. Ties and Intention to Return";
  questions.push(
    documentQuestion("sb1_doc_usTaxReturns", "U.S. tax returns", tiesEvidenceSection, 1, { required: false, category: "financial", classification: "supporting" }),
    documentQuestion("sb1_doc_w2s", "W-2s", tiesEvidenceSection, 2, { required: false, category: "financial", classification: "supporting" }),
    documentQuestion("sb1_doc_employmentVerificationLetter", "Employment verification letter from U.S. employer", tiesEvidenceSection, 3, { required: false, category: "employment", classification: "supporting" }),
    documentQuestion("sb1_doc_usPropertyOwnership", "U.S. property ownership documents", tiesEvidenceSection, 4, { required: false, category: "financial", classification: "supporting" }),
    documentQuestion("sb1_doc_usBusinessOwnership", "U.S. business ownership documents", tiesEvidenceSection, 5, { required: false, category: "financial", classification: "supporting" }),
    documentQuestion("sb1_doc_otherTiesEvidence", "Other evidence of economic, family, and social ties to the United States", tiesEvidenceSection, 6, { required: false, category: "other", classification: "supporting" })
  );

  const prolongedStaySection = "Evidence Explaining Prolonged Stay Abroad";
  questions.push(
    documentQuestion("sb1_doc_medicalEvidence", "Medical evidence, if applicable", prolongedStaySection, 1, { required: false, category: "other", classification: "conditional" }),
    documentQuestion("sb1_doc_foreignEmploymentEvidence", "Evidence of employment with a U.S. company, if applicable", prolongedStaySection, 2, { required: false, category: "employment", classification: "conditional", conditionalLogic: employedOutsideGate }),
    documentQuestion("sb1_doc_otherProlongedStayEvidence", "Other evidence showing that the prolonged stay outside the United States resulted from circumstances beyond the applicant's control", prolongedStaySection, 3, { required: false, category: "statement", classification: "supporting" })
  );

  const sections = [
    infoSection, maritalSection, familySection, priorRecordSection, priorVisaSection, adjustmentSection,
    initialEntrySection, lastEntrySection, departureSection, tiesSection, delayedReturnSection,
    periodsOutsideSection, foreignEmploymentSection,
    identitySection, travelHistorySection, tiesEvidenceSection, prolongedStaySection,
  ];

  return {
    // Combines the prompt's two named pieces ("sb1_returning_resident_
    // questionnaire" + "sb1_returning_resident_document_checklist") into
    // ONE Questionnaire record - see the file banner for why: every
    // conditional document gate here (e.g. Re-entry Permit, foreign-
    // employment evidence) reads an answer from the questionnaire section
    // above it, and conditionalLogic can only resolve an answer within the
    // SAME Questionnaire's own responseId. Splitting into two separate
    // Questionnaire records would sever that link entirely. Every other
    // single-party checklist in this codebase (i131Checklist.js,
    // n565Checklist.js, n400Checklist.js, n600Checklist.js) is built the
    // same way: one record, an info-fields part + a "Document Checklist"
    // part, sharing one response. Keyed/titled after the more client-
    // facing of the two names the source gives, since that's what the
    // client actually opens and completes.
    key: "sb1_returning_resident_document_checklist",
    title: "Returning Resident (SB-1) Supporting Documents",
    visaType: "SB-1",
    checklistRole: "client",
    isDefault: true,
    description: "",
    sections,
    questions,
  };
}

const SB1_CHECKLIST_DEFINITION = buildSb1Questionnaire();

module.exports = { SB1_CHECKLIST_DEFINITION, MARITAL_STATUS_OPTIONS };
