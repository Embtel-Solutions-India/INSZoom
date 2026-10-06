// Form I-907 (Request for Premium Processing Service) crosswalk: Form I-907 Information
// Checklist answers -> I-907 PDF fields.
//
// WHY THIS EXISTS: the I-907 mapping graph that used to be active was auto-guessed from field
// labels (e.g. every petitioner / beneficiary / point-of-contact name field read company.name).
// This replaces it with an authored, reviewed mapping. The client's answers are the single source:
// every edge reads raw.questionnaireAnswers.<question key>.value, where the keys are exactly the
// question keys of premiumProcessingChecklist.js (a unit test asserts every source key exists
// there, so the two cannot drift). See i129-h1b-crosswalk.js for the rationale behind
// checkboxMatch() and classifyField()'s bucket contract.
//
// TARGET FIELDS: the 140 fields of the active I-907 template (edition 2024-04-01, the PDF imported
// by uscis-form-import/seeds/i907.seed.js) - fieldName values were read from that template's
// formFields, none guessed.
//
// DELIBERATELY NOT MAPPED (left manual_entry, never guessed):
//   - Middle names (Part 1 item 3, Part 2 items 4-6): the checklist does not collect them.
//   - "In care of" name, and every Apt/Ste/Flr TYPE checkbox: the checklist collects one free-text
//     "Apt/Ste/Flr" value, from which the unit type cannot be told.
//   - Part 1 item 8 (applicant vs petitioner): a legal determination made by the case manager.
//   - Requestor phone/email (Part 3), interpreter (Part 4), preparer (Part 5), signatures,
//     G-28 block, Part 9 additional information: not client checklist data.

const SAME = "raw.questionnaireAnswers.i907_address_same_as_physical.value";
const answer = (key) => `raw.questionnaireAnswers.${key}.value`;

function checkboxMatch(source, value) {
  return { condition: { field: source, operator: "equals", value }, transform: { type: "boolean" } };
}
// Physical-address widgets are only written when the answer to "same as mailing?" is No.
const WHEN_PHYSICAL_DIFFERS = { condition: { field: SAME, operator: "equals", value: "No" } };

const P1 = "form1[0].#subform[0].";
const P2 = "form1[0].#subform[1].";
const P7 = "form1[0].#subform[6].";

const text = (fieldName, key, note, extra = {}) => ({ fieldName, source: answer(key), sourceVerified: true, note, ...extra });
const digitsOnly = { transform: { type: "digits" } };

const MAPPED_EDGES = [
  // --- Part 1: Information About the Person Filing This Request (page 1) ---
  text(`${P1}#area[0].Pt1Line1_AlienRegistrationNumber[0]`, "i907_filer_alien_registration_number", "Item 1, A-Number. The widget has a pre-printed 'A-', so digits only.", digitsOnly),
  text(`${P1}#area[1].Pt1Line2_USCISOnlineActNumber[0]`, "i907_filer_uscis_online_account_number", "Item 2, USCIS Online Account Number (12 digits).", digitsOnly),
  text(`${P1}Pt1Line3_FamilyName[0]`, "i907_filer_last_name", "Item 3, family name."),
  text(`${P1}Pt1Line3_GivenName[0]`, "i907_filer_first_name", "Item 3, given name."),
  text(`${P1}Part1_Line4_CompanyorOrganizationName[0]`, "i907_related_case_company_name", "Item 4, company or organization named in the related case."),
  // Item 5, mailing address.
  text(`${P1}Part1_Line5_MailingAddress_StreetNumberName[0]`, "i907_mailing_address_street", "Item 5, street number and name."),
  text(`${P1}Part1_Line5_MailingAddress_AptSteFlrNumber[0]`, "i907_mailing_address_unit", "Item 5, apartment / suite / floor number (the unit-type checkbox stays manual)."),
  text(`${P1}Part1_Line5_MailingAddress_CityTown[0]`, "i907_mailing_address_city", "Item 5, city or town."),
  text(`${P1}Part1_Line5_MailingAddress_State[0]`, "i907_mailing_address_state", "Item 5, state (2-letter abbreviation, the dropdown's own values)."),
  text(`${P1}Part1_Line5_MailingAddress_ZipCode[0]`, "i907_mailing_address_zip_code", "Item 5, ZIP code."),
  text(`${P1}Part1_Line5_MailingAddress_Province[0]`, "i907_mailing_address_province", "Item 5, province."),
  text(`${P1}Part1_Line5_MailingAddress_PostalCode[0]`, "i907_mailing_address_postal_code", "Item 5, postal code."),
  text(`${P1}Part1_Line5_MailingAddress_Country[0]`, "i907_mailing_address_country", "Item 5, country."),
  // Item 6, mailing address same as physical address? Two checkboxes: [0] Yes, [1] No.
  { fieldName: `${P1}Part1Line6_Checkbox[0]`, source: SAME, ...checkboxMatch(SAME, "Yes"), sourceVerified: true, note: "Item 6, 'Yes' checkbox." },
  { fieldName: `${P1}Part1Line6_Checkbox[1]`, source: SAME, ...checkboxMatch(SAME, "No"), sourceVerified: true, note: "Item 6, 'No' checkbox." },

  // --- Item 7, physical address (page 2) - only when it differs from the mailing address ---
  text(`${P2}Part1_Line7_PhysicalAddress_StreetNumberName[0]`, "i907_physical_address_street", "Item 7, street number and name.", WHEN_PHYSICAL_DIFFERS),
  text(`${P2}Part1_Line7_PhysicalAddress_AptSteFlrNumber[0]`, "i907_physical_address_unit", "Item 7, apartment / suite / floor number.", WHEN_PHYSICAL_DIFFERS),
  text(`${P2}Part1_Line7_PhysicalAddress_CityTown[0]`, "i907_physical_address_city", "Item 7, city or town.", WHEN_PHYSICAL_DIFFERS),
  text(`${P2}Part1_Line7_PhysicalAddress_State[0]`, "i907_physical_address_state", "Item 7, state.", WHEN_PHYSICAL_DIFFERS),
  text(`${P2}Part1_Line7_PhysicalAddress_ZipCode[0]`, "i907_physical_address_zip_code", "Item 7, ZIP code.", WHEN_PHYSICAL_DIFFERS),
  text(`${P2}Part1_Line7_PhysicalAddress_Province[0]`, "i907_physical_address_province", "Item 7, province.", WHEN_PHYSICAL_DIFFERS),
  text(`${P2}Part1_Line7_PhysicalAddress_PostalCode[0]`, "i907_physical_address_postal_code", "Item 7, postal code.", WHEN_PHYSICAL_DIFFERS),
  text(`${P2}Part1_Line7_PhysicalAddress_Country[0]`, "i907_physical_address_country", "Item 7, country.", WHEN_PHYSICAL_DIFFERS),

  // --- Part 2: Information About the Request (page 2) ---
  text(`${P2}P2_Line1_FormNumberof[0]`, "i907_related_case_form_number", "Item 1, form number of the related petition or application."),
  text(`${P2}P2_Line2_ReceiptNumberof[0]`, "i907_related_case_receipt_number", "Item 2, receipt number of the related petition or application."),
  text(`${P2}Part2_Line4_PetitionerApplicantFamilyName[0]`, "i907_petitioner_last_name", "Item 4, petitioner/applicant family name."),
  text(`${P2}Part2_Line4_PetitionerApplicantGivenName[0]`, "i907_petitioner_first_name", "Item 4, petitioner/applicant given name."),
  text(`${P2}Line_FamilyName[0]`, "i907_beneficiary_last_name", "Item 5, beneficiary family name."),
  text(`${P2}Line_GivenName[0]`, "i907_beneficiary_first_name", "Item 5, beneficiary given name."),
  text(`${P2}Part1_Line8_NameOfCompanyPOC_FamilyName[0]`, "i907_company_poc_last_name", "Item 6, point of contact family name."),
  text(`${P2}Part1_Line8_NameOfCompanyPOC_GivenName[0]`, "i907_company_poc_first_name", "Item 6, point of contact given name."),
  text(`${P2}Part1_Line8_NameOfCompanyPOC_TitleofPOC[0]`, "i907_company_poc_position_title", "Item 6, point of contact position title."),
  text(`${P2}Part1_Line9_CompanyIRSTaxNumber[0]`, "i907_company_ein", "Item 7, company EIN (the widget is numeric - digits only).", digitsOnly),

  // Part 2 item 3, classification requested: the case's own visa type - right for a case that has
  // been upgraded (H-1B, O-1A ...), meaningless on a standalone Premium Processing case, so skipped there.
  { fieldName: `${P2}P2_Line2_ClassorEligRequested[0]`, source: "case.visaType", sourceVerified: true, condition: { field: "case.visaType", operator: "not_equals", value: "Premium Processing" }, note: "Item 3, classification or eligibility requested = the related case's visa type (not for a standalone Premium Processing case)." },

  // --- Part 9 continuation sheet header (page 7): repeated identity fields ---
  text(`${P7}Pt1Line3_FamilyName[1]`, "i907_filer_last_name", "Continuation sheet header, family name (repeat)."),
  text(`${P7}Pt1Line3_GivenName[1]`, "i907_filer_first_name", "Continuation sheet header, given name (repeat)."),
  text(`${P7}Line3_ANumber[0].Pt1Line1_AlienRegistrationNumber[1]`, "i907_filer_alien_registration_number", "Continuation sheet header, A-Number (repeat).", digitsOnly),
];

const MANUAL_ENTRY_FIELDS = {
  no_checklist_source: [
    "form1[0].#subform[0].Pt1Line3_MiddleName[0]", "form1[0].#subform[1].Part2_Line4_PetitionerApplicantMiddleName[0]",
    "form1[0].#subform[1].Line_MiddleName[0]", "form1[0].#subform[1].Part1_Line8_NameOfCompanyPOC_MiddleName[0]",
    "form1[0].#subform[6].Pt1Line3_MiddleName[1]", "form1[0].#subform[0].Part1_Line5_MailingAddress_InCareofName[0]",
  ],
  legal_determination: [
    "form1[0].#subform[1].Part1_Line8_CheckBox[0]", "form1[0].#subform[1].Part1_Line8_CheckBox[1]",
    "form1[0].#subform[1].Part1_Line8_CheckBox[2]", "form1[0].#subform[1].Part1_Line8_CheckBox[3]",
  ],
  signature: [
    "form1[0].#subform[3].Pt5Line3_SignatureOfPetitioner[0]", "form1[0].#subform[3].P3_DateofSignature[0]",
    "form1[0].#subform[4].P4_Line6_Signature[0]", "form1[0].#subform[4].P4_Line6_DateofSignature[0]",
    "form1[0].#subform[5].P5_Line8_Signature[0]", "form1[0].#subform[5].P5_Line8_DateofSignature[0]",
  ],
};

const USCIS_USE_ONLY_PATTERNS = [/PDF417BarCode/];
const MANUAL_ENTRY_SET = new Set(Object.values(MANUAL_ENTRY_FIELDS).flat());
const MAPPED_BY_FIELD_NAME = new Map(MAPPED_EDGES.map((edge) => [edge.fieldName, edge]));

// Keyed by the RAW AcroForm field name (see i129-h1b-crosswalk.js for why).
function classifyField(field) {
  const fieldName = field.fieldName || field.pdfFieldName || field.fieldId;
  if (USCIS_USE_ONLY_PATTERNS.some((pattern) => pattern.test(fieldName))) {
    return { status: "uscis_use_only", note: "USCIS-internal barcode field." };
  }
  const mapped = MAPPED_BY_FIELD_NAME.get(fieldName);
  if (mapped) return { status: "mapped", edge: mapped };
  if (MANUAL_ENTRY_SET.has(fieldName)) return { status: "manual_entry", note: "See MANUAL_ENTRY_FIELDS for the reason." };
  return { status: "manual_entry", note: "Not client checklist data (interpreter / preparer / requestor contact / additional information) - completed at review." };
}

module.exports = { MAPPED_EDGES, MANUAL_ENTRY_FIELDS, USCIS_USE_ONLY_PATTERNS, classifyField };
