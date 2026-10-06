// Form I-765 (Application for Employment Authorization) crosswalk for the PERM workflow:
// canonical employee profile -> I-765 PDF fields.
//
// WHAT THIS IS: a GENERAL, canonical-only graph for a PERM-based beneficiary. Every edge reads a
// canonical profile path (person.* / contact.* / immigration.*) that the PERM employee checklist
// (questionnaires/permChecklists.js, EMPLOYEE_QUESTIONS[].map) declares as its mapping.canonicalPath,
// verified in canonical/config/profileCanonicalMap.js. No raw.questionnaireAnswers path is read.
//
// COEXISTENCE WITH i765-h4-crosswalk.js: that crosswalk is category-specific (H-4 EAD) and its graph
// is NOT the active one (the active I-765 graph before this file had 0 edges - biographic tier). This
// graph is a deliberately narrower, safer superset of the H-4 identity coverage (names, A-Number,
// mailing address, DOB, country of birth, I-94, current status, phone, email) and does NOT copy the
// H-4 crosswalk's known defects (see HEADER NOTES). The H-4 file/seed is untouched.
//
// TARGET FIELDS: the 161 fields of the active I-765 template (edition 08/21/25, template version
// 2026-09-22). Item numbers below are taken from the template's own field labels, not guessed.
//
// HEADER NOTES (differences from the H-4 crosswalk, on purpose):
//   - Line17a/Line17b_CountryOfBirth are labelled "Item 14: Enter the Country" = Item 14.a/14.b COUNTRY OF
//     CITIZENSHIP. The H-4 crosswalk mapped Line17b to country of birth; country of birth is
//     Page3 Line18c (Item 15), mapped here.
//   - The physical-address block (Item 7) is NOT filled from the single canonical address.
//   - Item 27 eligibility category (section_1/2/3), Part 1 reason for applying, SSN, gender, marital
//     status, birth city/state, last-entry details and passport details are MISSING_SOURCE.
//   - THE ELIGIBILITY CATEGORY IS NEVER INFERRED FROM "PERM" (or from any visa type). It must come from
//     the actual filing context, entered by staff.
const { EMPLOYEE_QUESTIONS } = require("../../questionnaires/permChecklists");

const FORM_CODE = "I-765";
const SOURCE = "PERM checklist";
const CONFIDENCE = { HIGH: 95, MEDIUM: 75, LOW: 40 };

const checklistKeyForPath = (path) => String(path).replace(/\./g, "_");
// Checklist question key (employee_first_name ...) for a canonical path, or null when the PERM
// employee checklist has no question mapped to it.
function checklistFieldFor(canonicalPath) {
  const q = EMPLOYEE_QUESTIONS.find((spec) => spec.map === canonicalPath);
  return q ? checklistKeyForPath(q.path) : null;
}

const P2 = "Part 2. Information About You";
const P3 = "Part 3. Applicant's Statement, Contact Information";
const P6 = "Part 6. Additional Information (continuation sheet header)";
const F = "form1[0].";

const edge = (fieldName, canonicalPath, o) => ({
  fieldName, canonicalPath, checklistField: checklistFieldFor(canonicalPath), formCode: FORM_CODE,
  required: false, confidenceLevel: "HIGH", transform: { type: "direct" }, ...o,
});

const MAPPED_EDGES = [
  // --- Item 1: your full legal name (page 1) ---
  edge(`${F}Page1[0].Line1a_FamilyName[0]`, "person.lastName", { item: "1.a", formSection: P2, formPage: 1, dataType: "text", required: true, note: "Item 1, family name." }),
  edge(`${F}Page1[0].Line1b_GivenName[0]`, "person.firstName", { item: "1.b", formSection: P2, formPage: 1, dataType: "text", required: true, note: "Item 1, given name." }),
  edge(`${F}Page1[0].Line1c_MiddleName[0]`, "person.middleName", { item: "1.c", formSection: P2, formPage: 1, dataType: "text", note: "Item 1, middle name." }),

  // --- Item 5: mailing address (page 2). The unit type checkboxes and in-care-of stay manual. ---
  edge(`${F}Page2[0].Line4b_StreetNumberName[0]`, "contact.address.line1", { item: "5.b", formSection: P2, formPage: 2, dataType: "number", required: true, note: "Item 5, street number and name (template widget type is 'number' but it is the street text box)." }),
  edge(`${F}Page2[0].Pt2Line5_CityOrTown[0]`, "contact.address.city", { item: "5.d", formSection: P2, formPage: 2, dataType: "text", required: true, note: "Item 5, city or town." }),
  edge(`${F}Page2[0].Pt2Line5_State[0]`, "contact.address.state", { item: "5.e", formSection: P2, formPage: 2, dataType: "dropdown", required: true, transform: { type: "usState", countryPath: "contact.address.country" }, note: "Item 5, state dropdown. Only a recognised US state of a US address is written; a foreign province is never put in the dropdown." }),
  edge(`${F}Page2[0].Pt2Line5_ZipCode[0]`, "contact.address.zip", { item: "5.f", formSection: P2, formPage: 2, dataType: "number", required: true, note: "Item 5, ZIP code." }),

  // --- Item 8: A-Number (page 2). Widget has a pre-printed 'A-' so digits only. ---
  edge(`${F}Page2[0].Line7_AlienNumber[0]`, "person.alienNumber", { item: "8", formSection: P2, formPage: 2, dataType: "alienNumber", transform: { type: "digits" }, note: "Item 8, A-Number, digits only (the 'A-' is pre-printed). Optional in the checklist." }),

  // --- Item 14.a: country of citizenship or nationality (page 2) ---
  edge(`${F}Page2[0].Line17a_CountryOfBirth[0]`, "person.citizenship", { item: "14.a", formSection: P2, formPage: 2, dataType: "text", required: true, confidenceLevel: "MEDIUM", note: "Labelled 'Item 14: Enter the Country' (14.a/14.b are the two countries of citizenship; the widget name says 'CountryOfBirth' but the label is Item 14). First citizenship only; the second (Line17b) is left manual." }),

  // --- Items 15-17, 25 (page 3) ---
  edge(`${F}Page3[0].Line18c_CountryOfBirth[0]`, "person.countryOfBirth", { item: "15.c", formSection: P2, formPage: 3, dataType: "text", required: true, note: "Item 15, country of birth." }),
  edge(`${F}Page3[0].Line19_DOB[0]`, "person.dob", { item: "16", formSection: P2, formPage: 3, dataType: "date", required: true, transform: { type: "date", format: "mm/dd/yyyy" }, note: "Item 16, date of birth." }),
  edge(`${F}Page3[0].Line20a_I94Number[0]`, "immigration.i94.number", { item: "17", formSection: P2, formPage: 3, dataType: "number", note: "Item 17, I-94 Arrival-Departure Record number (checklist: 'put all 11 digits'). Written as entered - newer I-94 numbers may contain letters." }),
  edge(`${F}Page3[0].Line24_CurrentStatus[0]`, "immigration.currentStatus", { item: "25", formSection: P2, formPage: 3, dataType: "text", required: true, confidenceLevel: "MEDIUM", note: "Item 25, current immigration status. The checklist select uses short codes (H1, H4, B1 ...) while the form expects the full category text, so staff confirm the wording." }),

  // --- Part 3: applicant contact information (page 4) ---
  edge(`${F}Page4[0].Pt3Line3_DaytimePhoneNumber1[0]`, "contact.phone", { item: "3", formSection: P3, formPage: 4, dataType: "phone", confidenceLevel: "MEDIUM", transform: { type: "phone" }, note: "Part 3 Item 3, daytime phone. The checklist asks for the phone of current residence, which may not be the daytime number." }),
  edge(`${F}Page4[0].Pt3Line5_Email[0]`, "contact.email", { item: "5", formSection: P3, formPage: 4, dataType: "email", confidenceLevel: "MEDIUM", note: "Part 3 Item 5, email. Canonical contact.email exists; the PERM employee checklist has no email question, so it comes from the account profile." }),

  // --- Continuation sheet header (page 7): pre-populated repeats of Part 1 identity data ---
  edge(`${F}Page7[0].Line1a_FamilyName[0]`, "person.lastName", { item: "1.a", formSection: P6, formPage: 7, dataType: "text", note: "Continuation sheet header, family name (repeat)." }),
  edge(`${F}Page7[0].Line1b_GivenName[0]`, "person.firstName", { item: "1.b", formSection: P6, formPage: 7, dataType: "text", note: "Continuation sheet header, given name (repeat)." }),
  edge(`${F}Page7[0].Line1c_MiddleName[0]`, "person.middleName", { item: "1.c", formSection: P6, formPage: 7, dataType: "text", note: "Continuation sheet header, middle name (repeat)." }),
  edge(`${F}Page7[0].Line7_AlienNumber[0]`, "person.alienNumber", { item: "2", formSection: P6, formPage: 7, dataType: "alienNumber", transform: { type: "digits" }, note: "Continuation sheet header, A-Number (repeat), digits only." }),
].map((e) => ({
  ...e,
  source: SOURCE,
  confidence: CONFIDENCE[e.confidenceLevel],
  status: e.confidenceLevel === "LOW" ? "review_required" : "active",
}));

// Required fields the PERM checklist (or canonical profile, as populated by it) cannot supply.
// confidenceLevel is always "UNMAPPED"; status "MISSING_SOURCE". Never auto-filled, never inferred.
const miss = (fieldName, item, formSection, formPage, dataType, label, reason) => ({
  fieldName, item, formSection, formPage, dataType, label, reason,
});
const NO_QUESTION = "The PERM employee checklist has no question for this.";
const ELIGIBILITY = "ELIGIBILITY CATEGORY - never inferred from PERM; must come from the actual filing context.";
const P1 = "Part 1. Reason for Applying";
const MISSING_SOURCE_TARGETS = [
  miss(`${F}Page1[0].Part1_Checkbox[0]`, "1", P1, 1, "checkbox", "Reason for applying: initial permission to accept employment", "Comes from the filing context (initial / replacement / renewal), not from the checklist."),
  miss(`${F}Page1[0].Part1_Checkbox[1]`, "1", P1, 1, "checkbox", "Reason for applying: replacement of lost, stolen, damaged or erroneous card", "Comes from the filing context, not from the checklist."),
  miss(`${F}Page1[0].Part1_Checkbox[2]`, "1", P1, 1, "checkbox", "Reason for applying: renewal of permission to accept employment", "Comes from the filing context, not from the checklist."),
  miss(`${F}Page2[0].Part2Line5_Checkbox[0]`, "6", P2, 2, "checkbox", "Item 6: mailing address same as physical address - No", "Canonical holds a single address; whether it differs from the physical address is not collected."),
  miss(`${F}Page2[0].Part2Line5_Checkbox[1]`, "6", P2, 2, "checkbox", "Item 6: mailing address same as physical address - Yes", "Canonical holds a single address; whether it differs from the physical address is not collected."),
  miss(`${F}Page2[0].Line9_Checkbox[0]`, "10", P2, 2, "checkbox", "Item 10: sex - Female", NO_QUESTION),
  miss(`${F}Page2[0].Line9_Checkbox[1]`, "10", P2, 2, "checkbox", "Item 10: sex - Male", NO_QUESTION),
  miss(`${F}Page2[0].Line10_Checkbox[0]`, "11", P2, 2, "checkbox", "Item 11: marital status - Widowed", NO_QUESTION),
  miss(`${F}Page2[0].Line10_Checkbox[1]`, "11", P2, 2, "checkbox", "Item 11: marital status - Divorced", NO_QUESTION),
  miss(`${F}Page2[0].Line10_Checkbox[2]`, "11", P2, 2, "checkbox", "Item 11: marital status - Single", NO_QUESTION),
  miss(`${F}Page2[0].Line10_Checkbox[3]`, "11", P2, 2, "checkbox", "Item 11: marital status - Married", NO_QUESTION),
  miss(`${F}Page2[0].Line19_Checkbox[0]`, "12", P2, 2, "checkbox", "Item 12: Social Security card question - No", NO_QUESTION),
  miss(`${F}Page2[0].Line19_Checkbox[1]`, "12", P2, 2, "checkbox", "Item 12: Social Security card question - Yes", NO_QUESTION),
  miss(`${F}Page2[0].Line12b_SSN[0]`, "13", P2, 2, "ssn", "Item 13: Social Security Number", "No canonical SSN path exists (only person.ssnLast4, which is not a full SSN) and the checklist does not ask."),
  miss(`${F}Page3[0].Line18a_CityTownOfBirth[0]`, "15.a", P2, 3, "text", "Item 15: city/town/village of birth", "No canonical path for city of birth."),
  miss(`${F}Page3[0].Line18b_CityTownOfBirth[0]`, "15.b", P2, 3, "text", "Item 15: state/province of birth", "No canonical path for state/province of birth."),
  miss(`${F}Page3[0].Line20b_Passport[0]`, "18", P2, 3, "passport", "Item 18: passport number", "Canonical person.passport.number exists but the PERM checklist does not collect it."),
  miss(`${F}Page3[0].Line20d_CountryOfIssuance[0]`, "20", P2, 3, "text", "Item 20: country that issued the passport/travel document", "Canonical person.passport.country exists but the PERM checklist does not collect it."),
  miss(`${F}Page3[0].Line20e_ExpDate[0]`, "21", P2, 3, "date", "Item 21: passport/travel document expiration date", "Canonical person.passport.expirationDate exists but the PERM checklist does not collect it."),
  miss(`${F}Page3[0].Line21_DateOfLastEntry[0]`, "22", P2, 3, "date", "Item 22: date of last arrival", "No canonical path / checklist question for last arrival date."),
  miss(`${F}Page3[0].place_entry[0]`, "23", P2, 3, "text", "Item 23: place of last arrival", "No canonical path / checklist question."),
  miss(`${F}Page3[0].Line23_StatusLastEntry[0]`, "24", P2, 3, "text", "Item 24: immigration status at last arrival", "Distinct from current status; no canonical path / checklist question."),
  miss(`${F}Page3[0].#area[1].section_1[0]`, "27", P2, 3, "text", "Item 27: eligibility category (first four characters)", ELIGIBILITY),
  miss(`${F}Page3[0].#area[1].section_2[0]`, "27", P2, 3, "text", "Item 27: eligibility category (middle three characters)", ELIGIBILITY),
  miss(`${F}Page3[0].#area[1].section_3[0]`, "27", P2, 3, "text", "Item 27: eligibility category (last three characters)", ELIGIBILITY),
];

// Fields that must never carry an edge from this crosswalk.
const ELIGIBILITY_CATEGORY_FIELDS = MISSING_SOURCE_TARGETS.filter((t) => t.item === "27").map((t) => t.fieldName);

const USCIS_USE_ONLY_PATTERNS = [/PDF417BarCode/];
const MAPPED_BY_FIELD_NAME = new Map(MAPPED_EDGES.map((e) => [e.fieldName, e]));
const MISSING_BY_FIELD_NAME = new Map(MISSING_SOURCE_TARGETS.map((t) => [t.fieldName, t]));

function classifyField(field) {
  const fieldName = field.fieldName || field.pdfFieldName || field.fieldId;
  if (USCIS_USE_ONLY_PATTERNS.some((p) => p.test(fieldName))) return { status: "uscis_use_only" };
  const mapped = MAPPED_BY_FIELD_NAME.get(fieldName);
  if (mapped) return { status: "mapped", edge: mapped };
  const missing = MISSING_BY_FIELD_NAME.get(fieldName);
  if (missing) return { status: "missing_source", target: missing };
  return { status: "manual_entry" };
}

module.exports = { FORM_CODE, SOURCE, CONFIDENCE, MAPPED_EDGES, MISSING_SOURCE_TARGETS, ELIGIBILITY_CATEGORY_FIELDS, USCIS_USE_ONLY_PATTERNS, classifyField, checklistFieldFor };
