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

const { COUNTRIES, IMMIGRATION_STATUSES } = require("../../config/geoOptions");
// "existing status selector with Other": the platform's immigration-status list, with an explicit Other.
const STATUS_OPTIONS = [...IMMIGRATION_STATUSES.filter((value) => value !== "Other"), "Other"];
const RELATIONSHIP_OPTIONS = ["Spouse", "Child", "Parent", "Brother/Sister", "Other relative", "Other"];
// a date that cannot be in the future (enforced server-side on submit, questionnaire.service.js validateQuestionValue)
const PAST_DATE = [{ type: "date", value: "past", message: "This date cannot be in the future", severity: "error" }];

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
    ...(extras.validationRules ? { validationRules: extras.validationRules } : {}),
    visibility: extras.visibility || VISIBILITY,
    conditionalLogic: extras.conditionalLogic || { mode: "all", rules: [], groups: [] },
    repeatable: Boolean(extras.repeatable),
  };
}

function repeatingGroup(key, label, sectionTitle, order, columns, extras = {}) {
  return buildQuestion(key, label, "repeating_group", sectionTitle, order, {
    ...extras,
    repeatable: true,
    metadata: { sourcePath: key, fields: columns, ...(extras.metadata || {}) },
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
  // Every question below is optional: nothing is marked required (the platform stores required:false anyway, and a client may always save a
  // partial draft). Canonical paths reuse the paths that already exist for the same fact (person.* / contact.address.* / family.spouse.* /
  // immigration.*) and add only what is genuinely new (registered in canonical/config/sb1CanonicalPaths.js). The questionnaire is internal
  // intake: no canonical path here implies a government-form mapping, and none exists.
  const q = (key, label, type, section, order, extras = {}) => buildQuestion(key, label, type, section, order, extras);
  const countrySelect = (key, label, section, order, extras = {}) => q(key, label, "select", section, order, { ...extras, options: COUNTRIES });
  // Structured address = one question per component, each bound to the address path the rest of the platform already reads.
  const addressBlock = (prefix, section, startOrder, base, extras = {}) => ([
    q(`${prefix}Line1`, "Street Number and Name", "text", section, startOrder, { ...extras, canonicalPath: `${base}.line1` }),
    q(`${prefix}Line2`, "Apartment, Suite or Floor", "text", section, startOrder + 1, { ...extras, canonicalPath: `${base}.line2` }),
    q(`${prefix}City`, "City or Town", "text", section, startOrder + 2, { ...extras, canonicalPath: `${base}.city` }),
    q(`${prefix}State`, "State / Province", "text", section, startOrder + 3, { ...extras, canonicalPath: `${base}.state` }),
    q(`${prefix}PostalCode`, "ZIP / Postal Code", "text", section, startOrder + 4, { ...extras, canonicalPath: `${base}.zip` }),
    countrySelect(`${prefix}Country`, "Country", section, startOrder + 5, { ...extras, canonicalPath: `${base}.country` }),
  ]);

  // ── Section 1 — Information About You ───────────────────────────────────
  const infoSection = "Information About You";
  questions.push(
    q("client_firstName", "First Name", "text", infoSection, 1, { canonicalPath: "person.firstName" }),
    q("client_middleName", "Middle Name", "text", infoSection, 2, { canonicalPath: "person.middleName" }),
    q("client_lastName", "Last Name", "text", infoSection, 3, { canonicalPath: "person.lastName" }),
    repeatingGroup("client_otherNamesUsed", "Other Names Used", infoSection, 4, [{ key: "name", label: "Other name used", type: "text" }], {
      canonicalPath: "person.otherNames", description: "Add each other name you have used. Leave empty if none.", metadata: { itemLabel: "Other name", addLabel: "Add another name" },
    }),
    ...addressBlock("client_currentHomeAddress", infoSection, 5, "contact.address"),
    q("client_telephoneNumber", "Telephone Number", "phone", infoSection, 11, { canonicalPath: "contact.phone" }),
    q("client_placeOfBirthCity", "Place of Birth — City", "text", infoSection, 12, { canonicalPath: "person.cityTownOfBirth" }),
    q("client_placeOfBirthState", "Place of Birth — State/Province", "text", infoSection, 13, { canonicalPath: "person.birthPlace.stateProvince" }),
    countrySelect("client_placeOfBirthCountry", "Place of Birth — Country", infoSection, 14, { canonicalPath: "person.countryOfBirth" }),
    q("client_dateOfBirth", "Date of Birth", "date", infoSection, 15, { canonicalPath: "person.dob", validationRules: [{ type: "date", value: "past", message: "Date of birth cannot be in the future", severity: "error" }] }),
    // Drives the Re-entry Permit document requirement - see the file banner.
    q("client_hasReentryPermit", "Do you have a Re-entry Permit?", "radio", infoSection, 16, { options: ["Yes", "No"], canonicalPath: "immigration.reentryPermitHeld" })
  );

  // ── Section 2 — Marital Information ─────────────────────────────────────
  const maritalSection = "Marital Information";
  const marriedGate = gate("client_maritalStatus", "equals", "Married");
  questions.push(
    q("client_maritalStatus", "Current Marital Status", "select", maritalSection, 1, { options: MARITAL_STATUS_OPTIONS, canonicalPath: "person.maritalStatus" }),
    q("client_spouseFirstName", "Spouse First Name", "text", maritalSection, 2, { conditionalLogic: marriedGate, canonicalPath: "family.spouse.firstName" }),
    q("client_spouseMiddleName", "Spouse Middle Name", "text", maritalSection, 3, { conditionalLogic: marriedGate, canonicalPath: "family.spouse.middleName" }),
    q("client_spouseLastName", "Spouse Last Name", "text", maritalSection, 4, { conditionalLogic: marriedGate, canonicalPath: "family.spouse.lastName" }),
    ...addressBlock("client_spouseCurrentAddress", maritalSection, 5, "family.spouse.address", { conditionalLogic: marriedGate }).map((item) => ({ ...item, label: `Spouse Current Address — ${item.label}` })),
    q("client_spousePlaceOfBirthCity", "Spouse Place of Birth — City", "text", maritalSection, 11, { conditionalLogic: marriedGate, canonicalPath: "family.spouse.birthPlace.city" }),
    q("client_spousePlaceOfBirthState", "Spouse Place of Birth — State/Province", "text", maritalSection, 12, { conditionalLogic: marriedGate, canonicalPath: "family.spouse.birthPlace.stateProvince" }),
    countrySelect("client_spousePlaceOfBirthCountry", "Spouse Place of Birth — Country", maritalSection, 13, { conditionalLogic: marriedGate, canonicalPath: "family.spouse.birthPlace.country" }),
    q("client_spouseDateOfBirth", "Spouse Date of Birth", "date", maritalSection, 14, { conditionalLogic: marriedGate, canonicalPath: "family.spouse.dateOfBirth", validationRules: [{ type: "date", value: "past", message: "Date of birth cannot be in the future", severity: "error" }] }),
    q("client_spouseUsResidenceStatus", "Spouse U.S. Residence Status", "select", maritalSection, 15, { conditionalLogic: marriedGate, options: STATUS_OPTIONS, canonicalPath: "family.spouse.usResidenceStatus" }),
    q("client_dateOfMarriage", "Date of Marriage", "date", maritalSection, 16, { conditionalLogic: marriedGate, canonicalPath: "family.spouse.marriageDate", validationRules: [{ type: "date", value: "past", message: "Date of marriage cannot be in the future", severity: "error" }] })
  );

  // ── Section 3 — Close Family Members in the United States (repeatable, no fixed maximum) ──
  const familySection = "Close Family Members in the United States";
  questions.push(
    repeatingGroup("client_closeFamilyMembers", "Close Family Members in the United States", familySection, 1, [
      { key: "fullName", label: "Full Name", type: "text" },
      { key: "relationship", label: "Relationship to Applicant", type: "select", options: RELATIONSHIP_OPTIONS },
      { key: "usResidenceStatus", label: "U.S. Residence Status", type: "select", options: STATUS_OPTIONS },
      { key: "addressLine1", label: "Street Number and Name", type: "text" },
      { key: "addressCity", label: "City or Town", type: "text" },
      { key: "addressState", label: "State", type: "text" },
      { key: "addressPostalCode", label: "ZIP Code", type: "text" },
      { key: "addressCountry", label: "Country", type: "select", options: COUNTRIES },
    ], {
      canonicalPath: "familyMembersInUS", description: "Add every close family member in the United States.",
      metadata: { itemLabel: "Family member", addLabel: "Add family member" },
    })
  );

  // ── Section 4 — Previous Immigration Record ─────────────────────────────
  const priorRecordSection = "Previous Immigration Record";
  questions.push(
    q("client_aNumber", "A-Number", "text", priorRecordSection, 1, { canonicalPath: "person.alienNumber", metadata: { sensitive: true }, validationRules: [{ type: "regex", value: "^[Aa]?-?\\d{7,9}$", message: "Enter your A-Number: 7 to 9 digits, optionally starting with A", severity: "error" }] }),
    q("client_immigrationCategory", "Immigration Category", "text", priorRecordSection, 2, { canonicalPath: "immigration.previousImmigrationCategory" })
  );

  // ── Section 5 — Previous Immigrant Visa (kept separate from the permanent resident card) ──
  const priorVisaSection = "Previous Immigrant Visa";
  questions.push(
    q("client_immigrantVisaDateOfIssue", "Date of Issue", "date", priorVisaSection, 1, { canonicalPath: "immigration.previousImmigrantVisa.issueDate", validationRules: PAST_DATE }),
    q("client_immigrantVisaPlaceOfIssue", "Place of Issue", "text", priorVisaSection, 2, { canonicalPath: "immigration.previousImmigrantVisa.placeOfIssue" })
  );

  // ── Section 6 — Adjustment of Status ─────────────────────────────────────
  const adjustmentSection = "Adjustment of Status";
  const adjustedGate = gate("client_didAdjustStatus", "equals", "Yes");
  questions.push(
    q("client_didAdjustStatus", "Did you ever adjust status?", "radio", adjustmentSection, 1, { options: ["Yes", "No"], canonicalPath: "immigration.adjustmentOfStatus.completed" }),
    q("client_adjustmentDate", "Date of Adjustment of Status", "date", adjustmentSection, 2, { conditionalLogic: adjustedGate, canonicalPath: "immigration.adjustmentOfStatus.date", validationRules: PAST_DATE }),
    q("client_adjustmentPlace", "Place of Adjustment of Status", "text", adjustmentSection, 3, { conditionalLogic: adjustedGate, canonicalPath: "immigration.adjustmentOfStatus.place" })
  );

  // ── Sections 7-9 — initial entry, last entry, most recent departure (stored independently) ──
  const initialEntrySection = "Initial Entry as Lawful Permanent Resident";
  questions.push(
    q("client_initialLprEntryDate", "Date of Entry", "date", initialEntrySection, 1, { canonicalPath: "immigration.permanentResidentHistory.initialEntry.date", validationRules: PAST_DATE }),
    q("client_initialLprPortOfEntry", "Port of Entry", "text", initialEntrySection, 2, { canonicalPath: "immigration.permanentResidentHistory.initialEntry.portOfEntry" })
  );
  const lastEntrySection = "Last Entry as Lawful Permanent Resident";
  questions.push(
    q("client_lastLprEntryDate", "Date of Entry", "date", lastEntrySection, 1, { canonicalPath: "immigration.permanentResidentHistory.lastEntry.date", validationRules: PAST_DATE }),
    q("client_lastLprPortOfEntry", "Port of Entry", "text", lastEntrySection, 2, { canonicalPath: "immigration.permanentResidentHistory.lastEntry.portOfEntry" })
  );
  const departureSection = "Most Recent Departure";
  questions.push(
    q("client_mostRecentDepartureDate", "Date of Departure", "date", departureSection, 1, { canonicalPath: "immigration.permanentResidentHistory.mostRecentDeparture.date", validationRules: PAST_DATE }),
    q("client_mostRecentDestination", "Destination", "text", departureSection, 2, { canonicalPath: "immigration.permanentResidentHistory.mostRecentDeparture.destination" }),
    q("client_reasonForLeavingUs", "Reason for Leaving the United States", "textarea", departureSection, 3, { canonicalPath: "immigration.permanentResidentHistory.mostRecentDeparture.reason" })
  );

  // ── Sections 10-11 — the applicant's own narrative, stored verbatim; never used to decide eligibility ──
  const tiesSection = "Continuing U.S. Ties";
  questions.push(
    q("client_continuingUSTies", "What continuing ties have you maintained with the United States? What efforts have you made to avoid abandoning your permanent resident status in the United States?", "textarea", tiesSection, 1, { canonicalPath: "immigration.returningResident.continuingUSTiesAndRetentionEfforts", metadata: { sourcePath: "client_continuingUSTies" } })
  );
  const delayedReturnSection = "Reason for Delayed Return";
  questions.push(
    q("client_reasonForNotReturning", "What are the reasons for not returning to the United States until the time of this application?", "textarea", delayedReturnSection, 1, { canonicalPath: "immigration.returningResident.reasonsForDelayedReturn", metadata: { sourcePath: "client_reasonForNotReturning" } })
  );

  // ── Section 12 — periods lived outside the United States for six months or longer (repeatable, end date >= start date) ──
  const periodsOutsideSection = "Periods Outside the United States";
  questions.push(
    repeatingGroup("client_periodsOutsideUs", "List all periods during which you lived outside the United States for six months or longer since your initial entry as a permanent resident.", periodsOutsideSection, 1, [
      { key: "fromDate", label: "From Date", type: "date" },
      { key: "toDate", label: "To Date", type: "date" },
      { key: "country", label: "Country", type: "select", options: COUNTRIES },
    ], {
      canonicalPath: "immigration.residenceAbroadPeriods", description: "Add every period. Add as many entries as needed.",
      metadata: { itemLabel: "Period", addLabel: "Add period", rowRules: [{ type: "dateOrder", start: "fromDate", end: "toDate", message: "The end date cannot be before the start date." }] },
    })
  );

  // ── Section 13 — employment outside the United States ───────────────────
  const foreignEmploymentSection = "Employment Outside the United States";
  const employedOutsideGate = gate("client_employedOutsideUs", "equals", "Yes");
  questions.push(
    q("client_employedOutsideUs", "Have you been employed outside the United States since your most recent departure from the United States?", "radio", foreignEmploymentSection, 1, { options: ["Yes", "No"], canonicalPath: "immigration.returningResident.employmentOutsideUS.sinceMostRecentDeparture" }),
    repeatingGroup("client_foreignEmployment", "Employment Outside the United States", foreignEmploymentSection, 2, [
      { key: "employerName", label: "Employer Name", type: "text" },
      { key: "addressLine1", label: "Employer Street Number and Name", type: "text" },
      { key: "addressCity", label: "Employer City or Town", type: "text" },
      { key: "addressState", label: "Employer State / Province", type: "text" },
      { key: "addressPostalCode", label: "Employer Postal Code", type: "text" },
      { key: "addressCountry", label: "Employer Country", type: "select", options: COUNTRIES },
      { key: "fromDate", label: "From Date", type: "date" },
      { key: "toDate", label: "To Date", type: "date" },
    ], {
      conditionalLogic: employedOutsideGate, canonicalPath: "immigration.returningResident.employmentOutsideUS.records",
      description: "Add every employer outside the United States since your most recent departure.",
      metadata: { itemLabel: "Employer", addLabel: "Add employer", rowRules: [{ type: "dateOrder", start: "fromDate", end: "toDate", message: "The end date cannot be before the start date." }] },
    })
  );

  // ── Document Checklist ────────────────────────────────────────────────────
  const identitySection = "Identity and Immigration Status";
  questions.push(
    documentQuestion("sb1_doc_passport", "Passport — all pages except blank pages", identitySection, 1, { required: false, category: "identity", classification: "supporting" }),
    documentQuestion("sb1_doc_greenCard", "Permanent Resident Card (Form I-551)", identitySection, 2, { required: false, category: "identity", classification: "supporting" }),
    documentQuestion("sb1_doc_reentryPermit", "Re-entry Permit, if available", identitySection, 3, { required: false, category: "immigration", classification: "conditional", conditionalLogic: gate("client_hasReentryPermit", "equals", "Yes") })
  );

  const travelHistorySection = "Travel History";
  questions.push(
    documentQuestion("sb1_doc_travelRecords", "Airline tickets/travel records showing dates of travel outside the United States", travelHistorySection, 1, { required: false, category: "other", classification: "supporting" }),
    documentQuestion("sb1_doc_passportEntryExitStamps", "Passport pages containing relevant entry/exit stamps", travelHistorySection, 2, { required: false, category: "identity", classification: "supporting" })
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
    title: "SB-1 Visa Questionnaire",
    // the stored questionnaire predates this title: bring its identity fields up to date in place
    reconcileMetadata: true,
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
