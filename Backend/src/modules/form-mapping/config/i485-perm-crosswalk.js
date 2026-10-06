// Form I-485 (Application to Register Permanent Residence or Adjust Status) PARTIAL crosswalk for the
// PERM workflow: canonical profile -> I-485 PDF fields.
//
// PARTIAL BY DESIGN. The PERM employee checklist (questionnaires/permChecklists.js) is a labor-certification
// questionnaire, NOT an I-485 questionnaire. Only the applicant data it genuinely overlaps with is mapped here:
// given / middle / family name, date of birth, A-Number, country of birth, country of citizenship, current
// immigration status, I-94 number and the current address. Everything else (admission history, eligibility,
// security/background Yes/No blocks, parents, marital history, employment history, SSN, sex, ...) stays
// unmapped; the seed lists it in graph.unmappedTargets and NO Yes/No box is ever defaulted.
//
// DATA SOURCE: every edge reads the CANONICAL profile (paths verified against
// canonical/config/profileCanonicalMap.js EMPLOYEE_PROFILE_TO_CANONICAL), never raw PERM answers, so the graph
// serves any case that shares the canonical profile. `checklistField` names the PERM question whose
// mapping.canonicalPath feeds that canonical path (a unit test checks the pairing).
//
// TARGET FIELDS: the active I-485 template, edition 2026-04-09 (760 fields, 24 pages). fieldName values were read
// from that template's formFields - none guessed. EDITION WARNING: uscis.gov/i-485 now lists edition 09/18/26
// (09/04/26 and 01/20/25 are rejected from 2026-09-18). The 2026-04-09 template is NOT the current edition; this
// graph is keyed by field name and the seed refuses to run if any edge no longer matches, but it must be re-diffed
// when a newer edition is imported (see FormEditionComparisonService).
//
// ITEM NUMBERS come from the real field names (Pt1Line4_AlienNumber = Part 1 Item 4, ...). The template's own
// generated labels are unreliable for some fields (e.g. "Item 25: Enter Other"), so labels were not used for
// item numbers.
//
// ADDRESS: Part 1 Item 18 holds two blocks. Field names Pt1Line18_{StreetNumberName,CityOrTown,State,ZipCode}
// sit ABOVE the "is your mailing address the same as your physical address?" Yes/No (Pt1Line18_YN) and
// Pt1Line18_Current* sit BELOW it under the checkbox label "If you answered No, provide your current mailing
// address" (geometry from the widgets' bounding boxes). The upper block is therefore the physical address. The
// canonical profile has ONE address (the PERM "Full Address" is the residence), so it feeds the physical block
// at MEDIUM confidence; the mailing block and the Yes/No are left for the case manager (a Yes/No is never
// guessed). The unit type/number cannot be split out of the single "Full Address" line and stay manual. The
// template flags the street field as numeric (a parsing artifact: it is "Street Number and Name", maxLength 34).
// The US-only block is only filled when the address country is the United States.
//
// CONFIDENCE: HIGH = 95 (clearly the same data on an actual field, active), MEDIUM = 75 (contextual, active),
// LOW = 35 (status 'review_required', never silently trusted). FormReadinessService tiers by these numbers
// (>=85 HIGH, >=72 MEDIUM, otherwise LOW).

const FORM_CODE = "I-485";
const SOURCE_LABEL = "PERM checklist";
const CONFIDENCE = { HIGH: 95, MEDIUM: 75, LOW: 35 };

const P = (subform) => `form1[0].#subform[${subform}].`;
const US_ONLY = { condition: { field: "contact.address.country", operator: "equals", value: "United States" } };
const DATE = { transform: { type: "date", format: "mm/dd/yyyy" } };
const DIGITS = { transform: { type: "digits" } };

function edge(spec) {
  const level = spec.confidenceLevel;
  return {
    formCode: FORM_CODE,
    source: spec.source,
    sourceVerified: true,
    sourceSystem: SOURCE_LABEL,
    ...spec,
    confidence: CONFIDENCE[level],
    status: level === "LOW" ? "review_required" : "active",
  };
}

const MAPPED_EDGES = [
  // --- Part 1 Item 1: current legal name (page 1) ---
  edge({ fieldName: `${P(0)}Pt1Line1_FamilyName[0]`, source: "person.lastName", checklistField: "employee_last_name", formSection: "Part 1", formItem: "Item 1 Family Name", formPage: 1, dataType: "text", required: true, confidenceLevel: "HIGH", note: "Part 1 Item 1, current legal family name." }),
  edge({ fieldName: `${P(0)}Pt1Line1_GivenName[0]`, source: "person.firstName", checklistField: "employee_first_name", formSection: "Part 1", formItem: "Item 1 Given Name", formPage: 1, dataType: "text", required: true, confidenceLevel: "HIGH", note: "Part 1 Item 1, current legal given name." }),
  edge({ fieldName: `${P(0)}Pt1Line1_MiddleName[0]`, source: "person.middleName", checklistField: "employee_middle_name", formSection: "Part 1", formItem: "Item 1 Middle Name", formPage: 1, dataType: "text", required: false, confidenceLevel: "HIGH", note: "Part 1 Item 1, middle name." }),
  // Continuation sheet (Part 14 additional information) repeats the Part 1 name; flattened fills do not auto-propagate.
  edge({ fieldName: `${P(24)}Pt1Line1_FamilyName[1]`, source: "person.lastName", checklistField: "employee_last_name", formSection: "Additional Information", formItem: "Header Family Name (repeat of Part 1 Item 1)", formPage: 24, dataType: "text", required: false, confidenceLevel: "HIGH", note: "Continuation sheet header, repeat of Part 1 Item 1." }),
  edge({ fieldName: `${P(24)}Pt1Line1_GivenName[1]`, source: "person.firstName", checklistField: "employee_first_name", formSection: "Additional Information", formItem: "Header Given Name (repeat of Part 1 Item 1)", formPage: 24, dataType: "text", required: false, confidenceLevel: "HIGH", note: "Continuation sheet header, repeat of Part 1 Item 1." }),
  edge({ fieldName: `${P(24)}Pt1Line1_MiddleName[1]`, source: "person.middleName", checklistField: "employee_middle_name", formSection: "Additional Information", formItem: "Header Middle Name (repeat of Part 1 Item 1)", formPage: 24, dataType: "text", required: false, confidenceLevel: "HIGH", note: "Continuation sheet header, repeat of Part 1 Item 1." }),

  // --- Part 1 Item 3: date of birth (page 1) ---
  edge({ fieldName: `${P(0)}Pt1Line3_DOB[0]`, source: "person.dob", checklistField: "employee_date_of_birth", formSection: "Part 1", formItem: "Item 3 Date of Birth", formPage: 1, dataType: "date", required: true, confidenceLevel: "HIGH", ...DATE, note: "Part 1 Item 3, date of birth (mm/dd/yyyy)." }),

  // --- Part 1 Item 4: A-Number (page 2); the widget pre-prints 'A-' so digits only ---
  edge({ fieldName: `${P(1)}Pt1Line4_AlienNumber[0]`, source: "person.alienNumber", checklistField: "employee_alien_registration_number", formSection: "Part 1", formItem: "Item 4 A-Number", formPage: 2, dataType: "alienNumber", required: false, confidenceLevel: "HIGH", ...DIGITS, note: "Part 1 Item 4, A-Number. Pre-printed 'A-' prefix, so digits only (widget maxLength 9)." }),

  // --- Part 1 Item 7 / 8: country of birth, country of citizenship (page 2) ---
  edge({ fieldName: `${P(1)}Pt1Line7_CountryOfBirth[0]`, source: "person.countryOfBirth", checklistField: "employee_birth_country", formSection: "Part 1", formItem: "Item 7 Country of Birth", formPage: 2, dataType: "text", required: true, confidenceLevel: "HIGH", transform: { type: "country" }, note: "Part 1 Item 7, country of birth. (City/Town of birth, Item 7, is not collected by the PERM checklist.)" }),
  edge({ fieldName: `${P(1)}Pt1Line8_CountryofCitizenshipNationality[0]`, source: "person.citizenship", checklistField: "employee_citizenship_country", formSection: "Part 1", formItem: "Item 8 Country of Citizenship or Nationality", formPage: 2, dataType: "text", required: true, confidenceLevel: "HIGH", transform: { type: "country" }, note: "Part 1 Item 8, country of citizenship or nationality." }),

  // --- Part 1 Item 12: I-94 number and status (page 3) ---
  edge({ fieldName: `${P(2)}P1Line12_I94[0]`, source: "immigration.i94.number", checklistField: "employee_i94_number", formSection: "Part 1", formItem: "Item 12 Form I-94 Arrival-Departure Record Number", formPage: 3, dataType: "text", required: false, confidenceLevel: "HIGH", note: "Part 1 Item 12, I-94 number (widget maxLength 11; the PERM answer is validated as 11 digits)." }),
  edge({ fieldName: `${P(2)}Pt1Line12_Status[0]`, source: "immigration.currentStatus", checklistField: "employee_current_us_status", formSection: "Part 1", formItem: "Item 12 Immigration Status on Form I-94 (class of admission)", formPage: 3, dataType: "text", required: true, confidenceLevel: "MEDIUM", note: "Part 1 Item 12, status on the I-94. The PERM answer is the CURRENT status (H1, H4, L1 ...), which normally equals the I-94 class of admission but not always - verify against the I-94." }),
  edge({ fieldName: `${P(2)}Pt1Line14_Status[0]`, source: "immigration.currentStatus", checklistField: "employee_current_us_status", formSection: "Part 1", formItem: "Item 14 Current Immigration Status (if different from I-94)", formPage: 3, dataType: "text", required: false, confidenceLevel: "LOW", note: "Part 1 Item 14, only answered when the current status differs from the I-94 (Item 13 Yes/No, which is never defaulted). Review required." }),

  // --- Part 1 Item 18: current physical address (page 3) - see ADDRESS note in the header ---
  edge({ fieldName: `${P(2)}Pt1Line18_StreetNumberName[0]`, source: "contact.address.line1", checklistField: "employee_address", formSection: "Part 1", formItem: "Item 18 Physical Address Street Number and Name", formPage: 3, dataType: "text", required: true, confidenceLevel: "MEDIUM", ...US_ONLY, note: "Part 1 Item 18, physical address street. The PERM 'Full Address' is a single line, so unit type/number stay manual." }),
  edge({ fieldName: `${P(2)}Pt1Line18_CityOrTown[0]`, source: "contact.address.city", checklistField: "employee_city", formSection: "Part 1", formItem: "Item 18 Physical Address City or Town", formPage: 3, dataType: "text", required: true, confidenceLevel: "MEDIUM", ...US_ONLY, note: "Part 1 Item 18, physical address city (widget maxLength 20)." }),
  edge({ fieldName: `${P(2)}Pt1Line18_State[0]`, source: "contact.address.state", checklistField: "employee_state", formSection: "Part 1", formItem: "Item 18 Physical Address State", formPage: 3, dataType: "dropdown", required: true, confidenceLevel: "MEDIUM", transform: { type: "usState", countryPath: "contact.address.country" }, ...US_ONLY, note: "Part 1 Item 18, physical address state (2-letter dropdown value)." }),
  edge({ fieldName: `${P(2)}Pt1Line18_ZipCode[0]`, source: "contact.address.zip", checklistField: "employee_zip_code", formSection: "Part 1", formItem: "Item 18 Physical Address ZIP Code", formPage: 3, dataType: "text", required: true, confidenceLevel: "MEDIUM", ...US_ONLY, note: "Part 1 Item 18, physical address ZIP (widget maxLength 5: a ZIP+4 will not fit and is left to the fitter / reviewer)." }),
];

// A-Number is printed in the header of every page ("pre-populates from page 1" in the XFA form); a flattened fill
// does not propagate it, so each header repeat is mapped too. [subform index, page number].
const A_NUMBER_HEADERS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13],
  [13, 14], [14, 15], [15, 16], [16, 17], [17, 18], [18, 19], [20, 20], [21, 21], [22, 22], [23, 23], [24, 24],
];
A_NUMBER_HEADERS.forEach(([subform, page], index) => {
  MAPPED_EDGES.push(edge({
    fieldName: `${P(subform)}AlienNumber[${index}]`,
    source: "person.alienNumber",
    checklistField: "employee_alien_registration_number",
    formSection: `Page ${page} header`,
    formItem: "A-Number (page header, repeat of Part 1 Item 4)",
    formPage: page,
    dataType: "alienNumber",
    required: false,
    confidenceLevel: "HIGH",
    ...DIGITS,
    note: "Page header A-Number (repeat of Part 1 Item 4); digits only, 'A-' is pre-printed.",
  }));
});

// Fields a case manager must enter by hand and that the canonical profile / PERM checklist cannot supply. Listed
// individually in graph.unmappedTargets (matched on the widget name without its #subform prefix).
const INDIVIDUAL_UNMAPPED = [
  { match: /^Pt1Line19_SSN\[0\]$/, item: "Part 1 Item 19 Social Security Number", reason: "MISSING_SOURCE", note: "The PERM checklist does not collect an SSN." },
  { match: /^Pt1Line9_USCISAccountNumber\[0\]$/, item: "Part 1 Item 9 USCIS Online Account Number", reason: "MISSING_SOURCE", note: "Not collected by the PERM checklist." },
  { match: /^Pt1Line7_CityTownOfBirth\[0\]$/, item: "Part 1 Item 7 City/Town of Birth", reason: "MISSING_SOURCE", note: "PERM collects only the country of birth." },
  { match: /^Pt1Line6_CB_Sex\[[01]\]$/, item: "Part 1 Item 6 Sex", reason: "MISSING_SOURCE", note: "Not collected by the PERM checklist (person.gender exists in canonical but is not populated by it)." },
  { match: /^Pt1Line10_/, item: "Part 1 Item 10 Last arrival into the U.S. (passport, visa, port of entry, date)", reason: "MISSING_SOURCE", note: "Last-entry details are not collected by the PERM checklist." },
  { match: /^Pt1Line11_(Admitted|Paroled|Other)\[0\]$/, item: "Part 1 Item 11 Manner of last arrival / admission class", reason: "MISSING_SOURCE", note: "Admission/parole class is not collected by the PERM checklist." },
  { match: /^P1Line12_(FamilyName|GivenName)\[0\]$/, item: "Part 1 Item 12 Name shown on Form I-94", reason: "MISSING_SOURCE", note: "The name on the I-94 can differ from the legal name; read from the I-94 document." },
  { match: /^Pt1Line12_Date\[0\]$/, item: "Part 1 Item 12 I-94 expiration date (or D/S)", reason: "MISSING_SOURCE", note: "Not collected by the PERM checklist." },
  { match: /^Pt1Line15_Date\[0\]$/, item: "Part 1 Item 15 Expiration of current status (or D/S)", reason: "MISSING_SOURCE", note: "Not collected by the PERM checklist." },
  { match: /^Pt1Line18_Date\[0\]$/, item: "Part 1 Item 18 Date moved to physical address", reason: "MISSING_SOURCE", note: "Not collected by the PERM checklist." },
  { match: /^Pt5Line(?!2_YNNA)/, item: "Part 5 Information about your parents", reason: "MISSING_SOURCE", note: "Parents' names, dates and places of birth are not collected by the PERM checklist." },
  { match: /^Pt3Line(3_DaytimePhoneNumber1|4_MobileNumber1|5_Email)\[0\]$/, item: "Applicant contact (daytime phone / mobile / email)", reason: "MISSING_SOURCE", note: "Applicant contact block is outside the approved partial overlap (PERM collects a residence phone only); entered at review." },
];

const USCIS_USE_ONLY_PATTERNS = [/PDF417BarCode/];

const MAPPED_BY_FIELD_NAME = new Map(MAPPED_EDGES.map((e) => [e.fieldName, e]));
const baseName = (fieldName) => String(fieldName || "").replace(/^form1\[0\]\.(?:#subform\[\d+\]\.)?/, "");

// Group label for the group-level unmappedTargets entries, derived from the REAL widget names. The Pt<N> token
// follows the PDF's own field naming, which does not always equal the printed Part number in this edition.
function groupOf(fieldName, pageNumber) {
  const base = baseName(fieldName);
  if (/^(AttorneyStateBarNumber|CheckBox1|VolagNumber|USCISOnlineAcctNumber)\[/.test(base)) {
    return { id: "g28", label: "G-28 / attorney or representative block (page 1)", reason: "MISSING_SOURCE", kind: "not_applicant_data" };
  }
  if (/^(Pt11|Part11_|P3_Line[456]_|P12_Signature|P13_Date)/.test(base)) return { id: "interpreter", label: "Interpreter block", reason: "MISSING_SOURCE", kind: "not_applicant_data" };
  if (/^(Pt12|P12Line)/.test(base)) return { id: "preparer", label: "Preparer block", reason: "MISSING_SOURCE", kind: "not_applicant_data" };
  if (/^(Pt13_|Pt3Line7[ab]_)/.test(base)) return { id: "signature", label: "Applicant signature / statement / officer-use block", reason: "MISSING_SOURCE", kind: "not_applicant_data" };
  if (/^(Pt3Line[345]_)/.test(base) && pageNumber >= 22) return { id: "applicant-contact", label: "Applicant contact", reason: "MISSING_SOURCE", kind: "personal" };
  if (/^Pt9Line3[abc]_|^P14_Line/.test(base)) return { id: "continuation", label: "Additional Information continuation sheet (page 24)", reason: "MISSING_SOURCE", kind: "not_applicant_data" };
  if (/^Table1\[|^Pt8Line68/.test(base)) return { id: "tables", label: "Part 8/9 itemised tables", reason: "MISSING_SOURCE", kind: "background" };
  const token = /^(?:Pt|Part|P)(\d+)/.exec(base);
  if (token) return { id: `Pt${token[1]}`, label: `Field group Pt${token[1]} (PDF field-name token)`, reason: "MISSING_SOURCE", kind: "form_data" };
  return { id: "other", label: "Other fields", reason: "MISSING_SOURCE", kind: "form_data" };
}

function individualEntry(fieldName) {
  const base = baseName(fieldName);
  return INDIVIDUAL_UNMAPPED.find((entry) => entry.match.test(base));
}

// Keyed by the RAW AcroForm field name.
function classifyField(field) {
  const fieldName = field.fieldName || field.pdfFieldName || field.fieldId;
  if (USCIS_USE_ONLY_PATTERNS.some((pattern) => pattern.test(fieldName))) return { status: "uscis_use_only", note: "USCIS-internal barcode field." };
  const mapped = MAPPED_BY_FIELD_NAME.get(fieldName);
  if (mapped) return { status: "mapped", edge: mapped };
  const individual = individualEntry(fieldName);
  if (individual) return { status: "manual_entry", individual, group: groupOf(fieldName, field.pageNumber), note: individual.note };
  return { status: "manual_entry", group: groupOf(fieldName, field.pageNumber), note: "Not PERM checklist data - completed at review." };
}

module.exports = { FORM_CODE, CONFIDENCE, MAPPED_EDGES, INDIVIDUAL_UNMAPPED, USCIS_USE_ONLY_PATTERNS, classifyField, groupOf, baseName };
