// Form I-131 (Application for Travel Documents, Parole Documents, and Arrival/Departure Records)
// crosswalk for the PERM workflow: canonical profile -> I-131 PDF fields. I-131 is a CONDITIONAL form
// on a PERM case (Advance Parole for the beneficiary, typically alongside an I-485).
//
// DATA SOURCE: canonical profile paths only. Every path below is one that the PERM employee checklist
// (questionnaires/permChecklists.js, checklistRole "employee") declares as mapping.canonicalPath and that
// exists in canonical/config/profileCanonicalMap.js. `checklistField` is that PERM question's key. A unit
// test asserts every (checklistField, canonicalPath) pair against the real checklist, so they cannot drift.
// This graph deliberately does NOT read the I-131 conditional checklist (questionnaires/i131Checklist.js,
// its applicant.* paths and EXPLICIT_CM flow) - that flow is unchanged.
//
// TARGET FIELDS: the 339 fields of the ACTIVE I-131 template (edition 01/20/25, OMB 1615-0013, expires
// 06/30/2027). fieldName values were read from that template's formFields; Part/Item numbers were checked
// against the PDF text (dev-assets/uscis/i-131_2025-20-01.pdf): Part 2 starts on page 4 (Item 1 name),
// Item 3 = Current Mailing Address, Item 4 = Current Physical Address (if different), Items 5-13 on page 5.
// The template's own auto-generated labels/sections are unreliable (e.g. "Part 5, Item 5"), so Part/Item
// are authored here.
//
// NEVER MAPPED (MISSING_SOURCE or manual): the application type / reason checkboxes (Part 1 - advance
// parole vs re-entry permit vs refugee travel document is a case-manager decision, never inferred),
// purpose of trip, travel dates, SSN (no canonical path), sex (not collected), USCIS online account,
// class of admission, I-94 (outside the authored scope), "information about them", biographic, processing,
// interpreter, preparer, signatures.

const PART2 = "Part 2. Information About You";
const HIGH = "HIGH";
const MEDIUM = "MEDIUM";
const LOW = "LOW";
const NUMERIC_CONFIDENCE = { HIGH: 95, MEDIUM: 70, LOW: 40 };

const NAME_P4 = "form1[0].P4[0].";
const P5 = "form1[0].P5[0].";
const P14 = "form1[0].#subform[13].";

const US = "United States";
const COUNTRY = "contact.address.country";
const isUs = { condition: { field: COUNTRY, operator: "equals", value: US } };
const notUs = { condition: { field: COUNTRY, operator: "not_equals", value: US } };

function edge(fieldName, page, item, canonicalPath, checklistField, confidenceLevel, dataType, note, extra = {}) {
  return {
    fieldName, formPage: page, formSection: PART2, item, canonicalPath, checklistField, confidenceLevel,
    confidence: NUMERIC_CONFIDENCE[confidenceLevel], dataType, required: false, note, ...extra,
  };
}
const req = { required: true };
const digitsOnly = { transform: { type: "digits" } };
const dateT = { transform: { type: "date", format: "mm/dd/yyyy" } };

// address block: Item 3 (mailing) and Item 4 (physical) share an identical widget layout.
function addressEdges(line, item, label, level, streetLevel) {
  const w = (leaf) => `${P5}Part2_Line${line}_${leaf}[0]`;
  const note = `Part 2 Item ${item} (${label})`;
  return [
    edge(w("StreetNumberName"), 5, item, "contact.address.line1", "employee_address", streetLevel, "text",
      `${note}, street number and name. The checklist asks one free-text "Full Address" - unit stays manual.`, req),
    edge(w("CityTown"), 5, item, "contact.address.city", "employee_city", level, "text", `${note}, city or town.`, req),
    edge(w("State"), 5, item, "contact.address.state", "employee_state", level, "dropdown",
      `${note}, state (US addresses only).`, { required: true, transform: { type: "usState", countryPath: COUNTRY } }),
    edge(w("ZipCode"), 5, item, "contact.address.zip", "employee_zip_code", level, "text", `${note}, ZIP code (US addresses only).`, { required: true, ...isUs }),
    edge(w("PostalCode"), 5, item, "contact.address.zip", "employee_zip_code", level === HIGH ? MEDIUM : level, "text", `${note}, postal code (non-US addresses only).`, notUs),
    edge(w("Country"), 5, item, COUNTRY, "employee_country", level, "text", `${note}, country.`, { required: true, transform: { type: "country" } }),
  ];
}

const MAPPED_EDGES = [
  // Item 1, your full name (page 4)
  edge(`${NAME_P4}Part2_Line1_FamilyName[0]`, 4, "1.a", "person.lastName", "employee_last_name", HIGH, "text", "Item 1.a, family name.", req),
  edge(`${NAME_P4}Part2_Line1_GivenName[0]`, 4, "1.b", "person.firstName", "employee_first_name", HIGH, "text", "Item 1.b, given name.", req),
  edge(`${NAME_P4}Part2_Line1_MiddleName[0]`, 4, "1.c", "person.middleName", "employee_middle_name", HIGH, "text", "Item 1.c, middle name (if applicable)."),

  // Items 3 and 4 (page 5). The checklist captures ONE residence address (it sits beside "Phone no. of
  // current residence"): clearly a physical address, only assumed to also be the mailing address.
  ...addressEdges(3, "3", "current mailing address", MEDIUM, MEDIUM),
  ...addressEdges(4, "4", "current physical address", HIGH, MEDIUM),

  // Items 5-7, 9 (page 5)
  edge(`${P5}#area[0].Part2_Line5_AlienNumber[0]`, 5, "5", "person.alienNumber", "employee_alien_registration_number", HIGH, "alienNumber",
    "Item 5, A-Number. Widget has a pre-printed 'A-', so digits only.", digitsOnly),
  edge(`${P5}Part2_Line6_CountryOfBirth[0]`, 5, "6", "person.countryOfBirth", "employee_birth_country", HIGH, "text", "Item 6, country of birth.", { required: true, transform: { type: "country" } }),
  edge(`${P5}Part2_Line7_CountryOfCitizenshiporNationality[0]`, 5, "7", "person.citizenship", "employee_citizenship_country", HIGH, "text", "Item 7, country of citizenship or nationality.", { required: true, transform: { type: "country" } }),
  edge(`${P5}Part2_Line9_DateOfBirth[0]`, 5, "9", "person.dob", "employee_date_of_birth", HIGH, "date", "Item 9, date of birth.", { required: true, ...dateT }),

  // Page 14 (Part 13 additional information) header repeats the applicant identity.
  edge(`${P14}Part2_Line1_FamilyName[0]`, 14, "1.a", "person.lastName", "employee_last_name", HIGH, "text", "Additional-information page header, family name (repeat)."),
  edge(`${P14}Part2_Line1_GivenName[0]`, 14, "1.b", "person.firstName", "employee_first_name", HIGH, "text", "Additional-information page header, given name (repeat)."),
  edge(`${P14}Part2_Line1_MiddleName[0]`, 14, "1.c", "person.middleName", "employee_middle_name", HIGH, "text", "Additional-information page header, middle name (repeat)."),
  edge(`${P14}Global_ANumber[0].Part2_Line5_AlienNumber[0]`, 14, "5", "person.alienNumber", "employee_alien_registration_number", HIGH, "alienNumber", "Additional-information page header, A-Number (repeat).", digitsOnly),
];

// Required-by-the-form data the PERM checklist cannot supply. `fields` is an exact-fieldName list OR
// `match` a test on the raw fieldName; one entry per key field, grouped for large blocks.
const leaf = (name) => String(name).split(".").pop();
const UNMAPPED_ENTRIES = [
  { id: "part1_application_type", group: true, formSection: "Part 1. Application Type", item: "1-11", required: true,
    match: (n) => /CB_AppType\[/.test(n), reason: "Application type / reason (advance parole vs re-entry permit vs refugee travel document vs TPS vs parole) is a case-manager decision; never inferred from a PERM case." },
  { id: "part1_supporting_detail", group: true, formSection: "Part 1. Application Type", item: "4-13",
    match: (n) => /\.P1_Line\d/.test(n), reason: "Receipt numbers, programs and admission data for the selected application type; not in the PERM checklist." },
  { id: "part2_other_names", group: true, formSection: PART2, item: "2",
    match: (n) => /Part2_Line2_(Family|Given|Middle)Name\d/.test(n), reason: "Other names used - not collected by the PERM checklist." },
  { id: "part2_item8_sex", group: true, formSection: PART2, item: "8", required: true,
    match: (n) => /Part2_Line8_Gender/.test(n), reason: "Sex is not collected by the PERM employee checklist (person.gender exists canonically but has no PERM question)." },
  { id: "part2_item10_ssn", formSection: PART2, item: "10", required: false,
    match: (n) => /Part2_Line10_SSN/.test(n), reason: "No canonical SSN path exists; the PERM checklist does not collect it." },
  { id: "part2_item11_uscis_online_account", formSection: PART2, item: "11",
    match: (n) => /Part2_Line11_USCISOnlineAcctNumber/.test(n), reason: "USCIS Online Account Number not collected by the PERM checklist." },
  { id: "part2_item12_class_of_admission", formSection: PART2, item: "12",
    match: (n) => /Part2_Line12_ClassofAdmission/.test(n), reason: "Class of admission not collected (immigration.currentStatus is a status, not a COA code); outside authored scope." },
  { id: "part2_item13_i94", formSection: PART2, item: "13",
    match: (n) => /Part2_Line13_I94RecordNo/.test(n), reason: "I-94 record number outside the authored scope of this graph." },
  { id: "part2_about_them", group: true, formSection: "Part 2. Information About Them (continued)", item: "14-27",
    match: (n) => /\.P6\[0\]\./.test(n) || /\.P7\[0\]\.P2_Line2[67]/.test(n), reason: "Only for a request made on behalf of another person outside the U.S.; not the PERM beneficiary's own data." },
  { id: "part3_biographic", group: true, formSection: "Part 3. Biographic Information", item: "1-6",
    match: (n) => /\.P3_Line/.test(n), reason: "Ethnicity, race, height, weight, eye/hair colour not collected." },
  { id: "part4_processing", group: true, formSection: "Part 4. Processing Information", item: "1-9",
    match: (n) => /(\.P4_Line|\.P4\[0\]\.P4_)/.test(n) && !/Part2_Line/.test(n) || /Line4c_/.test(n), reason: "Processing / travel-document history answers not collected." },
  { id: "part5_time_outside_us", group: true, formSection: "Part 5. Time Outside the United States", item: "1",
    match: (n) => /\.P5_Line/.test(n), reason: "Time spent outside the U.S. not collected." },
  { id: "part6_refugee_travel", group: true, formSection: "Part 6. Refugee Travel Document information", item: "1-6",
    match: (n) => /\.P6_Line/.test(n), reason: "Refugee-specific answers; never inferred." },
  { id: "part7_date_of_departure", formSection: "Part 7. Proposed Travel", item: "1", required: true,
    match: (n) => /P7_Line1_DateOfDeparture/.test(n), reason: "Travel date - not in the PERM checklist; never inferred." },
  { id: "part7_purpose_of_trip", formSection: "Part 7. Proposed Travel", item: "2", required: true,
    match: (n) => /P7_Line2_Purpose/.test(n), reason: "Purpose of trip - not in the PERM checklist; never inferred." },
  { id: "part7_countries_to_visit", formSection: "Part 7. Proposed Travel", item: "3", required: true,
    match: (n) => /P7_Line3_ListCountries/.test(n), reason: "Countries to visit - not in the PERM checklist." },
  { id: "part7_expected_length_of_trip", formSection: "Part 7. Proposed Travel", item: "5", required: true,
    match: (n) => /P7_Line5_ExpectedLengthTrip/.test(n), reason: "Expected length of trip - not in the PERM checklist." },
  { id: "part7_other_travel_answers", group: true, formSection: "Part 7. Proposed Travel", item: "4",
    match: (n) => /(P7_Line4_CB|Line4c_)/.test(n), reason: "Travel-related yes/no answers not collected." },
  { id: "part8_9_parole_and_ead", group: true, formSection: "Part 8-9. Parole / Employment Authorization", item: "1-3",
    match: (n) => /\.(P8_|P9_)/.test(n), reason: "Parole explanation / intended arrival data not collected." },
];

const USCIS_USE_ONLY_PATTERNS = [/PDF417BarCode/];
const MAPPED_BY_FIELD_NAME = new Map(MAPPED_EDGES.map((e) => [e.fieldName, e]));

// status: mapped | missing_source | uscis_use_only | manual_entry
function classifyField(field) {
  const fieldName = field.fieldName || field.pdfFieldName || field.targetPdfField || field.fieldId;
  if (USCIS_USE_ONLY_PATTERNS.some((p) => p.test(fieldName))) return { status: "uscis_use_only", note: "USCIS-internal barcode field." };
  const mapped = MAPPED_BY_FIELD_NAME.get(fieldName);
  if (mapped) return { status: "mapped", edge: mapped };
  const entry = UNMAPPED_ENTRIES.find((u) => u.match(fieldName));
  if (entry) return { status: "missing_source", entry };
  return { status: "manual_entry", note: "Not PERM checklist data (applicant contact, interpreter, preparer, signatures, province, apt/unit, additional information) - completed at review." };
}

module.exports = { MAPPED_EDGES, UNMAPPED_ENTRIES, NUMERIC_CONFIDENCE, USCIS_USE_ONLY_PATTERNS, PART2, classifyField, leaf, LOW };
