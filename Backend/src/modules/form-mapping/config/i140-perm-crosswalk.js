// Form I-140 (Immigrant Petition for Alien Workers) crosswalk for the PERM workflow:
// CANONICAL profile -> I-140 PDF fields.
//
// DATA FLOW: PERM employer checklist + PERM employee checklist -> canonical profile
// (company.* from the employer profile, person.* / contact.* / immigration.* from the employee
// profile; see canonical/config/profileCanonicalMap.js and permChecklists.js `mapping.canonicalPath`)
// -> this graph -> CaseForm. Every edge reads a CANONICAL path (never a raw PERM answer), so any case
// sharing the same canonical profile is served by the same graph.
//
// TARGET: the active I-140 USCISFormTemplate (formCode "I-140", version 2024-07-06, 262 fields).
// fieldName / page / item values below were read from that template's formFields, none guessed.
// NOTE: every field in that template has required:false (the import did not capture the PDF's
// "required" semantics), so REQUIRED_MISSING_SOURCE below is an authored judgement of which I-140
// fields a filing cannot omit.
//
// ACTIVATION CONSTRAINT: MappingGraphService.validateGraph() only lets a graph activate when it has
// zero non-"active" edges and an EMPTY graph.unmappedTargets. So (a) no edge here is "review_required"
// - anything that would need that stays manual instead - and (b) the MISSING_SOURCE list is published
// on graph.missingSourceTargets (same entry shape unmappedTargets would carry) rather than
// graph.unmappedTargets.
//
// DELIBERATELY NOT MAPPED (left manual, never guessed):
//   - Part 1 item 1 individual-petitioner name and Part 7 authorized signatory (name/title/phone/email):
//     the PERM "contact person" is whoever receives DOL correspondence, not necessarily the signatory
//     (a legal determination), and company.contact.name is one string that cannot be split safely.
//   - Website (no I-140 field), employer fax/county/state-ID (no I-140 field).
//   - Passport / travel document / date of arrival / city of birth / SSN: no PERM question collects them.
//   - Foreign postal code, unit-type checkboxes, in-care-of names, native-alphabet name/address,
//     the Part 7 spouse/children block.
//   - Employment history, education: the I-140 form has no field for them.

const FORM_CODE = "I-140";
const P1 = "form1[0].#subform[0].";
const P2 = "form1[0].#subform[1].";
const P3 = "form1[0].#subform[2].";
const P4 = "form1[0].#subform[3].";
const P6 = "form1[0].#subform[5].";
const P8 = "form1[0].#subform[7].";

const CONF = { HIGH: 95, MEDIUM: 70 };
const digitsOnly = { transform: { type: "digits" } };
const dateTx = { transform: { type: "date", format: "mm/dd/yyyy" } };
const countryTx = { transform: { type: "country" } };
const usState = (countryPath) => ({ transform: { type: "usState", countryPath } });
const province = (countryPath) => ({ transform: { type: "nonUsProvince", countryPath } });

function edge(pdfFieldName, canonicalPath, checklistField, formSection, item, formPage, dataType, confidenceLevel, note, extra = {}) {
  return {
    formCode: FORM_CODE,
    fieldName: pdfFieldName,
    pdfFieldName,
    source: canonicalPath,
    canonicalPath,
    checklistField,
    sourceChecklist: checklistField.startsWith("employer_") ? "perm_employer_information" : "perm_employee_information",
    formSection,
    formItem: item,
    formPage,
    dataType,
    required: true,
    confidenceLevel,
    confidence: CONF[confidenceLevel],
    status: "active",
    sourceVerified: true,
    sourceLabel: "PERM checklist",
    note: `${item}. ${note}`,
    ...extra,
  };
}

const COMPANY_COUNTRY = "company.address.country";
const PERSON_COUNTRY = "contact.address.country";

const MAPPED_EDGES = [
  // ---- Part 1: Information About the Person Filing This Petition (petitioner = the PERM employer) ----
  edge(`${P1}Line2_CompanyName[0]`, "company.name", "employer_company_name", "Part 1", "Item 2 (Company or Organization Name)", 1, "text", "HIGH", "Employer legal name (max 34 chars on the widget)."),
  edge(`${P1}Pt1Line3_TaxNumber[0]`, "company.ein", "employer_ein", "Part 1", "Item 4 (IRS Tax Number)", 1, "number", "HIGH", "EIN, digits only (widget is numeric, 9 digits, no dashes).", digitsOnly),
  edge(`${P1}Line6b_StreetNumberName[0]`, "company.address.line1", "employer_address", "Part 1", "Item 3 (Mailing Address, street)", 1, "text", "MEDIUM", "PERM employer_address is one free-text answer; company.address.* is filled from the employer profile, not by the PERM checklist itself. The template types this widget 'number' (label-derived) - it is a text street field."),
  edge(`${P1}Line6d_CityOrTown[0]`, "company.address.city", "employer_address", "Part 1", "Item 3 (Mailing Address, city)", 1, "text", "MEDIUM", "See street edge."),
  edge(`${P1}Line6e_State[0]`, "company.address.state", "employer_address", "Part 1", "Item 3 (Mailing Address, state)", 1, "dropdown", "MEDIUM", "US state dropdown; foreign states are dropped by the usState transform.", usState(COMPANY_COUNTRY)),
  edge(`${P1}Line6f_ZipCode[0]`, "company.address.zip", "employer_address", "Part 1", "Item 3 (Mailing Address, ZIP)", 1, "text", "MEDIUM", "Widget max length 5 - a ZIP+4 overflows and is dropped by the fitter."),
  edge(`${P1}Line6i_Country[0]`, "company.address.country", "employer_address", "Part 1", "Item 3 (Mailing Address, country)", 1, "text", "MEDIUM", "See street edge.", countryTx),
  // Part 5 (Additional Information About the Petitioner)
  edge(`${P3}Line2c_NumberofEmployees[0]`, "company.numberOfEmployees", "employer_total_employees", "Part 5", "Item 4 (Number of employees)", 3, "number", "HIGH", "Total number of employees."),

  // ---- Part 3: Information About the Person for Whom You Are Filing (the PERM beneficiary) ----
  edge(`${P2}Pt3Line1a_FamilyName[0]`, "person.lastName", "employee_last_name", "Part 3", "Item 1 (Family Name)", 2, "text", "HIGH", "Beneficiary family name."),
  edge(`${P2}Pt3Line1b_GivenName[0]`, "person.firstName", "employee_first_name", "Part 3", "Item 1 (Given Name)", 2, "text", "HIGH", "Beneficiary given name."),
  edge(`${P2}Pt3Line1c_MiddleName[0]`, "person.middleName", "employee_middle_name", "Part 3", "Item 1 (Middle Name)", 2, "text", "HIGH", "Beneficiary middle name.", { required: false }),
  edge(`${P2}Line2b_StreetNumberName[0]`, "contact.address.line1", "employee_address", "Part 3", "Item 2 (Mailing Address, street)", 2, "text", "MEDIUM", "PERM collects the CURRENT RESIDENCE address; the I-140 asks for the mailing address, usually but not always the same. The template types this widget 'number' (label-derived) - it is a text street field."),
  edge(`${P2}Line2d_CityOrTown[0]`, "contact.address.city", "employee_city", "Part 3", "Item 2 (Mailing Address, city)", 2, "text", "MEDIUM", "See street edge."),
  edge(`${P2}Line2e_State[0]`, "contact.address.state", "employee_state", "Part 3", "Item 2 (Mailing Address, state)", 2, "dropdown", "MEDIUM", "US state dropdown; only for a US-country address.", usState(PERSON_COUNTRY)),
  edge(`${P2}Line2h_Province[0]`, "contact.address.state", "employee_state", "Part 3", "Item 2 (Mailing Address, province)", 2, "text", "MEDIUM", "Foreign province; only for a non-US address.", province(PERSON_COUNTRY)),
  edge(`${P2}Line2f_ZipCode[0]`, "contact.address.zip", "employee_zip_code", "Part 3", "Item 2 (Mailing Address, ZIP)", 2, "text", "MEDIUM", "Widget max length 5 - a ZIP+4 overflows and is dropped by the fitter."),
  edge(`${P2}Line2i_Country[0]`, "contact.address.country", "employee_country", "Part 3", "Item 2 (Mailing Address, country)", 2, "text", "MEDIUM", "See street edge.", countryTx),
  edge(`${P2}Line5_DateOfBirth[0]`, "person.dob", "employee_date_of_birth", "Part 3", "Item 3 (Date of Birth)", 2, "date", "HIGH", "mm/dd/yyyy.", dateTx),
  edge(`${P2}Line8_Country[0]`, "person.countryOfBirth", "employee_birth_country", "Part 3", "Item 6 (Country of Birth)", 2, "text", "HIGH", "Country of birth.", countryTx),
  edge(`${P2}Line9_Country[0]`, "person.citizenship", "employee_citizenship_country", "Part 3", "Item 7 (Country of Citizenship or Nationality)", 2, "text", "HIGH", "Country of citizenship.", countryTx),
  edge(`${P2}Line11_Alien[0].Pt3Line8_AlienNumber[0]`, "person.alienNumber", "employee_alien_registration_number", "Part 3", "Item 8 (A-Number)", 2, "text", "HIGH", "Digits only: widget max length 9 and the 'A-' is pre-printed.", { ...digitsOnly, required: false }),
  edge(`${P2}Line14_I94Number[0].Line14a_ArrivalDeparture[0]`, "immigration.i94.number", "employee_i94_number", "Part 3", "Item 11 (Form I-94 Arrival-Departure Record Number)", 2, "number", "HIGH", "11 digits, widget is numeric.", { ...digitsOnly, required: false }),
  edge(`${P2}Line15_CurrentNon[0]`, "immigration.currentStatus", "employee_current_us_status", "Part 3", "Item 11 (Current Nonimmigrant Status)", 2, "text", "MEDIUM", "PERM asks for the current US status; the widget asks for the status on Form I-94 (class of admission), usually but not always identical.", { required: false }),

  // Page 8 continuation sheet (Part 9) repeats the petitioner IRS tax number ("pre-populated from Page 1").
  edge(`${P8}#area[6].Pt1Line3_TaxNumber[1]`, "company.ein", "employer_ein", "Part 1", "Item 4 (IRS Tax Number, continuation sheet repeat)", 8, "number", "HIGH", "Repeat of page 1 item 4, digits only.", { ...digitsOnly, required: false }),
];

// REQUIRED I-140 fields with no source in the PERM checklists / the canonical data they populate.
// Published as graph.missingSourceTargets (reason MISSING_SOURCE, confidenceLevel UNMAPPED).
const REQUIRED_MISSING_SOURCE = [
  // Part 2 classification (choose one)
  ...[0, 1, 2, 3, 4].map((i) => [`${P1}prt2PetitionType[${i}]`, "Part 2", "Item 1 (Petition type / classification checkbox)"]),
  ...[5, 6, 7].map((i) => [`${P2}prt2PetitionType[${i}]`, "Part 2", "Item 1 (Petition type / classification checkbox)"]),
  // Part 3 beneficiary
  [`${P2}Line6_CityTownOfBirth[0]`, "Part 3", "Item 4 (City of Birth)"],
  [`${P2}Line7_StateProvinceOfBirth[0]`, "Part 3", "Item 5 (State or Province of Birth)"],
  [`${P2}Line13_DateOArrival[0]`, "Part 3", "Item 10 (Date of Last Arrival)"],
  [`${P2}Line14b_Passport[0]`, "Part 3", "Item 12 (Passport Number)"],
  [`${P2}Line14d_CountryOfIssuance[0]`, "Part 3", "Item 14 (Country of Issuance for Passport)"],
  [`${P2}Line14e_ExpDate[0]`, "Part 3", "Item 15 (Passport expiration date)"],
  // Part 4 processing information
  [`${P2}Line1a_Visa[0]`, "Part 4", "Item 1 (Consulate / visa abroad checkbox)"],
  [`${P2}Line1b_Status[0]`, "Part 4", "Item 2 (Adjustment of status checkbox)"],
  // Part 5 petitioner information
  [`${P3}Line1a_Employer[0]`, "Part 5", "Item 1 (Type of petitioner: Employer)"],
  [`${P3}Line2a_TypeofBusiness[0]`, "Part 5", "Item 2 (Type of Business)"],
  [`${P3}Line2b_DateEstablished[0]`, "Part 5", "Item 3 (Date Established)"],
  [`${P3}Line2d_GrossAnnualIncome[0]`, "Part 5", "Item 5 (Gross Annual Income)"],
  [`${P3}Line2e_NetAnnualIncome[0]`, "Part 5", "Item 6 (Net Annual Income)"],
  [`${P3}Line2f[0].Line2f_NAICSCode[0]`, "Part 5", "Item 7 (NAICS Code)"],
  [`${P3}Line2g_LaborCertification[0]`, "Part 5", "Item 8 (Labor Certification DOL Case Number)"],
  [`${P4}Line2h_LaborCertification[0]`, "Part 5", "Item 9 (Labor certification date filed)"],
  [`${P4}Line2i_LaborCertificationDate[0]`, "Part 5", "Item 10 (Labor certification date)"],
  // Part 6 proposed employment
  [`${P4}Line1_JobTitle[0]`, "Part 6", "Item 1 (Job Title)"],
  [`${P4}Line2_SOCCode1[0]`, "Part 6", "Item 2 (SOC Code, first 2 digits)"],
  [`${P4}Line2_SOCCode2[0]`, "Part 6", "Item 2 (SOC Code, last 4 digits)"],
  [`${P4}Line3_JobDescription[0]`, "Part 6", "Item 3 (Nontechnical Job Description)"],
  [`${P4}Line5_Hours[0]`, "Part 6", "Item 5 (Hours Per Week)"],
  [`${P4}Line8_Wages[0]`, "Part 6", "Item 8 (Wages)"],
  [`${P4}Line8_Per[0]`, "Part 6", "Item 8 (Wages per)"],
  [`${P4}Line9a_StreetNumberName[0]`, "Part 6", "Item 9 (Address where beneficiary will work, street)"],
  [`${P4}Line9c_CityOrTown[0]`, "Part 6", "Item 9 (Work address, city)"],
  [`${P4}Line9d_State[0]`, "Part 6", "Item 9 (Work address, state)"],
  [`${P4}Line9e_ZipCode[0]`, "Part 6", "Item 9 (Work address, ZIP)"],
  // Part 7 authorized signatory
  [`${P6}Part7_Item3a_FamilyName[0]`, "Part 7", "Item 3 (Authorized Signatory Family Name)"],
  [`${P6}Part7_Item3b_GivenName[0]`, "Part 7", "Item 3 (Authorized Signatory Given Name)"],
  [`${P6}Part7_Item4_Title[0]`, "Part 7", "Item 4 (Authorized Signatory Title)"],
  [`${P6}Part7_Item5_DayPhone[0]`, "Part 7", "Item 5 (Authorized Signatory Daytime Telephone)"],
].map(([pdfFieldName, formSection, item]) => ({
  pdfFieldName,
  formCode: FORM_CODE,
  formSection,
  formItem: item,
  required: true,
  reason: "MISSING_SOURCE",
  confidenceLevel: "UNMAPPED",
  note: "Required I-140 field; neither the PERM checklists nor the canonical profile they populate supply it - case manager input needed.",
}));

const USCIS_USE_ONLY_PATTERNS = [/PDF417BarCode/];
const MAPPED_BY_FIELD_NAME = new Map(MAPPED_EDGES.map((e) => [e.fieldName, e]));
const MISSING_BY_FIELD_NAME = new Map(REQUIRED_MISSING_SOURCE.map((e) => [e.pdfFieldName, e]));

function classifyField(field) {
  const fieldName = field.fieldName || field.pdfFieldName || field.fieldId;
  if (USCIS_USE_ONLY_PATTERNS.some((p) => p.test(fieldName))) return { status: "uscis_use_only", note: "USCIS-internal barcode field." };
  const mapped = MAPPED_BY_FIELD_NAME.get(fieldName);
  if (mapped) return { status: "mapped", edge: mapped };
  const missing = MISSING_BY_FIELD_NAME.get(fieldName);
  if (missing) return { status: "manual_entry", missingSource: missing, note: "Required, MISSING_SOURCE." };
  return { status: "manual_entry", note: "No PERM/canonical source (see file header) - completed at review." };
}

module.exports = { FORM_CODE, MAPPED_EDGES, REQUIRED_MISSING_SOURCE, USCIS_USE_ONLY_PATTERNS, classifyField };
