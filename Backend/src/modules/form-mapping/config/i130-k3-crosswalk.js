// Canonical -> I-130 (K-3 spouse petition) field crosswalk, mirroring
// i129f-k1-crosswalk.js's shape/scope/conventions, authored against the real
// bundled I-130 PDF (Backend/dev-assets/uscis/i-130_2024-04-01.pdf - field
// names and checkbox onValues extracted empirically via pdf-lib).
//
// k3.js reuses k1.js's fieldCatalog() directly (see k3.js's own header
// comment - the Q&A content is field-for-field identical), so every source
// key below is IDENTICAL to i129f-k1-crosswalk.js's (petitioner_info_*,
// beneficiary_info_*, etc.) even though the target form and its field names
// are completely different (I-130 vs I-129F). On I-130, "Part 2" is
// "Information About You" (the PETITIONER) and "Part 4" is "Information
// About Beneficiary" - not "Part 2 = beneficiary" as the part NUMBER alone
// might suggest; confirmed by cross-referencing which fields (SSN, A-Number,
// USCIS Online Account Number vs its absence) match k1.js's own
// petitioner-vs-beneficiary field asymmetry (only the petitioner side has a
// USCIS Online Account Number field, matching Pt2Line2 existing but no
// beneficiary-side equivalent on Pt4).
//
// SCOPE (v1, deliberate): same as i129f-k1-crosswalk.js - identity/
// biographical fields for both parties, real verified widget names/onValues.
// Addresses (one combined free-text field in k1.js, format-mismatch class),
// repeating history groups (residential/employment history, parents, prior
// spouses, children), and I-130's own relationship-type/immigration-history
// blocks are explicitly NOT mapped in this pass - see MANUAL_ENTRY_REASONS.
const FORM_CODE = "I-130";
const VERSION = "2024-04-01";

const USCIS_USE_ONLY_PATTERNS = [/PDF417BarCode/];

function checkboxMatch(source, value) {
  return { condition: { field: source, operator: "equals", value }, transform: { type: "boolean" } };
}

// Verified via pdf-lib's widget.getOnValue() against the real PDF.
const PETITIONER_MARITAL_STATUS_VALUE = { widowed: "Widowed", divorced: "Divorced", single: "Single", married: "Married" };
const BENEFICIARY_MARITAL_STATUS_INDEX = { widowed: 0, single: 2, married: 4, divorced: 5 }; // onValues /W /S /M /D (indices 1=/A Annulled, 3=/SNM have no k1.js-equivalent option and are intentionally omitted)

const MAPPED_EDGES = [
  // --- Part 1: Relationship - every K-3 case is, by definition, a spousal
  // petition (this platform's k3.js has no "relationship type" question of
  // its own to source from, since K-3 only ever means spouse). ---
  { fieldName: "form1[0].#subform[0].Pt1Line1_Spouse[0]", source: "case.visaType", ...checkboxMatch("case.visaType", "K-3"), note: "Item 1, relationship - Spouse widget. K-3 is inherently spousal; sourced from case.visaType the same way i129-h1b-crosswalk.js sources its classification-symbol edges." },

  // --- Part 2: Information About You (the PETITIONER) ---
  { fieldName: "form1[0].#subform[0].Pt2Line4a_FamilyName[0]", source: "raw.questionnaireAnswers.petitioner_info_lastName.value", note: "Petitioner family name." },
  { fieldName: "form1[0].#subform[0].Pt2Line4b_GivenName[0]", source: "raw.questionnaireAnswers.petitioner_info_firstName.value", note: "Petitioner given name." },
  { fieldName: "form1[0].#subform[0].Pt2Line4c_MiddleName[0]", source: "raw.questionnaireAnswers.petitioner_info_middleName.value", note: "Petitioner middle name." },
  { fieldName: "form1[0].#subform[0].#area[4].Pt2Line1_AlienNumber[0]", source: "raw.questionnaireAnswers.petitioner_info_aNumber.value", note: "Petitioner A-Number." },
  { fieldName: "form1[0].#subform[0].#area[5].Pt2Line2_USCISOnlineActNumber[0]", source: "raw.questionnaireAnswers.petitioner_info_uscisOnlineAccountNumber.value", note: "Petitioner USCIS Online Account Number." },
  { fieldName: "form1[0].#subform[0].Pt2Line11_SSN[0]", source: "raw.questionnaireAnswers.petitioner_info_ssn.value", note: "Petitioner SSN." },
  { fieldName: "form1[0].#subform[1].Pt2Line6_CityTownOfBirth[0]", source: "raw.questionnaireAnswers.petitioner_info_cityTownOfBirth.value", note: "Petitioner city/town of birth." },
  { fieldName: "form1[0].#subform[1].Pt2Line7_CountryofBirth[0]", source: "raw.questionnaireAnswers.petitioner_info_countryOfBirth.value", note: "Petitioner country of birth." },
  { fieldName: "form1[0].#subform[1].Pt2Line8_DateofBirth[0]", source: "raw.questionnaireAnswers.petitioner_info_dateOfBirth.value", transform: { type: "date", format: "mm/dd/yyyy" }, note: "Petitioner date of birth." },
  { fieldName: "form1[0].#subform[1].Pt2Line9_Male[0]", source: "raw.questionnaireAnswers.petitioner_info_gender.value", ...checkboxMatch("raw.questionnaireAnswers.petitioner_info_gender.value", "Male"), note: "Petitioner sex - Male widget. onValue /Y verified via pdf-lib." },
  { fieldName: "form1[0].#subform[1].Pt2Line9_Female[0]", source: "raw.questionnaireAnswers.petitioner_info_gender.value", ...checkboxMatch("raw.questionnaireAnswers.petitioner_info_gender.value", "Female"), note: "Petitioner sex - Female widget." },
  ...Object.entries(PETITIONER_MARITAL_STATUS_VALUE).map(([status, onValueLabel]) => ({
    fieldName: `form1[0].#subform[1].Pt2Line17_${onValueLabel}[0]`,
    source: "raw.questionnaireAnswers.petitioner_info_maritalStatus.value",
    ...checkboxMatch("raw.questionnaireAnswers.petitioner_info_maritalStatus.value", status),
    note: `Petitioner marital status - ${onValueLabel} widget. Annulled/Separated widgets on this form have no k1.js-equivalent option and are intentionally left unmapped.`,
  })),
  { fieldName: "form1[0].#subform[2].Pt2Line37c_DateOfIssuance[0]", source: "raw.questionnaireAnswers.petitioner_citizenship_certificateDateOfIssuance.value", transform: { type: "date", format: "mm/dd/yyyy" }, note: "Certificate of Citizenship/Naturalization date of issuance." },
  { fieldName: "form1[0].#subform[2].Pt2Line37a_CertificateNumber[0]", source: "raw.questionnaireAnswers.petitioner_citizenship_certificateNumber.value", note: "Certificate number." },
  { fieldName: "form1[0].#subform[2].Pt2Line37b_PlaceOfIssuance[0]", source: "raw.questionnaireAnswers.petitioner_citizenship_certificatePlaceOfIssuance.value", note: "Certificate place of issuance." },

  // --- Part 4: Information About Beneficiary (pages 5-6) ---
  { fieldName: "form1[0].#subform[4].Pt4Line4a_FamilyName[0]", source: "raw.questionnaireAnswers.beneficiary_info_lastName.value", note: "Beneficiary family name." },
  { fieldName: "form1[0].#subform[4].Pt4Line4b_GivenName[0]", source: "raw.questionnaireAnswers.beneficiary_info_firstName.value", note: "Beneficiary given name." },
  { fieldName: "form1[0].#subform[4].Pt4Line4c_MiddleName[0]", source: "raw.questionnaireAnswers.beneficiary_info_middleName.value", note: "Beneficiary middle name." },
  { fieldName: "form1[0].#subform[4].#area[6].Pt4Line1_AlienNumber[0]", source: "raw.questionnaireAnswers.beneficiary_info_aNumber.value", note: "Beneficiary A-Number." },
  { fieldName: "form1[0].#subform[4].Pt4Line3_SSN[0]", source: "raw.questionnaireAnswers.beneficiary_info_ssn.value", note: "Beneficiary SSN." },
  { fieldName: "form1[0].#subform[4].Pt4Line7_CityTownOfBirth[0]", source: "raw.questionnaireAnswers.beneficiary_info_cityTownOfBirth.value", note: "Beneficiary city/town of birth." },
  { fieldName: "form1[0].#subform[4].Pt4Line8_CountryOfBirth[0]", source: "raw.questionnaireAnswers.beneficiary_info_countryOfBirth.value", note: "Beneficiary country of birth." },
  { fieldName: "form1[0].#subform[4].Pt4Line9_DateOfBirth[0]", source: "raw.questionnaireAnswers.beneficiary_info_dateOfBirth.value", transform: { type: "date", format: "mm/dd/yyyy" }, note: "Beneficiary date of birth." },
  { fieldName: "form1[0].#subform[4].Pt4Line9_Male[0]", source: "raw.questionnaireAnswers.beneficiary_info_gender.value", ...checkboxMatch("raw.questionnaireAnswers.beneficiary_info_gender.value", "Male"), note: "Beneficiary sex - Male widget. onValue /Y verified via pdf-lib." },
  { fieldName: "form1[0].#subform[4].Pt4Line9_Female[0]", source: "raw.questionnaireAnswers.beneficiary_info_gender.value", ...checkboxMatch("raw.questionnaireAnswers.beneficiary_info_gender.value", "Female"), note: "Beneficiary sex - Female widget." },
  ...Object.entries(BENEFICIARY_MARITAL_STATUS_INDEX).map(([status, index]) => ({
    fieldName: `form1[0].#subform[5].Pt4Line18_MaritalStatus[${index}]`,
    source: "raw.questionnaireAnswers.beneficiary_info_maritalStatus.value",
    ...checkboxMatch("raw.questionnaireAnswers.beneficiary_info_maritalStatus.value", status),
    note: `Beneficiary marital status - ${status} widget (onValue verified via pdf-lib, index ${index}). Annulled (index 1, /A) and Separated (index 3, /SNM) have no k1.js-equivalent option and are intentionally left unmapped.`,
  })),
];

const MANUAL_ENTRY_REASONS = {
  address_format_mismatch: [
    "petitioner mailing/physical address (Pt2Line10_*, Pt2Line12_*, Pt2Line14_*)", "beneficiary addresses (Pt4Line11_*, Pt4Line12_*, Pt4Line13_*, Pt4Line45_*)",
  ],
  repeating_groups_not_yet_mapped_v1: [
    "residential history (Pt2Line10-15, Pt4Line11-15)", "employment history (Pt2Line40-47, Pt4Line40-47)",
    "prior spouses (Pt2Line20-24, Pt4Line16-17)", "beneficiary's children (Pt4Line30-41 relationship/DOB/country blocks)",
    "petitioner biographic details (Pt3 - ethnicity/race/height/weight/eye+hair color) - no k1.js source field at all",
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
    note: "Not yet individually reviewed in this v1 K-3 crosswalk pass (address blocks, repeating history groups, and petitioner biographic details - see MANUAL_ENTRY_REASONS in this file). Case manager completes at review.",
  };
}

module.exports = { FORM_CODE, VERSION, USCIS_USE_ONLY_PATTERNS, MAPPED_EDGES, MANUAL_ENTRY_REASONS, classifyField };
