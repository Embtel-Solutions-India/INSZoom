// Canonical -> I-129F (K-1 fiancé(e) petition) field crosswalk, mirroring
// i129-h1b-crosswalk.js's shape and conventions (MAPPED_EDGES / manual-entry
// buckets / classifyField()), authored against the real bundled I-129F PDF
// (Backend/dev-assets/uscis/i-129f_2025-01-20.pdf - field names, page
// numbers, and checkbox onValues extracted empirically via pdf-lib, same
// standard as the I-129 crosswalk).
//
// SCOPE (v1, deliberate): family-workflow/questionnaires/k1.js has no
// canonicalPath mechanism at all (unlike employmentChecklists.js's
// EMPLOYEE_CANONICAL_PATHS) - every k1.js field resolves only via
// raw.questionnaireAnswers.<key>.value, keyed the same way
// familyChecklists.js derives question keys (fieldCatalog path with dots
// replaced by underscores). This pass maps the identity/biographical fields
// for both parties (name, DOB, gender, marital status, birth/citizenship
// country) with real, verified widget names and onValues - the highest-value,
// lowest-ambiguity subset. Addresses (k1.js stores each as ONE combined
// free-text field, not split street/city/state/zip - same format mismatch
// i129-h1b-crosswalk.js already documents for h1b.js's institutionAddress),
// the repeating history groups (residential/employment history, parents,
// prior spouses, children), and I-129F's own filing-history block are
// explicitly NOT mapped in this pass - flagged as a follow-up rather than
// guessed or silently left unclassified. See MANUAL_ENTRY_FIELDS below.
const FORM_CODE = "I-129F";
const VERSION = "2025-01-20";

const USCIS_USE_ONLY_PATTERNS = [/PDF417BarCode/];

function checkboxMatch(source, value) {
  return { condition: { field: source, operator: "equals", value }, transform: { type: "boolean" } };
}

// Verified via pdf-lib's widget.getOnValue() against the real PDF - not
// assumed from field-name/position the way i129-h1b-crosswalk.js had to for
// its own ambiguous WageLevelBox widgets. onValues: /W /D /S /M.
const MARITAL_STATUS_CHECKBOX_INDEX = { widowed: 0, divorced: 1, single: 2, married: 3 };

const MAPPED_EDGES = [
  // --- Part 1: Petitioner (pages 1, 3) ---
  { fieldName: "form1[0].#subform[0].Pt1Line6a_FamilyName[0]", source: "raw.questionnaireAnswers.petitioner_info_lastName.value", note: "Item 6a, petitioner family name." },
  { fieldName: "form1[0].#subform[0].Pt1Line6b_GivenName[0]", source: "raw.questionnaireAnswers.petitioner_info_firstName.value", note: "Item 6b, petitioner given name." },
  { fieldName: "form1[0].#subform[0].Pt1Line6c_MiddleName[0]", source: "raw.questionnaireAnswers.petitioner_info_middleName.value", note: "Item 6c, petitioner middle name." },
  { fieldName: "form1[0].#subform[0].Pt1Line1_AlienNumber[0]", source: "raw.questionnaireAnswers.petitioner_info_aNumber.value", note: "Item 1, petitioner A-Number." },
  { fieldName: "form1[0].#subform[0].Pt1Line2_AcctIdentifier[0]", source: "raw.questionnaireAnswers.petitioner_info_uscisOnlineAccountNumber.value", note: "Item 2, USCIS Online Account Number." },
  { fieldName: "form1[0].#subform[0].Pt1Line3_SSN[0]", source: "raw.questionnaireAnswers.petitioner_info_ssn.value", note: "Item 3, petitioner SSN." },
  { fieldName: "form1[0].#subform[2].Pt1Line21_Checkbox[0]", source: "raw.questionnaireAnswers.petitioner_info_gender.value", ...checkboxMatch("raw.questionnaireAnswers.petitioner_info_gender.value", "Male"), note: "Item 21, petitioner sex - Male widget. onValue /M verified via pdf-lib." },
  { fieldName: "form1[0].#subform[2].Pt1Line21_Checkbox[1]", source: "raw.questionnaireAnswers.petitioner_info_gender.value", ...checkboxMatch("raw.questionnaireAnswers.petitioner_info_gender.value", "Female"), note: "Item 21, petitioner sex - Female widget. onValue /F verified via pdf-lib." },
  { fieldName: "form1[0].#subform[2].Pt1Line22_DateofBirth[0]", source: "raw.questionnaireAnswers.petitioner_info_dateOfBirth.value", transform: { type: "date", format: "mm/dd/yyyy" }, note: "Item 22, petitioner date of birth." },
  { fieldName: "form1[0].#subform[2].Pt1Line24_CityTownOfBirth[0]", source: "raw.questionnaireAnswers.petitioner_info_cityTownOfBirth.value", note: "Item 24, petitioner city/town of birth." },
  { fieldName: "form1[0].#subform[2].Pt1Line25_ProvinceOrStateOfBirth[0]", source: "raw.questionnaireAnswers.petitioner_info_stateProvinceOfBirth.value", note: "Item 25, petitioner state/province of birth." },
  { fieldName: "form1[0].#subform[2].Pt1Line26_CountryOfCitzOrNationality[0]", source: "raw.questionnaireAnswers.petitioner_info_countryOfCitizenship.value", note: "Item 26, petitioner country of citizenship/nationality." },
  ...Object.entries(MARITAL_STATUS_CHECKBOX_INDEX).map(([status, index]) => ({
    fieldName: `form1[0].#subform[2].Pt1Line23_Checkbox[${index}]`,
    source: "raw.questionnaireAnswers.petitioner_info_maritalStatus.value",
    ...checkboxMatch("raw.questionnaireAnswers.petitioner_info_maritalStatus.value", status),
    note: `Item 23, petitioner marital status - ${status} widget (onValue verified via pdf-lib, index ${index}).`,
  })),
  { fieldName: "form1[0].#subform[3].Pt1Line21c_DateOfIssuance[0]", source: "raw.questionnaireAnswers.petitioner_citizenship_certificateDateOfIssuance.value", transform: { type: "date", format: "mm/dd/yyyy" }, note: "Certificate of Citizenship/Naturalization date of issuance." },
  { fieldName: "form1[0].#subform[3].Pt1Line21a_CertificateNumber[0]", source: "raw.questionnaireAnswers.petitioner_citizenship_certificateNumber.value", note: "Certificate number." },
  { fieldName: "form1[0].#subform[3].Pt1Line21b_PlaceofIssuance[0]", source: "raw.questionnaireAnswers.petitioner_citizenship_certificatePlaceOfIssuance.value", note: "Certificate place of issuance." },

  // --- Part 2: Beneficiary (page 4) ---
  { fieldName: "form1[0].#subform[3].Pt2Line1a_FamilyName[0]", source: "raw.questionnaireAnswers.beneficiary_info_lastName.value", note: "Item 1a, beneficiary family name." },
  { fieldName: "form1[0].#subform[3].Pt2Line1b_GivenName[0]", source: "raw.questionnaireAnswers.beneficiary_info_firstName.value", note: "Item 1b, beneficiary given name." },
  { fieldName: "form1[0].#subform[3].Pt2Line1c_MiddleName[0]", source: "raw.questionnaireAnswers.beneficiary_info_middleName.value", note: "Item 1c, beneficiary middle name." },
  { fieldName: "form1[0].#subform[3].Pt2Line2_AlienNumber[0]", source: "raw.questionnaireAnswers.beneficiary_info_aNumber.value", note: "Item 2, beneficiary A-Number." },
  { fieldName: "form1[0].#subform[3].Pt2Line3_SSN[0]", source: "raw.questionnaireAnswers.beneficiary_info_ssn.value", note: "Item 3, beneficiary SSN." },
  { fieldName: "form1[0].#subform[3].Pt2Line4_DateOfBirth[0]", source: "raw.questionnaireAnswers.beneficiary_info_dateOfBirth.value", transform: { type: "date", format: "mm/dd/yyyy" }, note: "Item 4, beneficiary date of birth." },
  { fieldName: "form1[0].#subform[3].Pt2Line5_Checkboxes[0]", source: "raw.questionnaireAnswers.beneficiary_info_gender.value", ...checkboxMatch("raw.questionnaireAnswers.beneficiary_info_gender.value", "Male"), note: "Item 5, beneficiary sex - Male widget. onValue /M verified via pdf-lib." },
  { fieldName: "form1[0].#subform[3].Pt2Line5_Checkboxes[1]", source: "raw.questionnaireAnswers.beneficiary_info_gender.value", ...checkboxMatch("raw.questionnaireAnswers.beneficiary_info_gender.value", "Female"), note: "Item 5, beneficiary sex - Female widget. onValue /F verified via pdf-lib." },
  ...Object.entries(MARITAL_STATUS_CHECKBOX_INDEX).map(([status, index]) => ({
    fieldName: `form1[0].#subform[3].Pt2Line6_Checkboxes[${index}]`,
    source: "raw.questionnaireAnswers.beneficiary_info_maritalStatus.value",
    ...checkboxMatch("raw.questionnaireAnswers.beneficiary_info_maritalStatus.value", status),
    note: `Item 6, beneficiary marital status - ${status} widget (onValue verified via pdf-lib, index ${index}).`,
  })),
  { fieldName: "form1[0].#subform[3].Pt2Line7_CityTownOfBirth[0]", source: "raw.questionnaireAnswers.beneficiary_info_cityTownOfBirth.value", note: "Item 7, beneficiary city/town of birth." },
  { fieldName: "form1[0].#subform[3].Pt2Line8_CountryOfBirth[0]", source: "raw.questionnaireAnswers.beneficiary_info_countryOfBirth.value", note: "Item 8, beneficiary country of birth." },
  { fieldName: "form1[0].#subform[3].Pt2Line9_CountryofCitzOrNationality[0]", source: "raw.questionnaireAnswers.beneficiary_info_countryOfCitizenship.value", note: "Item 9, beneficiary country of citizenship/nationality." },
];

const MANUAL_ENTRY_REASONS = {
  // k1.js stores each address as ONE combined free-text field - same
  // format-mismatch class i129-h1b-crosswalk.js documents for h1b.js's
  // institutionAddress (no street/city/state/zip splitter in this codebase).
  address_format_mismatch: [
    "petitioner mailing/physical address (Pt1Line8_*, Pt1Line9_*)", "beneficiary addresses (Pt2Line11_*, Pt2Line44_*, Pt2Line45_*, Pt2Line47_*)",
  ],
  // Deliberately out of scope for this pass - see file header SCOPE note.
  repeating_groups_not_yet_mapped_v1: [
    "residential history (Pt1Line9-12, Pt2Line11-15)", "employment history (Pt1Line13-19, Pt2Line16-23)",
    "parents (not present as distinct I-129F fields beyond what's captured elsewhere)",
    "prior spouses (Pt1Line38-40, Pt2Line35-37)", "beneficiary's children (Pt2Line49-50 family name/address only; no full repeating table on this form)",
    "beneficiary US immigration history (Pt2Line38-43)",
  ],
};

function classifyField(field) {
  const fieldName = field.fieldName || field.pdfFieldName || field.fieldId;
  if (USCIS_USE_ONLY_PATTERNS.some((pattern) => pattern.test(fieldName))) {
    return { status: "uscis_use_only", note: "USCIS-internal barcode/processing field." };
  }
  const mappedEdge = MAPPED_EDGES.find((edge) => edge.fieldName === fieldName);
  if (mappedEdge) return { status: "mapped", edge: mappedEdge };
  return {
    status: "manual_entry",
    note: "Not yet individually reviewed in this v1 K-1 crosswalk pass (address blocks and repeating history groups - see MANUAL_ENTRY_REASONS in this file). Case manager completes at review.",
  };
}

module.exports = { FORM_CODE, VERSION, USCIS_USE_ONLY_PATTERNS, MAPPED_EDGES, MANUAL_ENTRY_REASONS, classifyField };
