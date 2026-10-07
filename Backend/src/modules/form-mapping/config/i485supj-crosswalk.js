// Form I-485 Supplement J (Confirmation of Bona Fide Job Offer or Request for Job Portability Under INA
// Section 204(j)) crosswalk: canonical profile -> I-485J PDF fields. Same shape/seed as i485-perm-crosswalk.js
// (see seeds/permCrosswalkSeed.js, which turns this into the active USCISMappingVersion graph).
//
// DATA SOURCE: every edge reads the CANONICAL profile (person.* / contact.* / company.* / employment.*; paths
// verified against canonical/config/profileCanonicalMap.js), never raw checklist answers, so the one graph serves
// every case type that carries the form (EB-1B/1C, EB-2 PERM, EB-3, F4).
//
// TARGET FIELDS: the active I-485J template, edition 2026-09-18 (139 fields, 8 pages); fieldName values were read
// from that template's formFields - none guessed.
//
// DELIBERATELY NOT MAPPED (left for the case manager, never guessed, no Yes/No box is ever defaulted):
//   - Part 1 / Part 7 Yes-No and basis checkboxes (portability vs. confirmation, full-time, same job, ...)
//   - SOC code (the PDF splits it into 2 + 4 digits; no split transform exists), job description, hours
//   - USCIS Online Account Number, receipt numbers, I-485 filing date (case-specific, not profile data)
//   - Signatures/dates, interpreter and preparer blocks, Part 10 additional-information sheet
//   - The Part 6 individual-employer block (items 13-17: the employer is a business/organization)

const FORM_CODE = "I-485J";
const SOURCE_LABEL = "Canonical profile";
const CONFIDENCE = { HIGH: 95, MEDIUM: 75, LOW: 35 };

const P = (subform) => `form1[0].#subform[${subform}].`;
const US_ONLY = { condition: { field: "contact.address.country", operator: "equals", value: "United States" } };
const EMPLOYER_US_ONLY = { condition: { field: "company.address.country", operator: "equals", value: "United States" } };
const DATE = { transform: { type: "date", format: "mm/dd/yyyy" } };
const DIGITS = { transform: { type: "digits" } };

function edge(spec) {
  const level = spec.confidenceLevel;
  return {
    formCode: FORM_CODE,
    source: spec.source,
    sourceVerified: true,
    sourceSystem: SOURCE_LABEL,
    sourceChecklist: "canonical_profile",
    ...spec,
    confidence: CONFIDENCE[level],
    status: level === "LOW" ? "review_required" : "active",
  };
}

const e = (fieldName, source, section, item, page, dataType, extra = {}) => edge({
  fieldName,
  source,
  formSection: section,
  formItem: item,
  formPage: page,
  dataType,
  required: false,
  confidenceLevel: "HIGH",
  note: `${section} ${item}.`,
  ...extra,
});

const MAPPED_EDGES = [
  // --- Part 2: Information About the Applicant (pages 1-2) ---
  e(`${P(0)}Pt2Line1_FamilyName[0]`, "person.lastName", "Part 2", "Item 1 Family Name", 1, "text", { required: true }),
  e(`${P(0)}Pt2Line1_GivenName[0]`, "person.firstName", "Part 2", "Item 1 Given Name", 1, "text", { required: true }),
  e(`${P(0)}Pt2Line1_MiddleName[0]`, "person.middleName", "Part 2", "Item 1 Middle Name", 1, "text"),
  e(`${P(8)}Pt2Line1_FamilyName[1]`, "person.lastName", "Additional Information", "Header Family Name (repeat)", 8, "text"),
  e(`${P(8)}Pt2Line1_GivenName[1]`, "person.firstName", "Additional Information", "Header Given Name (repeat)", 8, "text"),
  e(`${P(8)}Pt2Line1_MiddleName[1]`, "person.middleName", "Additional Information", "Header Middle Name (repeat)", 8, "text"),
  e(`${P(0)}Part2_Line3_AlienNumber[0]`, "person.alienNumber", "Part 2", "Item 3 A-Number", 1, "alienNumber", { ...DIGITS, note: "Part 2 Item 3, A-Number. The widget pre-prints 'A-', so digits only." }),
  e(`${P(8)}Part2_Line3_AlienNumber[1]`, "person.alienNumber", "Additional Information", "A-Number (repeat)", 8, "alienNumber", DIGITS),
  e(`${P(1)}Part2_Line5_DateOfBirth[0]`, "person.dob", "Part 2", "Item 5 Date of Birth", 2, "date", { required: true, ...DATE }),
  e(`${P(1)}Part2_Line6_CountryofBirth[0]`, "person.countryOfBirth", "Part 2", "Item 6 Country of Birth", 2, "text", { required: true, transform: { type: "country" } }),

  // --- Part 2 Item 2: applicant's current mailing address (page 1; US block only for a US address) ---
  e(`${P(0)}Part2_Line2_StreetName[0]`, "contact.address.line1", "Part 2", "Item 2 Street Number and Name", 1, "text", { required: true, confidenceLevel: "MEDIUM", ...US_ONLY }),
  e(`${P(0)}Part2_Line2_City[0]`, "contact.address.city", "Part 2", "Item 2 City or Town", 1, "text", { required: true, confidenceLevel: "MEDIUM", ...US_ONLY }),
  e(`${P(0)}Part2_Line2_State[0]`, "contact.address.state", "Part 2", "Item 2 State", 1, "dropdown", { required: true, confidenceLevel: "MEDIUM", transform: { type: "usState", countryPath: "contact.address.country" }, ...US_ONLY }),
  e(`${P(0)}Part2_Line2_ZipCode[0]`, "contact.address.zip", "Part 2", "Item 2 ZIP Code", 1, "text", { required: true, confidenceLevel: "MEDIUM", ...US_ONLY }),

  // --- Part 3: Applicant's contact information (page 2) ---
  e(`${P(1)}Part3_Line1_DaytimePhoneNumber[0]`, "contact.phone", "Part 3", "Item 1 Daytime Telephone Number", 2, "phone", { confidenceLevel: "MEDIUM", transform: { type: "phone" } }),
  e(`${P(1)}Part3_Line2_MobileNumber[0]`, "contact.phone", "Part 3", "Item 2 Mobile Telephone Number", 2, "phone", { confidenceLevel: "MEDIUM", transform: { type: "phone" } }),
  e(`${P(1)}Part3_Line3_EmailAddress[0]`, "contact.email", "Part 3", "Item 3 Email Address", 2, "email"),

  // --- Part 6: The employer / offering organization (page 4) ---
  e(`${P(3)}Part6_Line4_TypeofBusiness[0]`, "company.name", "Part 6", "Item 4 Business or Organization Name", 4, "text", { required: true }),
  e(`${P(3)}Part6_Line5_EmployerIdentificatioNumber[0]`, "company.ein", "Part 6", "Item 5 Employer Identification Number", 4, "text", { required: true, ...DIGITS }),
  e(`${P(3)}Part6_Line3_StreetName[0]`, "company.address.line1", "Part 6", "Item 3 Street Number and Name", 4, "text", { required: true, ...EMPLOYER_US_ONLY }),
  e(`${P(3)}Part6_Line3_City[0]`, "company.address.city", "Part 6", "Item 3 City or Town", 4, "text", { required: true, ...EMPLOYER_US_ONLY }),
  e(`${P(3)}Part6_Line3_State[0]`, "company.address.state", "Part 6", "Item 3 State", 4, "dropdown", { required: true, transform: { type: "usState", countryPath: "company.address.country" }, ...EMPLOYER_US_ONLY }),
  e(`${P(3)}Part6_Line3_ZipCode[0]`, "company.address.zip", "Part 6", "Item 3 ZIP Code", 4, "text", { required: true, ...EMPLOYER_US_ONLY }),
  e(`${P(3)}Part6_Line9_NumberU\\.S\\.Employees[0]`, "company.numberOfEmployees", "Part 6", "Item 9 Number of U.S. Employees", 4, "number", { ...DIGITS }),
  e(`${P(3)}Part6_Line10_GrossAnnualIncome[0]`, "company.grossAnnualIncome", "Part 6", "Item 10 Gross Annual Income", 4, "currency", { confidenceLevel: "MEDIUM" }),
  e(`${P(3)}Part6_Line11_NetAnnualIncome[0]`, "company.netAnnualIncome", "Part 6", "Item 11 Net Annual Income", 4, "currency", { confidenceLevel: "MEDIUM" }),

  // --- Part 7: The job offer (page 5) ---
  e(`${P(4)}Part7_Line1_JobTitle[0]`, "employment.positionTitle", "Part 7", "Item 1 Job Title", 5, "text", { required: true }),
  e(`${P(4)}Part7_Line7_Wages[0]`, "employment.salary", "Part 7", "Item 7 Wages", 5, "currency", { required: true, confidenceLevel: "MEDIUM" }),
  e(`${P(4)}Part7_Line7_Per[0]`, "employment.salaryUnit", "Part 7", "Item 7 Per (hour / week / month / year)", 5, "text", { confidenceLevel: "MEDIUM" }),

  // --- Part 8: Employer's authorized signatory (pages 5-6); the signature itself stays manual ---
  e(`${P(4)}Part8_Line2_AuthorizedSignatoryTitle[0]`, "company.authorizedRepresentative.title", "Part 8", "Item 2 Signatory Title", 5, "text"),
  e(`${P(5)}Part8_Line3_AuthorizedSignatoryDaytimeTelephone[0]`, "company.authorizedRepresentative.phone", "Part 8", "Item 3 Signatory Daytime Telephone", 6, "phone", { transform: { type: "phone" } }),
  e(`${P(5)}Part8_Line5_AuthorizedSignatoryEmailAddress[0]`, "company.authorizedRepresentative.email", "Part 8", "Item 5 Signatory Email Address", 6, "email"),
];

// Fields a case manager must enter by hand and the canonical profile cannot supply (published per-field).
const INDIVIDUAL_UNMAPPED = [
  { match: /^Part2_Line4_USCISELISAcctNumber\[0\]$/, item: "Part 2 Item 4 USCIS Online Account Number", reason: "MISSING_SOURCE", note: "Not collected on the client checklist." },
  { match: /^Part2_Line(7_RecieptNumber|8_DateOfBirth|9_RecieptNumber|10_Checkbox)/, item: "Part 2 Items 7-10 I-485 / I-140 receipt numbers, filing date, approved-petition answer", reason: "MISSING_SOURCE", note: "Case-specific filing facts; entered by the case manager. No Yes/No box is defaulted." },
  { match: /^Part7_Line2_SOCCode[12]\[0\]$/, item: "Part 7 Item 2 SOC code (2 + 4 digits)", reason: "MISSING_SOURCE", note: "The PDF splits the SOC code; entered by the case manager." },
  { match: /^Part7_Line3_JobDescription\[0\]$/, item: "Part 7 Item 3 Job description / duties", reason: "MISSING_SOURCE", note: "Free-text duties; entered by the case manager." },
  { match: /^Part8_Line1_AuthorizedSignatory(Given|Family)Name\[0\]$/, item: "Part 8 Item 1 Authorized signatory name", reason: "MISSING_SOURCE", note: "The employer profile stores one combined representative name; split by the case manager." },
  { match: /^Part6_Line(6_BusinessEntity|7_BusinessActivity|8_DateEstablished|12_NAICSCode)\[0\]$/, item: "Part 6 Items 6-8 / 12 entity type, activity, date established, NAICS", reason: "MISSING_SOURCE", note: "Not held in the employer profile in this shape; entered by the case manager." },
];

const USCIS_USE_ONLY_PATTERNS = [/PDF417BarCode/];
const MAPPED_BY_FIELD_NAME = new Map(MAPPED_EDGES.map((entry) => [entry.fieldName, entry]));
const baseName = (fieldName) => String(fieldName || "").replace(/^form1\[0\]\.(?:#subform\[\d+\]\.)?(?:#area\[\d+\]\.)?/, "");

function groupOf(fieldName) {
  const base = baseName(fieldName);
  if (/^Part4_/.test(base) || /^Part9_|^P13_/.test(base)) return { id: "interpreter", label: "Interpreter block", reason: "MISSING_SOURCE", kind: "not_applicant_data" };
  if (/^Part5_/.test(base)) return { id: "preparer", label: "Preparer block", reason: "MISSING_SOURCE", kind: "not_applicant_data" };
  if (/Signature|DateofSignature/.test(base)) return { id: "signature", label: "Signature / date block", reason: "MISSING_SOURCE", kind: "not_applicant_data" };
  if (/^Part10_/.test(base)) return { id: "continuation", label: "Part 10 additional information", reason: "MISSING_SOURCE", kind: "not_applicant_data" };
  const token = /^(?:Pt|Part|P)(\d+)/.exec(base);
  return token
    ? { id: `Pt${token[1]}`, label: `Field group Pt${token[1]}`, reason: "MISSING_SOURCE", kind: "form_data" }
    : { id: "other", label: "Other fields", reason: "MISSING_SOURCE", kind: "form_data" };
}

// Keyed by the RAW AcroForm field name.
function classifyField(field) {
  const fieldName = field.fieldName || field.pdfFieldName || field.fieldId;
  if (USCIS_USE_ONLY_PATTERNS.some((pattern) => pattern.test(fieldName))) return { status: "uscis_use_only", note: "USCIS-internal barcode field." };
  const mapped = MAPPED_BY_FIELD_NAME.get(fieldName);
  if (mapped) return { status: "mapped", edge: mapped };
  const individual = INDIVIDUAL_UNMAPPED.find((entry) => entry.match.test(baseName(fieldName)));
  if (individual) return { status: "manual_entry", individual, group: groupOf(fieldName), note: individual.note };
  return { status: "manual_entry", group: groupOf(fieldName), note: "Not client profile data - completed at review." };
}

module.exports = { FORM_CODE, CONFIDENCE, MAPPED_EDGES, INDIVIDUAL_UNMAPPED, USCIS_USE_ONLY_PATTERNS, classifyField, groupOf, baseName };
