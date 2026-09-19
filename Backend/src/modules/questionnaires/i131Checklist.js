// Converts Form I-131's supplied questionnaire/checklist into a real
// Questionnaire/Question template definition, in the same shape as
// questionnaire.service.js's VISA_TEMPLATE_DEFINITIONS — mirrors
// singlePartyChecklists.js's single-role ("client") conversion pattern
// (I-131 has one applicant, no petitioner/beneficiary/employer/employee
// split), but is its own separate, self-contained file.
//
// CRITICAL — deliberately NOT isDefault, and NOT scoped to any real visa
// type: unlike every other visa's checklist (which appears automatically
// the moment a case of that visa type exists — see
// questionnaire.service.js's resolveCaseQuestionnaires), I-131 is a
// CONDITIONAL form. It must only ever reach a client through an explicit
// Case.questionnaireReferences entry, created at the exact moment a Case
// Manager/Team Lead approves it via visaFormMapping.service.js's
// recordConditionalDecision (see that file's ADD branch). visaType:"I131"
// below is a pseudo-value no real Case.visaType will ever equal (real
// case visa types are things like "EB-1A", "H-1B", "K-3" —
// resolveCaseQuestionnaires normalizes and matches against those, never
// against this literal string) — combined with isDefault:false, this is a
// double guarantee against the default-template auto-resolution path ever
// surfacing this checklist without an explicit staff approval action.
//
// Source: the supplied "Form I-131 Checklist" document (Questionnaire +
// Documents Required sections). Every field label/document name below is
// verbatim from that source. The "I am applying for" selection (§12) is
// the authoritative purpose driver for every conditional section/document
// below, exactly as the source specifies.

const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];
const VISIBILITY = { roles: ["client", ...STAFF_ROLES], portals: ["client", "admin"] };

const PURPOSE = {
  REENTRY_PERMIT: "REENTRY_PERMIT",
  REFUGEE_TRAVEL_DOCUMENT: "REFUGEE_TRAVEL_DOCUMENT",
  ADVANCE_PAROLE_INSIDE_US: "ADVANCE_PAROLE_INSIDE_US",
  ADVANCE_PAROLE_OUTSIDE_US_FOR_SELF: "ADVANCE_PAROLE_OUTSIDE_US_FOR_SELF",
  ADVANCE_PAROLE_FOR_PERSON_OUTSIDE_US: "ADVANCE_PAROLE_FOR_PERSON_OUTSIDE_US",
};
const ADVANCE_PAROLE_PURPOSES = [
  PURPOSE.ADVANCE_PAROLE_INSIDE_US,
  PURPOSE.ADVANCE_PAROLE_OUTSIDE_US_FOR_SELF,
  PURPOSE.ADVANCE_PAROLE_FOR_PERSON_OUTSIDE_US,
];
// "I am applying for:" options — verbatim labels from the supplied
// checklist's §12, machine value on the left.
const PURPOSE_OPTIONS = [
  { label: "Re-entry Permit", value: PURPOSE.REENTRY_PERMIT },
  { label: "Refugee Travel Document", value: PURPOSE.REFUGEE_TRAVEL_DOCUMENT },
  { label: "Advance Parole (from inside USA)", value: PURPOSE.ADVANCE_PAROLE_INSIDE_US },
  { label: "Advance Parole (from outside USA)", value: PURPOSE.ADVANCE_PAROLE_OUTSIDE_US_FOR_SELF },
  { label: "Advance Parole (for someone who is outside USA)", value: PURPOSE.ADVANCE_PAROLE_FOR_PERSON_OUTSIDE_US },
];

function slugSection(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

// purposeEquals/purposeIn — the two conditionalLogic shapes every gated
// section/document below needs; both compare against the single "I am
// applying for" question's own key (i131_purpose), the one authoritative
// driver per §12.
function purposeEquals(value) {
  return { mode: "all", rules: [{ questionKey: "i131_purpose", operator: "equals", value }], groups: [] };
}
// Deliberately mode:"any" + one "equals" rule per value rather than a
// single operator:"in" rule: Question.js's pre-save hook derives the
// legacy `showIf` field from conditionalLogic.rules[0] for backward
// compatibility, and its operatorMap has no translation for "in"/"not_in"
// — showIf.operator's schema enum then rejects the literal string "in"
// outright (confirmed live: `Question validation failed: showIf.operator:
// 'in' is not a valid enum value`). This is a real, pre-existing gap in
// that shared hook (affects any future questionnaire using "in", not just
// this one) — see the I-131 report's "Remaining limitations" section;
// worked around here rather than touched, since Question.js's pre-save
// hook is shared infrastructure well outside this file's scope.
function purposeIn(values) {
  return { mode: "any", rules: values.map((value) => ({ questionKey: "i131_purpose", operator: "equals", value })), groups: [] };
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
    // canonicalPath (when present) is the pre-fill/sync hint: §11's "where
    // the CRM already has this information in the canonical client/case
    // profile, pre-fill it" — a top-level sibling field (not nested under
    // metadata), read by the same CanonicalBuilderService.
    // addQuestionnaireCandidates path employmentChecklists.js's
    // mapping.canonicalPath already resolves through for every other
    // visa's biographic section, not a new prefill mechanism.
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
    metadata: { documentType, category: extras.category, ...(extras.metadata || {}) },
    visibility: VISIBILITY,
    conditionalLogic: extras.conditionalLogic,
  });
}

function buildI131Questionnaire() {
  const questions = [];

  // ── Section A — Information About You (§11) — pre-filled from the
  // canonical profile where the CRM already has it. canonicalPath values
  // match the same dot-paths CanonicalProfileService/AutoFillService
  // already read for every other form's biographic section (name/DOB/
  // address/A-Number/SSN/citizenship/country of birth/class of admission
  // — the exact list §27 calls out as never-duplicate).
  const infoSection = "Information about you";
  questions.push(
    buildQuestion("i131_applicant_lastName", "Last Name", "text", infoSection, 1, { required: true, canonicalPath: "applicant.lastName" }),
    buildQuestion("i131_applicant_firstName", "First Name", "text", infoSection, 2, { required: true, canonicalPath: "applicant.firstName" }),
    buildQuestion("i131_applicant_middleName", "Middle Name", "text", infoSection, 3, { canonicalPath: "applicant.middleName" }),
    buildQuestion("i131_applicant_gender", "Gender", "select", infoSection, 4, { options: ["Male", "Female"], canonicalPath: "applicant.gender" }),
    buildQuestion("i131_applicant_dateOfBirth", "Date of Birth", "date", infoSection, 5, { required: true, canonicalPath: "applicant.dateOfBirth" }),
    buildQuestion("i131_applicant_countryOfBirth", "Country of Birth", "text", infoSection, 6, { required: true, canonicalPath: "applicant.countryOfBirth" }),
    buildQuestion("i131_applicant_countryOfCitizenship", "Country of Citizenship", "text", infoSection, 7, { required: true, canonicalPath: "applicant.countryOfCitizenship" }),
    buildQuestion("i131_applicant_aNumber", "A-Number", "text", infoSection, 8, { canonicalPath: "applicant.aNumber" }),
    buildQuestion("i131_applicant_ssn", "Social Security Number", "text", infoSection, 9, { canonicalPath: "applicant.ssn" }),
    buildQuestion("i131_applicant_classOfAdmission", "Class of Admission", "text", infoSection, 10, { canonicalPath: "applicant.classOfAdmission" }),
    buildQuestion("i131_applicant_physicalAddress", "Physical Address", "text", infoSection, 11, { required: true, canonicalPath: "applicant.physicalAddress" })
  );

  // ── §12 — the single authoritative purpose driver ──────────────────────
  const purposeSection = "I am applying for";
  questions.push(
    buildQuestion("i131_purpose", "I am applying for:", "select", purposeSection, 1, { required: true, options: PURPOSE_OPTIONS })
  );

  // ── §13 — Outside-USA beneficiary, ONLY for that one purpose ───────────
  const outsideUsaSection = "Person filing for, who is outside the USA";
  const outsideUsaGate = purposeEquals(PURPOSE.ADVANCE_PAROLE_FOR_PERSON_OUTSIDE_US);
  questions.push(
    buildQuestion("i131_outsideUsa_lastName", "Last Name", "text", outsideUsaSection, 1, { required: true, conditionalLogic: outsideUsaGate }),
    buildQuestion("i131_outsideUsa_firstName", "First Name", "text", outsideUsaSection, 2, { required: true, conditionalLogic: outsideUsaGate }),
    buildQuestion("i131_outsideUsa_middleName", "Middle Name", "text", outsideUsaSection, 3, { conditionalLogic: outsideUsaGate }),
    buildQuestion("i131_outsideUsa_dateOfBirth", "Date of Birth", "date", outsideUsaSection, 4, { required: true, conditionalLogic: outsideUsaGate }),
    buildQuestion("i131_outsideUsa_countryOfBirth", "Country of Birth", "text", outsideUsaSection, 5, { conditionalLogic: outsideUsaGate }),
    buildQuestion("i131_outsideUsa_countryOfCitizenship", "Country of Citizenship", "text", outsideUsaSection, 6, { conditionalLogic: outsideUsaGate }),
    buildQuestion("i131_outsideUsa_daytimePhone", "Day Time Phone Number", "text", outsideUsaSection, 7, { conditionalLogic: outsideUsaGate }),
    buildQuestion("i131_outsideUsa_physicalAddress", "Physical Address (Outside USA)", "text", outsideUsaSection, 8, { required: true, conditionalLogic: outsideUsaGate })
  );

  // ── §14 — Processing Information ───────────────────────────────────────
  const processingSection = "Processing Information";
  const previouslyIssuedGate = { mode: "all", rules: [{ questionKey: "i131_previouslyIssued", operator: "equals", value: "yes" }], groups: [] };
  questions.push(
    buildQuestion("i131_dateOfIntendedDeparture", "Date of Intended Departure", "date", processingSection, 1),
    buildQuestion("i131_expectedLengthOfTrip", "Expected Length of Trip", "text", processingSection, 2),
    buildQuestion("i131_previouslyIssued", "Have you ever before been issued a reentry permit or Refugee Travel Document?", "radio", processingSection, 3, { options: ["yes", "no"] }),
    buildQuestion("i131_previouslyIssued_dateIssued", "Date Issued", "date", processingSection, 4, { conditionalLogic: previouslyIssuedGate }),
    buildQuestion("i131_previouslyIssued_disposition", "Disposition (attached, lost, etc.)", "text", processingSection, 5, { conditionalLogic: previouslyIssuedGate })
  );

  // ── §15 — Travel Document Delivery ─────────────────────────────────────
  const deliverySection = "Where do you want this travel document sent?";
  const DELIVERY_OPTIONS = [
    { label: "Your Physical Address", value: "PHYSICAL_ADDRESS" },
    { label: "To a U.S. Embassy or consulate", value: "US_EMBASSY_OR_CONSULATE" },
    { label: "To a DHS office overseas", value: "DHS_OFFICE_OVERSEAS" },
  ];
  const embassyGate = { mode: "all", rules: [{ questionKey: "i131_delivery_method", operator: "equals", value: "US_EMBASSY_OR_CONSULATE" }], groups: [] };
  const dhsGate = { mode: "all", rules: [{ questionKey: "i131_delivery_method", operator: "equals", value: "DHS_OFFICE_OVERSEAS" }], groups: [] };
  questions.push(
    buildQuestion("i131_delivery_method", "Where do you want this travel document sent?", "select", deliverySection, 1, { required: true, options: DELIVERY_OPTIONS }),
    buildQuestion("i131_delivery_embassyCity", "City", "text", deliverySection, 2, { conditionalLogic: embassyGate }),
    buildQuestion("i131_delivery_embassyCountry", "Country", "text", deliverySection, 3, { conditionalLogic: embassyGate }),
    buildQuestion("i131_delivery_dhsCity", "City", "text", deliverySection, 4, { conditionalLogic: dhsGate }),
    buildQuestion("i131_delivery_dhsCountry", "Country", "text", deliverySection, 5, { conditionalLogic: dhsGate })
  );

  // ── §16 — Travel Information — countries as a real repeating group (an
  // actual array once answered), not a comma-separated string, per the
  // spec's explicit schema preference. "repeating_group" + a single-column
  // REPEATABLE_FIELDS entry is this codebase's existing array-of-values
  // pattern (see k1.js's statesCountriesSince18), not a new "list" type —
  // Question.type has no such enum value.
  const travelSection = "Travel Information";
  questions.push(
    buildQuestion("i131_travel_purposeOfTrip", "Purpose of Trip", "text", travelSection, 1),
    buildQuestion("i131_travel_intendedCountries", "List the countries you intend to visit", "repeating_group", travelSection, 2, {
      description: "Add each country you intend to visit as a separate entry.",
      repeatable: true,
      metadata: { sourcePath: "i131.travel.intendedCountries", fields: [{ key: "country", label: "Country", type: "text" }] },
    })
  );

  // ── §17 — Reentry Permit conditional section ───────────────────────────
  const reentrySection = "If applying for Re-Entry Permit";
  const reentryGate = purposeEquals(PURPOSE.REENTRY_PERMIT);
  questions.push(
    buildQuestion(
      "i131_reentry_totalTimeOutsideUS",
      "Since becoming a permanent resident of the United States (or during the past 5 years, whichever is less) how much total time have you spent outside the United States?",
      "text",
      reentrySection,
      1,
      { conditionalLogic: reentryGate }
    )
  );

  // ── §18 — Refugee Travel Document conditional section — structured
  // booleans, not free text, per the spec. ───────────────────────────────
  const refugeeSection = "If Applying for a Refugee Travel Document";
  const refugeeGate = purposeEquals(PURPOSE.REFUGEE_TRAVEL_DOCUMENT);
  questions.push(
    buildQuestion("i131_refugee_countryOfRefugeeAsylee", "Country from which you are a refugee or asylee", "text", refugeeSection, 1, { conditionalLogic: refugeeGate }),
    buildQuestion("i131_refugee_plansToTravel", "Do you plan to travel to the country named above?", "radio", refugeeSection, 2, { options: ["yes", "no"], conditionalLogic: refugeeGate }),
    buildQuestion("i131_refugee_everReturned", "Have you ever returned to the country named above?", "radio", refugeeSection, 3, { options: ["yes", "no"], conditionalLogic: refugeeGate }),
    buildQuestion("i131_refugee_everAppliedNationalPassport", "Have you ever applied for and/or obtained a national passport, passport renewal, or entry permit of that country?", "radio", refugeeSection, 4, { options: ["yes", "no"], conditionalLogic: refugeeGate }),
    buildQuestion("i131_refugee_everAppliedBenefits", "Have you ever applied for and/or received any benefit from such country (for example, health insurance benefits)?", "radio", refugeeSection, 5, { options: ["yes", "no"], conditionalLogic: refugeeGate }),
    buildQuestion("i131_refugee_everReacquiredNationality", "Have you ever reacquired the nationality of the country named above?", "radio", refugeeSection, 6, { options: ["yes", "no"], conditionalLogic: refugeeGate }),
    buildQuestion("i131_refugee_everAcquiredNewNationality", "Have you ever acquired a new nationality?", "radio", refugeeSection, 7, { options: ["yes", "no"], conditionalLogic: refugeeGate }),
    buildQuestion("i131_refugee_everGrantedElsewhere", "Have you ever been granted refugee or asylee status in any other country?", "radio", refugeeSection, 8, { options: ["yes", "no"], conditionalLogic: refugeeGate })
  );

  // ── §19 — Advance Parole conditional section (all 3 AP purposes) ───────
  const advanceParoleSection = "If Applying for Advance Parole";
  const advanceParoleGate = purposeIn(ADVANCE_PAROLE_PURPOSES);
  questions.push(
    buildQuestion("i131_ap_numberOfTrips", "How many trips do you intend to use this document?", "radio", advanceParoleSection, 1, { options: ["One Trip", "Multiple Trips"], conditionalLogic: advanceParoleGate }),
    buildQuestion("i131_ap_pickupAddress", "Where do you want the notice to pick up the document be sent? Provide full address", "text", advanceParoleSection, 2, { conditionalLogic: advanceParoleGate })
  );

  // ── §20-24 — Documents Required, purpose-gated. Verbatim item text from
  // the supplied checklist; required/optional exactly as the source states
  // (no item is force-upgraded or downgraded). ───────────────────────────
  const generalDocsSection = "General Documents";
  questions.push(
    documentQuestion("i131_doc_passportPhotos", "Two (2) U.S passport sized photos", generalDocsSection, 1, { required: true, category: "identity" }),
    documentQuestion("i131_doc_foreignPassport", "Copy of Foreign Passport", generalDocsSection, 2, { required: true, category: "identity" }),
    documentQuestion("i131_doc_permanentResidentCard", "Copy of Permanent Resident Card", generalDocsSection, 3, { required: false, category: "identity" }),
    documentQuestion("i131_doc_socialSecurityCard", "Copy of Social Security Card", generalDocsSection, 4, { required: false, category: "identity" }),
    documentQuestion("i131_doc_driversLicenseOrStateId", "Copy of Driver's License or State Identification Card", generalDocsSection, 5, { required: false, category: "identity" }),
    documentQuestion("i131_doc_previousReentryPermit", "Previous Re-Entry permit (if any)", generalDocsSection, 6, { required: false, category: "immigration" })
  );

  const refugeeDocsSection = "For a refugee travel document";
  questions.push(
    documentQuestion("i131_doc_refugee_photoId", "Copy of an official photo identity document", refugeeDocsSection, 1, { required: true, category: "identity", conditionalLogic: refugeeGate }),
    documentQuestion("i131_doc_refugee_statusProof", "Proof of refugee or asylee status", refugeeDocsSection, 2, { required: true, category: "immigration", conditionalLogic: refugeeGate }),
    documentQuestion("i131_doc_refugee_photosIfOutsideUS", "Two identical color passport-style photographs (if outside the United States, taken within 30 days of filing)", refugeeDocsSection, 3, { required: false, category: "identity", conditionalLogic: refugeeGate }),
    documentQuestion("i131_doc_refugee_lastDepartureEvidence", "Evidence of your last date of departure from the United States, if available (airline tickets, boarding passes, etc.)", refugeeDocsSection, 4, { required: false, category: "immigration", conditionalLogic: refugeeGate }),
    documentQuestion("i131_doc_refugee_feeReceipt", "Fee receipt as proof of the applicable filing fee(s) paid outside the United States", refugeeDocsSection, 5, { required: false, category: "other", conditionalLogic: refugeeGate }),
    // §21's 5 structured statement tasks — never one generic upload, per the spec.
    documentQuestion("i131_doc_refugee_statement_purposeOfTrip", "Statement: the purpose of your trip outside the United States, with documentary evidence to support your reasons for departure if available", refugeeDocsSection, 6, { required: true, category: "statement", conditionalLogic: refugeeGate }),
    documentQuestion("i131_doc_refugee_statement_reasonForDeparture", "Statement: the reason you departed the United States without first applying for a refugee travel document", refugeeDocsSection, 7, { required: true, category: "statement", conditionalLogic: refugeeGate }),
    documentQuestion("i131_doc_refugee_statement_travelHistory", "Statement: a description of where you have traveled since your departure from the United States", refugeeDocsSection, 8, { required: true, category: "statement", conditionalLogic: refugeeGate }),
    documentQuestion("i131_doc_refugee_statement_activitiesAbroad", "Statement: your activities while outside the United States", refugeeDocsSection, 9, { required: true, category: "statement", conditionalLogic: refugeeGate }),
    documentQuestion("i131_doc_refugee_statement_intentRegardingStatus", "Statement: an explanation of whether you intended to abandon your refugee or asylum status at the time you left the United States", refugeeDocsSection, 10, { required: true, category: "statement", conditionalLogic: refugeeGate })
  );

  const reentryDocsSection = "For a re-entry permit";
  questions.push(
    documentQuestion("i131_doc_reentry_photoId", "A copy of an official photo identity document", reentryDocsSection, 1, { required: true, category: "identity", conditionalLogic: reentryGate }),
    documentQuestion("i131_doc_reentry_greenCardFrontBack", "A copy of the front and back of your Permanent Resident Card (Green Card / Form I-551)", reentryDocsSection, 2, { required: true, category: "immigration", conditionalLogic: reentryGate }),
    documentQuestion("i131_doc_reentry_passportBioAndVisaPage", "A copy of the biographic pages of your passport and the immigrant visa page showing your initial admission as a lawful permanent resident", reentryDocsSection, 3, { required: true, category: "identity", conditionalLogic: reentryGate }),
    documentQuestion("i131_doc_reentry_i797ReplacementNotice", "A copy of Form I-797, Notice of Action, approval notice of your application to replace your Permanent Resident Card, if applicable", reentryDocsSection, 4, { required: false, category: "immigration", conditionalLogic: reentryGate }),
    documentQuestion("i131_doc_reentry_temporaryLprEvidence", "Temporary evidence of lawful permanent resident status, if applicable", reentryDocsSection, 5, { required: false, category: "immigration", conditionalLogic: reentryGate }),
    documentQuestion("i131_doc_reentry_certifiedTranslations", "Certified English translations of non-English documents, if applicable", reentryDocsSection, 6, { required: false, category: "other", conditionalLogic: reentryGate })
  );

  const apInsideDocsSection = "For an advance parole document for individuals currently in the United States";
  const apInsideGate = purposeEquals(PURPOSE.ADVANCE_PAROLE_INSIDE_US);
  questions.push(
    documentQuestion("i131_doc_apInside_photoId", "A copy of an official photo identity document", apInsideDocsSection, 1, { required: true, category: "identity", conditionalLogic: apInsideGate }),
    documentQuestion("i131_doc_apInside_passportPhotos", "Two identical passport-style photographs taken within 30 days of filing", apInsideDocsSection, 2, { required: true, category: "identity", conditionalLogic: apInsideGate }),
    documentQuestion("i131_doc_apInside_currentStatusEvidence", "A copy of any document showing your current status in the United States", apInsideDocsSection, 3, { required: true, category: "immigration", conditionalLogic: apInsideGate }),
    documentQuestion("i131_doc_apInside_tripPurposeEvidence", "Evidence that your trip is for educational, employment, or humanitarian purposes", apInsideDocsSection, 4, { required: true, category: "other", conditionalLogic: apInsideGate }),
    documentQuestion("i131_doc_apInside_circumstancesExplanation", "An explanation or other evidence showing the circumstances that warrant issuance of an advance parole document", apInsideDocsSection, 5, { required: true, category: "statement", conditionalLogic: apInsideGate }),
    documentQuestion("i131_doc_apInside_i485ReceiptIfApplicable", "A copy of a USCIS receipt as evidence that you filed the adjustment application, if you are an applicant for adjustment of status", apInsideDocsSection, 6, { required: false, category: "immigration", conditionalLogic: apInsideGate }),
    documentQuestion("i131_doc_apInside_canadaConsularAppointmentIfApplicable", "A copy of the U.S. consular appointment letter, if you are traveling to Canada to apply for an immigrant visa", apInsideDocsSection, 7, { required: false, category: "other", conditionalLogic: apInsideGate })
  );

  const apOutsideDocsSection = "For advance parole for someone outside the United States";
  const apOutsideGate = purposeEquals(PURPOSE.ADVANCE_PAROLE_FOR_PERSON_OUTSIDE_US);
  questions.push(
    documentQuestion("i131_doc_apOutside_photoIds", "A copy of a photo identity document for beneficiary, petitioner, and sponsor", apOutsideDocsSection, 1, { required: true, category: "identity", conditionalLogic: apOutsideGate }),
    documentQuestion("i131_doc_apOutside_beneficiaryPassportPage", "A copy of the beneficiary's passport identity page", apOutsideDocsSection, 2, { required: true, category: "identity", conditionalLogic: apOutsideGate }),
    documentQuestion("i131_doc_apOutside_humanitarianDescription", "A description of the urgent humanitarian or significant public benefit reason, including documentation of need for expedited handling and the length of time parole is needed", apOutsideDocsSection, 3, { required: true, category: "statement", conditionalLogic: apOutsideGate }),
    documentQuestion("i131_doc_apOutside_i134", "A completed Form I-134 with appropriate supporting documentation", apOutsideDocsSection, 4, { required: true, category: "immigration", conditionalLogic: apOutsideGate }),
    documentQuestion("i131_doc_apOutside_cannotObtainVisaStatement", "A statement explaining why the beneficiary cannot obtain a U.S. visa (if applicable)", apOutsideDocsSection, 5, { required: false, category: "statement", conditionalLogic: apOutsideGate }),
    documentQuestion("i131_doc_apOutside_cannotObtainWaiverStatement", "A statement explaining why the beneficiary cannot obtain a waiver of inadmissibility (if applicable)", apOutsideDocsSection, 6, { required: false, category: "statement", conditionalLogic: apOutsideGate }),
    documentQuestion("i131_doc_apOutside_priorDecisions", "A copy of any decision on immigrant/nonimmigrant applications or petitions", apOutsideDocsSection, 7, { required: false, category: "immigration", conditionalLogic: apOutsideGate })
  );

  const sections = [
    infoSection, purposeSection, outsideUsaSection, processingSection, deliverySection, travelSection,
    reentrySection, refugeeSection, advanceParoleSection,
    generalDocsSection, refugeeDocsSection, reentryDocsSection, apInsideDocsSection, apOutsideDocsSection,
  ];

  return {
    key: "i131_checklist",
    title: "Form I-131 — Application for Travel Documents, Parole Documents, and Arrival/Departure Records",
    // Pseudo visa type — see the file banner. Never matches a real
    // Case.visaType, and isDefault is false, so this template is reachable
    // ONLY through an explicit questionnaireReferences assignment (see
    // visaFormMapping.service.js's recordConditionalDecision).
    visaType: "I131",
    checklistRole: "client",
    isDefault: false,
    description: "",
    sections,
    questions,
  };
}

const I131_CHECKLIST_DEFINITION = buildI131Questionnaire();

module.exports = { I131_CHECKLIST_DEFINITION, PURPOSE, ADVANCE_PAROLE_PURPOSES };
