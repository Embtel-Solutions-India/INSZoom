// H-4 crosswalk — canonical/questionnaire -> I-765 (Application for
// Employment Authorization) field mapping, scoped to the H-4 EAD checklist
// content only (applicant name, A-Number, USCIS Online Account Number,
// mailing/physical address, country of birth/citizenship, DOB, SSN,
// daytime phone, email, most-recent-entry info, EAD application type
// new/replacement/renewal, and eligibility category if an explicit field
// exists — see below, it does not appear to in this edition). See
// i129-h1b-crosswalk.js for the full rationale behind checkboxMatch(), the
// MANUAL_ENTRY_FIELDS split, and classifyField()'s bucket contract.
//
// ============================================================================
// SOURCE-CONFIDENCE HEADER — read before trusting any edge below. This one
// is WEAKER than every other crosswalk in this codebase on the TARGET-FIELD
// side, not just the source side — read carefully.
// ============================================================================
// TARGET FIELDS: NOT from a template already in this repo. Unlike I-539 (a
// real PDF already checked into dev-assets/uscis/), this codebase has NO
// I-765 PDF, NO uscis-form-import seed, and NO USCISFormTemplate for I-765
// anywhere — confirmed by searching the full Backend/ tree at authoring
// time. VisaFormMapping registry entries reference formCode "i-765"
// (form-registry/seeds/visaFormMappings.seed.js), and
// OnDemandFormAcquisitionService exists to fetch+import a form like this on
// demand from uscis.gov, but nothing has actually run that for I-765 in
// this environment.
//
// To have ANY real field-name source rather than inventing one, this file's
// fieldName values were extracted with pdf-lib (same normalizePdf/qpdf
// pipeline as every other crosswalk) against the CURRENT PUBLIC I-765 PDF
// fetched live from https://www.uscis.gov/sites/default/files/document/
// forms/i-765.pdf at authoring time (2026-09-24) — confirmed to be the
// genuine Form I-765 by its embedded OMB control number, 1615-0040. 161
// fields, 7 pages. This is REAL USCIS field data, not guessed — but it is
// NOT the field inventory of whatever USCISFormTemplate this codebase
// eventually imports and activates for I-765. USCIS occasionally revises
// field names/structure between editions, and the exact edition date of
// the fetched PDF was not able to be extracted from its (stripped) text
// layer in this task. Before this crosswalk's seed
// (../seeds/i765-h4-mapping.seed.js) is run against a real
// USCISFormTemplate, a human MUST re-diff this file's fieldName values
// against that template's actual formFields — classifyField() will simply
// report every field manual_entry if the names have drifted, which is
// safe (no silent misfill) but means this crosswalk may need field-name
// updates before it's useful.
//
// SOURCE PATHS: same two-tier confidence as i539-h4-crosswalk.js —
// person.*/contact.*/immigration.* paths are VERIFIED against
// profileCanonicalMap.js's real EMPLOYEE_PROFILE_TO_CANONICAL table;
// raw.questionnaireAnswers.client_*.value paths assume h4Checklist.js
// question keys that do not exist yet and are GUESSED, not verified — see
// i539-h4-crosswalk.js's header for the full explanation (identical
// situation, not repeated here). Every edge carries `sourceVerified`.
//
// ELIGIBILITY CATEGORY (c)(26): no field name in this PDF's 161 AcroForm
// fields contains "Eligibility", "Category", or a "(c)(26)"-style token.
// Unlike a typical printed I-765 (which usually has a free-text eligibility
// category box), this edition's category selection may be encoded
// differently (e.g. folded into Part 1's Item 1 New/Replacement/Renewal
// selector, which IS mapped below) or may require a value not derivable
// from field names alone. NOT mapped — flagged here as an explicit gap per
// this task's own instructions, rather than guessed.
function checkboxMatch(source, value) {
  return { condition: { field: source, operator: Array.isArray(value) ? "in" : "equals", value }, transform: { type: "boolean" } };
}

const OUT_OF_SCOPE_PAGES = new Set([]);
const USCIS_USE_ONLY_PATTERNS = [/PDF417BarCode/];

// ---------------------------------------------------------------------------
const MAPPED_EDGES = [
  // --- Part 1: Reason for Applying / Your Full Name (page 1) ---
  { fieldName: "form1[0].Page1[0].Line1a_FamilyName[0]", source: "person.lastName", sourceVerified: true, note: "Applicant family name." },
  { fieldName: "form1[0].Page1[0].Line1b_GivenName[0]", source: "person.firstName", sourceVerified: true, note: "Applicant given name." },
  { fieldName: "form1[0].Page1[0].Line1c_MiddleName[0]", source: "person.middleName", sourceVerified: true, note: "Applicant middle name." },
  // Item 1, reason for applying — 3 independent checkboxes, onValues "1"/
  // "2"/"3" in field-definition order. Standard I-765 Item 1 order is
  // 1=Initial permission to accept employment, 2=Replacement (lost/stolen/
  // damaged, or renewal of expired EAD without a change in circumstances),
  // 3=Renewal. Mirrors the H-1B crosswalk's own "WageLevelBox" caveat:
  // ASSUMED definition-order mapping, not independently confirmed against
  // the printed form's own visual order — requires human verification
  // before relying on this for a real filing.
  { fieldName: "form1[0].Page1[0].Part1_Checkbox[0]", source: "raw.questionnaireAnswers.client_eadApplicationType.value", sourceVerified: false, ...checkboxMatch("raw.questionnaireAnswers.client_eadApplicationType.value", ["New", "Initial"]), note: "Item 1, reason for applying — ASSUMED option 1 = Initial/New permission. Question key AND option value strings both GUESSED." },
  { fieldName: "form1[0].Page1[0].Part1_Checkbox[1]", source: "raw.questionnaireAnswers.client_eadApplicationType.value", sourceVerified: false, ...checkboxMatch("raw.questionnaireAnswers.client_eadApplicationType.value", "Replacement"), note: "Item 1, reason for applying — ASSUMED option 2 = Replacement. See option [0]'s note." },
  { fieldName: "form1[0].Page1[0].Part1_Checkbox[2]", source: "raw.questionnaireAnswers.client_eadApplicationType.value", sourceVerified: false, ...checkboxMatch("raw.questionnaireAnswers.client_eadApplicationType.value", "Renewal"), note: "Item 1, reason for applying — ASSUMED option 3 = Renewal. See option [0]'s note." },

  // --- Part 2: Information About You (page 2) ---
  { fieldName: "form1[0].Page2[0].Line4b_StreetNumberName[0]", source: "contact.address.line1", sourceVerified: true, note: "Mailing address, street." },
  { fieldName: "form1[0].Page2[0].Pt2Line5_CityOrTown[0]", source: "contact.address.city", sourceVerified: true, note: "Mailing address, city." },
  { fieldName: "form1[0].Page2[0].Pt2Line5_State[0]", source: "contact.address.state", sourceVerified: true, note: "Mailing address, state (dropdown)." },
  { fieldName: "form1[0].Page2[0].Pt2Line5_ZipCode[0]", source: "contact.address.zip", sourceVerified: true, note: "Mailing address, ZIP." },
  { fieldName: "form1[0].Page2[0].Pt2Line7_StreetNumberName[0]", source: "contact.address.line1", sourceVerified: true, note: "Physical address (if different), street. Canonical data holds only one address — see i539-h4-crosswalk.js's identical note on this limitation." },
  { fieldName: "form1[0].Page2[0].Pt2Line7_CityOrTown[0]", source: "contact.address.city", sourceVerified: true, note: "Physical address city — see the street field's note." },
  { fieldName: "form1[0].Page2[0].Pt2Line7_State[0]", source: "contact.address.state", sourceVerified: true, note: "Physical address state — see the street field's note." },
  { fieldName: "form1[0].Page2[0].Pt2Line7_ZipCode[0]", source: "contact.address.zip", sourceVerified: true, note: "Physical address ZIP — see the street field's note." },
  { fieldName: "form1[0].Page2[0].Line17b_CountryOfBirth[0]", source: "person.countryOfBirth", sourceVerified: true, note: "Item 17.b, country of birth. Item 17.a's own widget (Line17a_CountryOfBirth[0]) shares this exact field name despite 17.a conventionally being City/Town of Birth on this form — a likely template-authoring artifact (duplicate/misnamed field), not evidence 17.a should map here too. Left in MANUAL_ENTRY_FIELDS as ambiguous." },
  { fieldName: "form1[0].Page2[0].Line12b_SSN[0]", source: "raw.questionnaireAnswers.client_ssn.value", sourceVerified: false, note: "Social Security Number. Question key GUESSED — see file header." },
  { fieldName: "form1[0].Page2[0].Line7_AlienNumber[0]", source: "person.alienNumber", sourceVerified: true, note: "A-Number. Format/max-length NOT confirmed (no ValidationService run possible during authoring) — see i539-h4-crosswalk.js's identical caveat on its own AlienNumber edge." },
  { fieldName: "form1[0].Page2[0].Line8_ElisAccountNumber[0]", source: "raw.questionnaireAnswers.client_uscisOnlineAccountNumber.value", sourceVerified: false, note: "USCIS Online (ELIS) Account Number. Question key GUESSED — reuses the same key i539-h4-crosswalk.js guesses for its equivalent field, so the two forms stay consistent with each other even though neither is confirmed." },

  // --- Part 2 continued / most-recent-entry info (page 3) ---
  { fieldName: "form1[0].Page3[0].Line21_DateOfLastEntry[0]", source: "raw.questionnaireAnswers.client_dateOfLastArrival.value", transform: { type: "date", format: "mm/dd/yyyy" }, sourceVerified: false, note: "Date of last arrival/entry. Question key GUESSED — same key i539-h4-crosswalk.js guesses for its equivalent field." },
  { fieldName: "form1[0].Page3[0].Line20a_I94Number[0]", source: "immigration.i94.number", sourceVerified: true, note: "Item 20.a, I-94 Arrival-Departure Record Number. High confidence: the a-e lettered sequence (a=I-94, b=Passport, c=TravelDoc, d=CountryOfIssuance, e=ExpDate) is internally consistent field-to-field." },
  { fieldName: "form1[0].Page3[0].Line20b_Passport[0]", source: "person.passport.number", sourceVerified: true, note: "Item 20.b, passport number." },
  { fieldName: "form1[0].Page3[0].Line20d_CountryOfIssuance[0]", source: "person.passport.country", sourceVerified: true, note: "Item 20.d, passport country of issuance." },
  { fieldName: "form1[0].Page3[0].Line20e_ExpDate[0]", source: "person.passport.expirationDate", transform: { type: "date", format: "mm/dd/yyyy" }, sourceVerified: true, note: "Item 20.e, passport expiration date." },
  { fieldName: "form1[0].Page3[0].Line24_CurrentStatus[0]", source: "immigration.currentStatus", sourceVerified: true, note: "Item 24, current nonimmigrant status. Unambiguous field name, high confidence." },
  { fieldName: "form1[0].Page3[0].Line19_DOB[0]", source: "person.dob", transform: { type: "date", format: "mm/dd/yyyy" }, sourceVerified: true, note: "Item 19, date of birth. NOTE: page 2 also has a widget named Line19_Checkbox[0]/[1] — an apparent item-number collision between pages that could not be resolved from field names alone; left unmapped/ambiguous there rather than assumed to be the same Item 19 (see MANUAL_ENTRY_FIELDS)." },
  { fieldName: "form1[0].Page3[0].Line18c_CountryOfBirth[0]", source: "person.countryOfBirth", sourceVerified: true, note: "Item 18.c, country of birth (repeat of the page-2 country-of-birth question in this form's own two-Part structure)." },

  // --- Part 3: Applicant's contact info / statement (page 4) ---
  { fieldName: "form1[0].Page4[0].Pt3Line3_DaytimePhoneNumber1[0]", source: "contact.phone", sourceVerified: true, note: "Applicant daytime phone number." },
  { fieldName: "form1[0].Page4[0].Pt3Line5_Email[0]", source: "contact.email", sourceVerified: true, note: "Applicant email address." },

  // --- Part 6, continuation sheet header (page 7) — repeated identity fields ---
  { fieldName: "form1[0].Page7[0].Line1a_FamilyName[0]", source: "person.lastName", sourceVerified: true, note: "Continuation sheet header, applicant family name (repeat)." },
  { fieldName: "form1[0].Page7[0].Line1b_GivenName[0]", source: "person.firstName", sourceVerified: true, note: "Continuation sheet header, applicant given name (repeat)." },
  { fieldName: "form1[0].Page7[0].Line1c_MiddleName[0]", source: "person.middleName", sourceVerified: true, note: "Continuation sheet header, applicant middle name (repeat)." },
  { fieldName: "form1[0].Page7[0].Line7_AlienNumber[0]", source: "person.alienNumber", sourceVerified: true, note: "Continuation sheet header, A-Number (repeat) — see the Part 2 A-Number edge's format-mismatch caveat." },
];

// ---------------------------------------------------------------------------
const MANUAL_ENTRY_FIELDS = {
  "no_canonical_source": [
    "form1[0].Page1[0].Line2a_FamilyName[0]", "form1[0].Page1[0].Line2b_GivenName[0]", "form1[0].Page1[0].Line2c_MiddleName[0]", // other names used
    "form1[0].Page1[0].Line3a_FamilyName[0]", "form1[0].Page1[0].Line3b_GivenName[0]", "form1[0].Page1[0].Line3c_MiddleName[0]",
    "form1[0].Page1[0].Line3a_FamilyName[1]", "form1[0].Page1[0].Line3b_GivenName[1]", "form1[0].Page1[0].Line3c_MiddleName[1]", // additional "other names used" rows
    "form1[0].Page1[0].Attorney-Rep[0].CheckBox1[0]", "form1[0].Page1[0].Attorney-Rep[0].attorneyBarNumber[0]", "form1[0].Page1[0].Attorney-Rep[0].USCISELISAcctNumber[0]", // attorney/rep block, not applicant data
    "form1[0].Page2[0].Pt2Line7_Unit[0]", "form1[0].Page2[0].Pt2Line7_Unit[1]", "form1[0].Page2[0].Pt2Line7_Unit[2]", "form1[0].Page2[0].Pt2Line7_AptSteFlrNumber[0]", // physical address unit type/number
    "form1[0].Page2[0].Pt2Line5_Unit[0]", "form1[0].Page2[0].Pt2Line5_Unit[1]", "form1[0].Page2[0].Pt2Line5_Unit[2]", "form1[0].Page2[0].Pt2Line5_AptSteFlrNumber[0]", // mailing address unit type/number
    "form1[0].Page2[0].Line4a_InCareofName[0]", // mailing address "in care of" name
    "form1[0].Page2[0].Line10_Checkbox[0]", "form1[0].Page2[0].Line10_Checkbox[1]", "form1[0].Page2[0].Line10_Checkbox[2]", "form1[0].Page2[0].Line10_Checkbox[3]", // marital status — real, unambiguous (Widowed/Divorced/Single/Married), but OUTSIDE this crosswalk's explicit H-4 EAD checklist scope per the task's own instructions; not mapped
    "form1[0].Page3[0].Line20c_TravelDoc[0]", // travel document number distinct from passport — no separate canonical field
    "form1[0].Page3[0].Line23_StatusLastEntry[0]", // status AT last entry, distinct concept from Line24_CurrentStatus (already mapped) — no canonical field for the historical value
    "form1[0].Page3[0].Line26_SEVISnumber[0]", // SEVIS number — not applicable to an H-4 dependent's own EAD application
    "form1[0].Page3[0].Line27a_Degree[0]", "form1[0].Page3[0].Line27b_Everify[0]", "form1[0].Page3[0].Line27c_EverifyIDNumber[0]", // F-1 STEM OPT-specific fields, not applicable to an H-4 EAD ((c)(26)) filing
    "form1[0].Page3[0].Line18a_CityTownOfBirth[0]", // city/town of birth — no canonical field distinct from country of birth
    "form1[0].Page3[0].#area[1].section_1[0]", "form1[0].Page3[0].#area[1].section_2[0]", "form1[0].Page3[0].#area[1].section_3[0]", // purpose not derivable from field name alone
    "form1[0].Page3[0].Line18a_Receipt[0].Line30a_ReceiptNumber[0]", "form1[0].Page3[0].Line28_ReceiptNumber[0]", // related receipt numbers — legal/case-specific, not from the H-4 checklist's own data
    "form1[0].Page3[0].place_entry[0]", // place of last entry — not in this crosswalk's explicit scope (date/I-94/passport/status only)
    "form1[0].Page4[0].Pt3Line4_MobileNumber1[0]", // mobile phone — only one contact.phone canonical field exists, same reasoning as i539-h4-crosswalk.js
    "form1[0].Page4[0].Pt3Line1b_Language[0]", "form1[0].Page4[0].Pt3Line2_RepresentativeName[0]", // interpreter/representative info
    "form1[0].Page4[0].Pt4Line2_InterpreterBusinessorOrg[0]", "form1[0].Page4[0].Pt4Line1b_InterpreterGivenName[0]", "form1[0].Page4[0].Pt4Line1a_InterpreterFamilyName[0]",
    "form1[0].Page5[0].Pt4Line4_InterpreterDaytimeTelephone[0]", "form1[0].Page5[0].Pt4Line6_Email[0]", "form1[0].Page5[0].Pt4Line5_MobileNumber[0]", "form1[0].Page5[0].Part4_NameofLanguage[0]", // interpreter contact info
    "form1[0].Page5[0].Pt5Line1b_PreparerGivenName[0]", "form1[0].Page5[0].Pt5Line2_BusinessName[0]", "form1[0].Page5[0].Pt5Line1a_PreparerFamilyName[0]", "form1[0].Page5[0].Pt5Line5_PreparerFaxNumber[0]", "form1[0].Page5[0].Pt5Line4_DaytimePhoneNumber1[0]", "form1[0].Page5[0].Pt5Line6_Email[0]", // preparer info/contact
    "form1[0].Page5[0].Pt6Line3c_CityOrTown[0]", "form1[0].Page5[0].Pt6Line3a_StreetNumberName[0]", "form1[0].Page5[0].Pt6Line3b_Unit[0]", "form1[0].Page5[0].Pt6Line3b_Unit[1]", "form1[0].Page5[0].Pt6Line3b_AptSteFlrNumber[0]", "form1[0].Page5[0].Pt6Line3b_Unit[2]", "form1[0].Page5[0].Pt6Line3g_PostalCode[0]", "form1[0].Page5[0].Pt6Line3e_ZipCode[0]", "form1[0].Page5[0].Pt6Line3d_State[0]", "form1[0].Page5[0].Pt6Line3h_Country[0]", "form1[0].Page5[0].Pt6Line3f_Province[0]", // preparer's business address (Part 6)
    "form1[0].Page5[0].Pt5Line3c_CityOrTown[0]", "form1[0].Page5[0].Pt5Line3a_StreetNumberName[0]", "form1[0].Page5[0].Pt5Line3b_Unit[0]", "form1[0].Page5[0].Pt5Line3b_Unit[1]", "form1[0].Page5[0].Pt5Line3b_AptSteFlrNumber[0]", "form1[0].Page5[0].Pt5Line3b_Unit[2]", "form1[0].Page5[0].Pt5Line3g_PostalCode[0]", "form1[0].Page5[0].Pt5Line3e_ZipCode[0]", "form1[0].Page5[0].Pt5Line3d_State[0]", "form1[0].Page5[0].Pt5Line3h_Country[0]", "form1[0].Page5[0].Pt5Line3f_Province[0]", // preparer's business address, second block
    "form1[0].Page7[0].Pt6Line3a_PageNumber[0]", "form1[0].Page7[0].Pt6Line3b_PartNumber[0]", "form1[0].Page7[0].Pt6Line3c_ItemNumber[0]",
    "form1[0].Page7[0].Pt6Line4a_PageNumber[0]", "form1[0].Page7[0].Pt6Line4b_PartNumber[0]", "form1[0].Page7[0].Pt6Line4c_ItemNumber[0]", "form1[0].Page7[0].Pt6Line4d_AdditionalInfo[0]", "form1[0].Page7[0].Pt6Line4d_AdditionalInfo[1]",
    "form1[0].Page7[0].Pt6Line5a_PageNumber[0]", "form1[0].Page7[0].Pt6Line5b_PartNumber[0]", "form1[0].Page7[0].Pt6Line5c_ItemNumber[0]", "form1[0].Page7[0].Pt6Line5d_AdditionalInfo[0]",
    "form1[0].Page7[0].Pt6Line6a_PageNumber[0]", "form1[0].Page7[0].Pt6Line6b_PartNumber[0]", "form1[0].Page7[0].Pt6Line6c_ItemNumber[0]", "form1[0].Page7[0].Pt6Line6d_AdditionalInfo[0]",
    "form1[0].Page7[0].Pt6Line7a_PageNumber[0]", "form1[0].Page7[0].Pt6Line7b_PartNumber[0]", "form1[0].Page7[0].Pt6Line7c_ItemNumber[0]", "form1[0].Page7[0].Pt6Line7d_AdditionalInfo[0]", // Part 6, free-text continuation sheet
  ],
  "ambiguous_requires_visual_verification": [
    "form1[0].Page2[0].Part2Line5_Checkbox[0]", "form1[0].Page2[0].Part2Line5_Checkbox[1]",
    "form1[0].Page2[0].Line17a_CountryOfBirth[0]", // shares its field name with the mapped Line17b_CountryOfBirth[0] — see that edge's note; likely actually City/Town of Birth (Item 17.a) despite the field's own name
    "form1[0].Page2[0].Line9_Checkbox[0]", "form1[0].Page2[0].Line9_Checkbox[1]",
    "form1[0].Page2[0].Line19_Checkbox[0]", "form1[0].Page2[0].Line19_Checkbox[1]", // possible item-number collision with page 3's Line19_DOB — see that edge's note
    "form1[0].Page3[0].Line18b_CityTownOfBirth[0]", // duplicate field name of Line18a_CityTownOfBirth — likely State/Province of birth, not independently confirmed
    "form1[0].Page3[0].PtLine29_YesNo[0]", "form1[0].Page3[0].PtLine29_YesNo[1]",
    "form1[0].Page3[0].PtLine30b_YesNo[0]", "form1[0].Page3[0].PtLine30b_YesNo[1]",
    "form1[0].Page4[0].Pt3Line1Checkbox[0]", "form1[0].Page4[0].Pt3Line1Checkbox[1]", "form1[0].Page4[0].Part3_Checkbox[0]", // language-ability / interpreter-need statement checkboxes
    "form1[0].Page4[0].Pt4Line6_Checkbox[0]", // interpreter-related checkbox
    "form1[0].Page6[0].Part5Line7_Checkbox[0]", "form1[0].Page6[0].Part5Line7_Checkbox[1]", // only 2 options (A/B) — does not look like the (c)(26)-style eligibility category list; purpose unconfirmed
    "form1[0].Page6[0].Part5Line7b_Checkbox[0]", "form1[0].Page6[0].Part5Line7b_Checkbox[1]",
  ],
  "signature_or_legal_determination": [
    "form1[0].Page4[0].Pt3Line7b_DateofSignature[0]", "form1[0].Page4[0].Pt3Line7a_Signature[0]",
    "form1[0].Page5[0].Pt4Line6b_DateofSignature[0]", "form1[0].Page5[0].Pt4Line6a_Signature[0]",
    "form1[0].Page6[0].Pt5Line8a_Signature[0]", "form1[0].Page6[0].Pt5Line8b_DateofSignature[0]",
  ],
};

function flattenManualEntry() {
  const set = new Set();
  Object.values(MANUAL_ENTRY_FIELDS).forEach((list) => list.forEach((name) => set.add(name)));
  return set;
}

const MANUAL_ENTRY_SET = flattenManualEntry();
const MAPPED_BY_FIELD_NAME = new Map(MAPPED_EDGES.map((edge) => [edge.fieldName, edge]));

function isInScopePage(pageNumber) {
  return !OUT_OF_SCOPE_PAGES.has(pageNumber);
}

function classifyField(field) {
  const fieldName = field.fieldName || field.pdfFieldName || field.fieldId;
  if (USCIS_USE_ONLY_PATTERNS.some((pattern) => pattern.test(fieldName))) {
    return { status: "uscis_use_only", note: "USCIS-internal barcode/processing field." };
  }
  const mappedEdge = MAPPED_BY_FIELD_NAME.get(fieldName);
  if (mappedEdge) return { status: "mapped", edge: mappedEdge };
  if (MANUAL_ENTRY_SET.has(fieldName)) return { status: "manual_entry", note: "See crosswalk MANUAL_ENTRY_FIELDS for the specific reason." };
  if (!isInScopePage(field.pageNumber)) {
    return { status: "out_of_scope", note: "Not applicable to the H-4 EAD checklist." };
  }
  return { status: "manual_entry", note: "In-scope I-765 field without an individually authored source, OR a field this crosswalk's authored fieldName list does not recognize (e.g. edition drift against the real imported template — see file header). Defaulted to manual_entry rather than left ambiguous or silently unfilled." };
}

module.exports = {
  OUT_OF_SCOPE_PAGES,
  USCIS_USE_ONLY_PATTERNS,
  MAPPED_EDGES,
  MANUAL_ENTRY_FIELDS,
  classifyField,
};
