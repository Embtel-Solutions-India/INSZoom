// H-4 crosswalk — canonical/questionnaire -> I-539 (Application to Extend/
// Change Nonimmigrant Status) field mapping, scoped to the H-4 Extension
// checklist content only (see the integration prompt: applicant name,
// A-Number, USCIS Online Account Number, mailing/physical address, country
// of birth/citizenship, DOB, SSN, daytime phone, email, and most-recent-
// entry info — date of last arrival, I-94 number, passport number/country/
// expiration, current nonimmigrant status and expiration). The authoring
// seed (../seeds/i539-h4-mapping.seed.js) converts this file into a
// USCISMappingVersion graph for the active I-539 template, mirroring
// i129-h1b-crosswalk.js's own seed pattern exactly (see that file for the
// full rationale behind checkboxMatch(), the OUT_OF_SCOPE_PAGES/
// MANUAL_ENTRY_FIELDS split, and classifyField()'s bucket contract — none
// of that is repeated here).
//
// ============================================================================
// SOURCE-CONFIDENCE HEADER — read before trusting any edge below.
// ============================================================================
// TARGET FIELDS (fieldName / pages / checkbox onValues): VERIFIED. Extracted
// directly with pdf-lib (via this repo's own src/utils/normalizePdf.js qpdf
// pipeline — the same normalization USCISFormImporterService uses) against
// the REAL template PDF already checked into this repo at
// dev-assets/uscis/i-539_2024-08-28.pdf — the exact file
// uscis-form-import/seeds/i539.seed.js imports and activates as the I-539
// USCISFormTemplate (formCode "I-539", version "2024-08-28"). 159 fields, 7
// pages, confirmed live at authoring time. No field name below was guessed.
//
// SOURCE PATHS: mixed confidence, NOT uniformly verified:
//   - `person.*` / `contact.*` / `immigration.*` paths (dob, countryOfBirth,
//     citizenship, alienNumber, address.*, phone, email, passport.*,
//     i94.*, currentStatus) are VERIFIED against
//     ../../canonical/config/profileCanonicalMap.js's real, live
//     EMPLOYEE_PROFILE_TO_CANONICAL table — these resolve today, the same
//     way the H-1B crosswalk's person.*/contact.*/immigration.* edges do,
//     independent of any new questionnaire landing.
//   - `raw.questionnaireAnswers.client_*.value` paths (SSN, USCIS Online
//     Account Number, date of last arrival) are NOT VERIFIED. They assume a
//     future H-4 questionnaire (src/modules/questionnaires/h4Checklist.js)
//     that does not exist in this codebase as of this crosswalk's authoring
//     — it had not landed yet (see the integration prompt). The question
//     KEYS used here (`client_ssn`, `client_uscisOnlineAccountNumber`,
//     `client_dateOfLastArrival`) are guesses following sb1Checklist.js's
//     own "client_" + camelCase convention (the closest real precedent in
//     this codebase for a single-party checklist), NOT confirmed against
//     any real Question document. Every one of these edges is listed again,
//     explicitly, in the report this file's authoring task requires — treat
//     them as placeholders a human must reconcile against h4Checklist.js's
//     actual question keys once it lands, not as working mappings.
//   - `company.name` (edges mapping "name of petitioner") ASSUMES the H-4
//     case's Company record is the same petitioner as the H-1B principal's
//     I-129 — true for a derivative H-4 case on this platform's data model,
//     but not independently verified against a real H-4 case in this task.
//
// Distinguishing the two tiers inline: every MAPPED_EDGES entry carries
// `sourceVerified: true|false` (mirroring visaFormMappings.seed.js's own
// `sourceVerified` field — the house convention this task was told to
// follow for "never silently promote to verified"). `false` does not mean
// the edge is wrong; it means it has not been run against a real case.
function checkboxMatch(source, value) {
  return { condition: { field: source, operator: Array.isArray(value) ? "in" : "equals", value }, transform: { type: "boolean" } };
}

// Pages 4 and parts of page 3 are dense blocks of unlabeled Yes/No history
// checkboxes (immigration-history questions) with no distinguishing text
// available from the field name alone — never a candidate for a confident
// mapping, but still in-scope (not a different classification/supplement),
// so left to the manual_entry default rather than listed as out_of_scope.
const OUT_OF_SCOPE_PAGES = new Set([]);

const USCIS_USE_ONLY_PATTERNS = [/PDF417BarCode/];

// ---------------------------------------------------------------------------
const MAPPED_EDGES = [
  // --- Part 1: Information About You (applicant name, A-Number, addresses) ---
  { fieldName: "form1[0].#subform[0].P1Line1a_FamilyName[0]", source: "person.lastName", sourceVerified: true, note: "Part 1 Item 1.a, applicant family name." },
  { fieldName: "form1[0].#subform[0].P1_Line1b_GivenName[0]", source: "person.firstName", sourceVerified: true, note: "Part 1 Item 1.b, applicant given name." },
  { fieldName: "form1[0].#subform[0].P1_Line1c_MiddleName[0]", source: "person.middleName", sourceVerified: true, note: "Part 1 Item 1.c, applicant middle name." },
  { fieldName: "form1[0].#subform[0].Pt1Line2_AlienNumber[0]", source: "person.alienNumber", sourceVerified: true, note: "Part 1 Item 2, A-Number. UNLIKE the H-1B crosswalk's equivalent field, this widget's max-length/pre-printed-prefix was NOT confirmed via a live ValidationService run (no case/Mongo access during authoring) — if this widget has the same 9-char/no-'A'-prefix constraint as I-129's Line1_AlienNumber, person.alienNumber's leading 'A' will overflow it. Flagged for the same format check the H-1B crosswalk already did, not yet performed here." },
  { fieldName: "form1[0].#subform[0].Pt1Line2_USCISOnlineAcctNumber[0]", source: "raw.questionnaireAnswers.client_uscisOnlineAccountNumber.value", sourceVerified: false, note: "Part 1 Item 2, USCIS Online Account Number. Question key GUESSED — see file header." },
  { fieldName: "form1[0].#subform[0].Part2_Item11_StreetName[0]", source: "contact.address.line1", sourceVerified: true, note: "Mailing address street. Field name carries a 'Part2_Item11' prefix despite being on page 1 next to the Part 1 Item 4 mailing-address block — a template-authoring artifact (same class of issue the H-1B crosswalk's 'HSup' prefix note documents), not a mapping error." },
  { fieldName: "form1[0].#subform[0].Part2_Item11_City[0]", source: "contact.address.city", sourceVerified: true, note: "Mailing address city." },
  { fieldName: "form1[0].#subform[0].Part2_Item11_State[0]", source: "contact.address.state", sourceVerified: true, note: "Mailing address state (dropdown)." },
  { fieldName: "form1[0].#subform[0].Part2_Item11_ZipCode[0]", source: "contact.address.zip", sourceVerified: true, note: "Mailing address ZIP." },
  { fieldName: "form1[0].#subform[0].Part1_Item6_StreetName[0]", source: "contact.address.line1", sourceVerified: true, note: "Physical address (if different from mailing), street. Canonical data holds only ONE address (contact.address.*) — mapped here too under the same repeat-value convention the H-1B/L-1A crosswalk uses for a value appearing in more than one place on the form. If the client's physical address genuinely differs from their mailing address, this will incorrectly duplicate the mailing address — case manager must verify manually." },
  { fieldName: "form1[0].#subform[0].Part1_Item6_City[0]", source: "contact.address.city", sourceVerified: true, note: "Physical address city — see the street field's note on the single-address limitation." },
  { fieldName: "form1[0].#subform[0].Part1_Item6_State[0]", source: "contact.address.state", sourceVerified: true, note: "Physical address state — see the street field's note." },
  { fieldName: "form1[0].#subform[0].Part1_Item6_ZipCode[0]", source: "contact.address.zip", sourceVerified: true, note: "Physical address ZIP — see the street field's note." },

  // --- Part 1 continued (page 2): DOB, citizenship, SSN, most-recent-entry ---
  { fieldName: "form1[0].#subform[1].P1_Line8_DateOfBirth[0]", source: "person.dob", transform: { type: "date", format: "mm/dd/yyyy" }, sourceVerified: true, note: "Date of birth." },
  { fieldName: "form1[0].#subform[1].P1_Line7_CountryOfCitizenship[0]", source: "person.citizenship", sourceVerified: true, note: "Country of citizenship/nationality." },
  { fieldName: "form1[0].#subform[1].P1_Line6_CountryOfBirth[0]", source: "person.countryOfBirth", sourceVerified: true, note: "Country of birth." },
  { fieldName: "form1[0].#subform[1].P1_Line9_SSN[0]", source: "raw.questionnaireAnswers.client_ssn.value", sourceVerified: false, note: "Social Security Number. Question key GUESSED — see file header (no ssn entry exists in profileCanonicalMap.js's EMPLOYEE_PROFILE_TO_CANONICAL either)." },
  { fieldName: "form1[0].#subform[1].SupA_Line1i_DateOfArrival[0]", source: "raw.questionnaireAnswers.client_dateOfLastArrival.value", transform: { type: "date", format: "mm/dd/yyyy" }, sourceVerified: false, note: "Date of last arrival. Field name's 'SupA_' prefix suggests Supplement A authoring, but pdf-lib confirms this widget is on page 2 of the BASE form — a naming artifact, not evidence this belongs to a different classification. Question key GUESSED — no canonical immigration.dateOfLastArrival path exists in profileCanonicalMap.js." },
  { fieldName: "form1[0].#subform[1].SupA_Line1j_ArrivalDeparture[0]", source: "immigration.i94.number", sourceVerified: true, note: "I-94 Arrival-Departure Record Number." },
  { fieldName: "form1[0].#subform[1].SupA_Line1k_Passport[0]", source: "person.passport.number", sourceVerified: true, note: "Passport number." },
  { fieldName: "form1[0].#subform[1].SupA_Line1k_Passport[1]", source: "person.passport.number", sourceVerified: true, note: "Passport number, repeated widget instance (same field name, second occurrence)." },
  { fieldName: "form1[0].#subform[1].SupA_Line1k_Passport[2]", source: "person.passport.number", sourceVerified: true, note: "Passport number, repeated widget instance (third occurrence)." },
  { fieldName: "form1[0].#subform[1].SupA_Line1m_CountryOfIssuance[0]", source: "person.passport.country", sourceVerified: true, note: "Passport country of issuance." },
  { fieldName: "form1[0].#subform[1].SupA_Line1n_ExpDate[0]", source: "person.passport.expirationDate", transform: { type: "date", format: "mm/dd/yyyy" }, sourceVerified: true, note: "Passport expiration date." },
  { fieldName: "form1[0].#subform[1].SupA_Line1p_DateExpires[0]", source: "immigration.i94.expirationDate", transform: { type: "date", format: "mm/dd/yyyy" }, sourceVerified: true, note: "ASSUMED to be current-status/I-94 expiration, inferred from its position continuing the Line1(i..p) lettered sequence started by the arrival/I-94/passport fields above (i=arrival, j=I-94#, k=passport#, l=travel doc, m=country of issuance, n=passport exp, p=this field) — NOT independently confirmed against the printed form's own item text. Flagged ambiguous_requires_visual_verification-adjacent; kept mapped rather than manual because the positional inference is reasonably strong, but a human should confirm before relying on it for a real filing." },

  // --- Contact info (page 5, Part 5/6 area) ---
  { fieldName: "form1[0].#subform[4].P5_Line3_DaytimePhoneNumber[0]", source: "contact.phone", sourceVerified: true, note: "Applicant daytime phone number." },
  { fieldName: "form1[0].#subform[4].P5_Line5_EmailAddress[0]", source: "contact.email", sourceVerified: true, note: "Applicant email address." },

  // --- Petitioner name (Part 3, page 3) — H-4 is a derivative filing ---
  { fieldName: "form1[0].#subform[2].P3_Line4_NameofPetitioner[0]", source: "company.name", sourceVerified: false, note: "Name of petitioner on the related Form I-129. ASSUMES the H-4 case's Company record is the same employer that petitioned the H-1B principal — true for how this platform models a derivative H-4 case, but not independently verified against a real seeded H-4 case (no such case existed at authoring time)." },
  { fieldName: "form1[0].#subform[2].P3_Line4_NameofPetitioner[1]", source: "company.name", sourceVerified: false, note: "Same petitioner name, repeated widget instance — see the [0] instance's note." },

  // --- Part 8, continuation sheet header (page 7) — repeated identity fields ---
  { fieldName: "form1[0].#subform[6].P1Line1a_FamilyName[1]", source: "person.lastName", sourceVerified: true, note: "Continuation sheet header, applicant family name (repeat)." },
  { fieldName: "form1[0].#subform[6].P1_Line1b_GivenName[1]", source: "person.firstName", sourceVerified: true, note: "Continuation sheet header, applicant given name (repeat)." },
  { fieldName: "form1[0].#subform[6].P1_Line1c_MiddleName[1]", source: "person.middleName", sourceVerified: true, note: "Continuation sheet header, applicant middle name (repeat)." },
  { fieldName: "form1[0].#subform[6].P8_Line2_ANumber[0].Pt1Line2_AlienNumber[1]", source: "person.alienNumber", sourceVerified: true, note: "Continuation sheet header, A-Number (repeat) — see the Part 1 Item 2 edge's format-mismatch caveat." },
];

// ---------------------------------------------------------------------------
const MANUAL_ENTRY_FIELDS = {
  "no_canonical_source": [
    "form1[0].#subform[0].CheckBox1[0]", // G-28/attorney-related checkbox, ambiguous purpose from field name alone
    "form1[0].#subform[0].AttorneyStateBarNumber[0]", // attorney info, not applicant data
    "form1[0].#subform[0].USCISOnlineAcctNumber[0]", // distinct from Pt1Line2_USCISOnlineAcctNumber (no page-1-block prefix) — likely the attorney/G-28 filer's own account number, not the applicant's; left unmapped rather than guessing
    "form1[0].#subform[0].Part1_Item4_Unit[0]", "form1[0].#subform[0].Part1_Item4_Unit[1]", "form1[0].#subform[0].Part1_Item4_Unit[2]", "form1[0].#subform[0].Part1_Item4_Number[0]", // mailing address APT/STE/FLR unit type+number — no structured unit-type field planned in h4Checklist.js's convention
    "form1[0].#subform[0].Part1_Item6_Unit[0]", "form1[0].#subform[0].Part1_Item6_Unit[1]", "form1[0].#subform[0].Part1_Item6_Unit[2]", "form1[0].#subform[0].Part1_Item6_Number[0]", // physical address unit type+number — same reason
    "form1[0].#subform[0].Part2_Item11_InCareOfName[0]", // mailing address "in care of" name — not in the H-4 checklist scope
    "form1[0].#subform[1].SupA_Line1l_TravelDoc[0]", // travel document number distinct from passport — no separate canonical field
    "form1[0].#subform[1].Pt2Line2a_NewStatus[0]", "form1[0].#subform[1].Pt2Line2b_EffectiveDate[0]", // requested new status / effective date — legal determination, not sourced from the H-4 EAD/extension checklist's own data
    "form1[0].#subform[1].P2_Line5b_TotalNumber[0]", // total number of co-applicants included — platform models one applicant per case; trivial for a case manager to enter
    "form1[0].#subform[2].P3_Line5_ReceiptNumber[0]", "form1[0].#subform[2].P3_Line5_DateFiled[0]", // related I-129 receipt number/date filed
    "form1[0].#subform[2].P4_Line1a_CountryOfIssuance[0]", "form1[0].#subform[2].P4_Line1a_CountryOfIssuance[1]", "form1[0].#subform[2].P4_Line1b_ExpirationDate[0]", // appear to belong to a co-applicant/family-member block within the same filing, not the primary H-4 applicant
    "form1[0].#subform[1].P3_Line1a_DateExtended[0]", // requested extension date — legal determination
    "form1[0].#subform[4].P5_Line4_MobilePhoneNumber[0]", // mobile phone — only one contact.phone canonical field exists; left unmapped rather than double-mapping the same value under two different physical concepts
    "form1[0].#subform[4].P6_Line5_EmailAddress[0]", "form1[0].#subform[4].P6_Line4_DaytimePhoneNumber[0]", "form1[0].#subform[4].P6_Line4_DaytimePhoneNumber[1]", "form1[0].#subform[4].P7_Line6_Language[0]", // Part 6/7 area — interpreter/preparer contact info, not the applicant's
    "form1[0].#subform[4].P7_Line1_PreparerFamilyName[0]", "form1[0].#subform[4].P7_Line1_PreparerGivenName[0]", "form1[0].#subform[4].P7_Line2_PreparerNameofBusinessorOrgName[0]",
    "form1[0].#subform[5].P7_Line1a_PreparerFamilyName[0]", "form1[0].#subform[5].P7_Line1b_PreparerGivenName[0]", "form1[0].#subform[5].P7_Line2_BusinessName[0]", "form1[0].#subform[5].P7_Line6_EmailAddress[0]", "form1[0].#subform[5].P7_Line4_PreparerDaytimePhoneNumber[0]", "form1[0].#subform[5].P7_Line5_FaxPhoneNumber[0]", // preparer info, page 6
    "form1[0].#subform[6].P8_Line4_A_PageNumber[0]", "form1[0].#subform[6].P8_Line4_B_PartNumber[0]", "form1[0].#subform[6].P8_Line4_C_ItemNumber[0]", "form1[0].#subform[6].P8_Line4_D_AdditionalInfo[0]",
    "form1[0].#subform[6].P8_Line5_A_PageNumber[0]", "form1[0].#subform[6].P8_Line5_B_PartNumber[0]", "form1[0].#subform[6].P8_Line5_C_ItemNumber[0]", "form1[0].#subform[6].P8_Line5_D_AdditionalInfo[0]",
    "form1[0].#subform[6].P8_Line3_A_PageNumber[0]", "form1[0].#subform[6].P8_Line3_B_PartNumber[0]", "form1[0].#subform[6].P8_Line3_C_ItemNumber[0]", "form1[0].#subform[6].P8_Line3_D_AdditionalInfo[0]",
    "form1[0].#subform[6].P8_Line6_A_PageNumber[0]", "form1[0].#subform[6].P8_Line6_B_PartNumber[0]", "form1[0].#subform[6].P8_Line6_C_ItemNumber[0]", "form1[0].#subform[6].P8_Line6_D_AdditionalInfo[0]", // Part 8, free-text continuation sheet
  ],
  // No item label available (checkbox/dropdown widgets whose semantic meaning
  // cannot be determined from the field name alone) — mapping any of these
  // to a specific canonical fact risks silently attributing the wrong
  // answer to the wrong USCIS question; left for a human to confirm
  // visually against the printed form, same standard as the H-1B crosswalk's
  // own ambiguous_requires_visual_verification bucket.
  "ambiguous_requires_visual_verification": [
    "form1[0].#subform[0].P1_checkbox5[0]", "form1[0].#subform[0].P1_checkbox5[1]", // "is current address same as mailing" Y/N — plausible, but no confirmed item text
    "form1[0].#subform[1].Pt1Line15a_NewStatus[0]", // "NewStatus" dropdown — requested classification, not current; could also be misnamed
    "form1[0].#subform[1].P1_Checkbox12c[0]",
    "form1[0].#subform[1].P2_checkbox4[0]", "form1[0].#subform[1].P2_checkbox4[1]",
    "form1[0].#subform[1].P2_checkbox[0]", "form1[0].#subform[1].P2_checkbox[1]", "form1[0].#subform[1].P2_checkbox[2]",
    "form1[0].#subform[1].P3_checkbox2a[0]", "form1[0].#subform[1].P3_checkbox2a[1]",
    "form1[0].#subform[2].P3_checkbox1[0]", "form1[0].#subform[2].P3_checkbox1[1]", "form1[0].#subform[2].P3_checkbox1[2]",
    "form1[0].#subform[2].P3_checkbox4[0]", "form1[0].#subform[2].P3_checkbox4[1]",
    "form1[0].#subform[2].P4_checkbox3_No[0]", "form1[0].#subform[2].P4_checkbox3_Yes[0]", "form1[0].#subform[2].P4_checkbox5_No[0]", "form1[0].#subform[2].P4_checkbox5_Yes[0]", "form1[0].#subform[2].P4_checkbox4_Yes[0]", "form1[0].#subform[2].P4_checkbox4_No[0]",
    // A second, distinctly non-US-formatted (Province/PostalCode) address
    // block on page 3 whose purpose relative to the already-mapped mailing
    // (Part2_Item11_*) and physical (Part1_Item6_*) blocks on page 1 is not
    // determinable from the field name alone — could be a co-applicant's
    // address, an "address abroad" question, or something else entirely.
    // Deliberately NOT mapped to contact.address.* alongside the other two
    // blocks to avoid a third, unverified duplication.
    "form1[0].#subform[2].P2_Line10_StreetName[0]", "form1[0].#subform[2].P2_Line10_Unit[0]", "form1[0].#subform[2].P2_Line10_Unit[1]", "form1[0].#subform[2].P2_Line10_Unit[2]", "form1[0].#subform[2].P2_Line10_Number[0]",
    "form1[0].#subform[2].P2_Line10_City[0]", "form1[0].#subform[2].P2_Line10_Province[0]", "form1[0].#subform[2].P2_Line10_PostalCode[0]", "form1[0].#subform[2].P2_Line10_Country[0]",
    // Page 4 — dense block of unlabeled Yes/No immigration-history questions
    // (~15 pairs). Every _No/_Yes widget pair literally shares the onValue
    // "Y" (a normal PDF authoring quirk, not evidence of anything), and
    // without printed item text there is no reliable way to tell which
    // history question (removal proceedings, prior denial, criminal
    // record, etc.) each pair represents.
    "form1[0].#subform[3].P4_checkbox10_No[0]", "form1[0].#subform[3].P4_checkbox10_Yes[0]", "form1[0].#subform[3].P4_checkbox9_No[0]", "form1[0].#subform[3].P4_checkbox9_Yes[0]",
    "form1[0].#subform[3].P4_checkbox8_No[0]", "form1[0].#subform[3].P4_checkbox8_Yes[0]", "form1[0].#subform[3].P4_checkbox7_No[0]", "form1[0].#subform[3].P4_checkbox7_Yes[0]",
    "form1[0].#subform[3].P4_checkbox11_Yes[0]", "form1[0].#subform[3].P4_checkbox11_No[0]", "form1[0].#subform[3].P4_checkbox14_Yes[0]", "form1[0].#subform[3].P4_checkbox14_No[0]",
    "form1[0].#subform[3].P4_checkbox12_Yes[0]", "form1[0].#subform[3].P4_checkbox12_No[0]", "form1[0].#subform[3].P4_checkbox13_No[0]", "form1[0].#subform[3].P4_checkbox13_Yes[0]",
    "form1[0].#subform[3].P4_checkbox19_No[0]", "form1[0].#subform[3].P4_checkbox19_Yes[0]", "form1[0].#subform[3].P4_checkbox20_Yes[0]", "form1[0].#subform[3].P4_checkbox20_No[0]",
    "form1[0].#subform[3].P4_checkbox15_Yes[0]", "form1[0].#subform[3].P4_checkbox15_No[0]", "form1[0].#subform[3].P4_checkbox16_Yes[0]", "form1[0].#subform[3].P4_checkbox16_No[0]",
    "form1[0].#subform[3].P4_checkbox17_Yes[0]", "form1[0].#subform[3].P4_checkbox17_No[0]", "form1[0].#subform[3].P4_checkbox18_Yes[0]", "form1[0].#subform[3].P4_checkbox18_No[0]",
    "form1[0].#subform[3].P4_checkbox6_Yes[0]", "form1[0].#subform[3].P4_checkbox6_No[0]",
  ],
  "signature_or_legal_determination": [
    "form1[0].#subform[4].P6_Line7_SignatureApplicant[0]", "form1[0].#subform[4].P6_Line7_DateofSignature[0]",
    "form1[0].#subform[4].P6_Line7_SignatureApplicant[1]", "form1[0].#subform[4].P6_Line7_DateofSignature[1]",
    "form1[0].#subform[5].P7_Line8a_SignatureofPreparer[0]", "form1[0].#subform[5].P7_Line8b_DateofSignature[0]",
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

// Keyed by the RAW AcroForm field name — see i129-h1b-crosswalk.js's own
// note on why (targetFieldId is a separately normalized/slugified id that
// does not match this crosswalk's keys).
function classifyField(field) {
  const fieldName = field.fieldName || field.pdfFieldName || field.fieldId;
  if (USCIS_USE_ONLY_PATTERNS.some((pattern) => pattern.test(fieldName))) {
    return { status: "uscis_use_only", note: "USCIS-internal barcode/processing field." };
  }
  const mappedEdge = MAPPED_BY_FIELD_NAME.get(fieldName);
  if (mappedEdge) return { status: "mapped", edge: mappedEdge };
  if (MANUAL_ENTRY_SET.has(fieldName)) return { status: "manual_entry", note: "See crosswalk MANUAL_ENTRY_FIELDS for the specific reason." };
  if (!isInScopePage(field.pageNumber)) {
    return { status: "out_of_scope", note: "Not applicable to the H-4 Extension/EAD checklist." };
  }
  return { status: "manual_entry", note: "In-scope I-539 field without an individually authored source. Defaulted to manual_entry rather than left ambiguous - case manager completes at review." };
}

module.exports = {
  OUT_OF_SCOPE_PAGES,
  USCIS_USE_ONLY_PATTERNS,
  MAPPED_EDGES,
  MANUAL_ENTRY_FIELDS,
  classifyField,
};
