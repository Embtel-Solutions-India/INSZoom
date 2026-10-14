// Verified field rules for Form I-824 (edition 2024-01-04 / current registry template): every stem below is the REAL last PDF-name segment of a field in the
// active template - never a label guess. Form layout: Part 1 = the petitioner (Items 2-14); Part 3 Items 2-4 = the principal applicant; Items 5-10 = the first
// beneficiary (Items 12-32 repeat for further beneficiaries); Items 33-34 = the outside-U.S. address / foreign phone as supplied on the Beneficiary Checklist.
//
// Deliberately NOT mapped (retained as case information / flagged for staff review): Part 2 requested-action boxes and Part 3 Item 1 (the underlying approved
// petition) - they need the staff-verified requested action; G-28 / applicant-vs-petitioner boxes; Unit (Apt/Ste/Flr) type boxes; the preparer / interpreter /
// signature blocks (they describe other people); further beneficiaries 2-4 (one beneficiary per family case); the principal's country of citizenship (the form has
// no such field); and every document upload (evidence, never PDF text).
const R = (to, stems, options = {}) => ({ to, stems: [].concat(stems), ...options });
const COUNTRY = { transform: { type: "country" } };
const DIGITS = { transform: { type: "digits" } };
const STATE = { transform: { type: "usState" } };
const PHONE = { transform: { type: "phone" } };
const person = (field) => ({ fallback: `person.${field}` });

const I824_RULES = [
  // ---- Part 1: the petitioner ----
  R("petitioner.lastName", "Part1_Line2a_FamilyName", person("lastName")),
  R("petitioner.firstName", "Part1_Line2b_GivenName", person("firstName")),
  R("petitioner.middleName", "Part1_Line2c_MiddleName", person("middleName")),
  R("petitioner.organizationName", "Part1_Line3_CompanyorOrgName"),
  R("petitioner.currentImmigrationStatus", "Part1_Line4_CurrentOrRecentImmigrationStatus"),
  R("petitioner.citizenshipCertificateNumber", "Part1_Line5_CertificateOfNatzorCitzNumber"),
  R("petitioner.aNumber", "Part1_Line6_AlienNumber", { transform: { type: "alienNumber" } }),
  R("petitioner.dateOfBirth", "Part1_Line7_DateofBirth", person("dob")),
  R("petitioner.countryOfBirth", "Part1_Line8_CountryofBirth", { ...COUNTRY, ...person("countryOfBirth") }),
  R("petitioner.countryOfCitizenship", "Part1_Line9_CountryofCitizenship", { ...COUNTRY, ...person("citizenship") }),
  R("petitioner.irsTaxNumber", "Part1_Line10_IRSTaxNumber", DIGITS),
  R("petitioner.ssn", "Part1_Line11_SSN", { transform: { type: "ssn" } }),
  R("petitioner.uscisOnlineAccountNumber", ["Part1_Line12_AcctIdentifier", "USCISOnlineAcctNumber"], DIGITS),
  R("petitioner.mailingAddress.line1", "Part1_Line13b_StreetNumberName"),
  R("petitioner.mailingAddress.line2", "Line13c_AptSteFlrNumber"),
  R("petitioner.mailingAddress.city", "Part1_Line13d_CityOrTown"),
  R("petitioner.mailingAddress.state", "Part1_Line13e_State", STATE),
  R("petitioner.mailingAddress.postalCode", "Part1_Line13f_ZipCode"),
  R("petitioner.mailingAddress.country", "Part1_Line13i_Country", COUNTRY),
  R("petitioner.physicalAddress.line1", "Part1_Line14_StreetNumberName"),
  R("petitioner.physicalAddress.line2", "Part1_Line14_AptSteFlrNumber"),
  R("petitioner.physicalAddress.city", "Part1_Line14_CityOrTown"),
  R("petitioner.physicalAddress.state", "Part1_Line14_State", STATE),
  R("petitioner.physicalAddress.postalCode", "Part1_Line14_ZipCode"),
  R("petitioner.physicalAddress.country", "Part1_Line14_Country", COUNTRY),

  // ---- Part 3 Items 2-4: the principal applicant (kept in the Petitioner Checklist, mapped only where the form asks) ----
  R("principalImmigrant.lastName", "Part3_Line2a_FamilyName"),
  R("principalImmigrant.firstName", "Part3_Line2b_GivenName"),
  R("principalImmigrant.middleName", "Part3_Line2c_MiddleName"),
  R("principalImmigrant.dateOfBirth", "Part3_Line2d_DateofBirth"),
  R("principalImmigrant.countryOfBirth", "Part3_Line2e_CountryofBirth", COUNTRY),
  R("principalImmigrant.aNumber", "Part3_Line2f_AlienNumber", { transform: { type: "alienNumber" } }),
  R("principalImmigrant.daytimeTelephoneNumber", "Part3_Line2g_DaytimeTelephoneNumber3", PHONE),
  R("principalImmigrant.mailingAddress.line1", "Pt3Line3_StreetNumberName"),
  R("principalImmigrant.mailingAddress.line2", "Pt3Line3_AptSteFlrNumber"),
  R("principalImmigrant.mailingAddress.city", "Pt3Line3_CityOrTown"),
  R("principalImmigrant.mailingAddress.state", "Pt3Line3_State", STATE),
  R("principalImmigrant.mailingAddress.postalCode", "Pt3Line3_ZipCode"),
  R("principalImmigrant.mailingAddress.country", "Pt3Line3_Country", COUNTRY),
  R("principalImmigrant.physicalAddress.line1", "Pt3Line4_StreetNumberName"),
  R("principalImmigrant.physicalAddress.line2", "Pt3Line4_AptSteFlrNumber"),
  R("principalImmigrant.physicalAddress.city", "Pt3Line4_CityOrTown"),
  R("principalImmigrant.physicalAddress.state", "Pt3Line4_State", STATE),
  R("principalImmigrant.physicalAddress.postalCode", "Pt3Line4_ZipCode"),
  R("principalImmigrant.physicalAddress.country", "Pt3Line4_Country", COUNTRY),

  // ---- Part 3 Items 5-10 and 33-34: the beneficiary ----
  R("beneficiary.lastName", "Part3_Line5a_FamilyName"),
  R("beneficiary.firstName", "Part3_Line5b_GivenName"),
  R("beneficiary.middleName", "Part3_Line5c_MiddleName"),
  R("beneficiary.dateOfBirth", "Part3_Line6_DateofBirth"),
  R("beneficiary.countryOfBirth", "Part3_Line7_CountryofBirth", COUNTRY),
  R("beneficiary.countryOfCitizenship", "Part3_Line8_CountryOfCitizenship", COUNTRY),
  R("beneficiary.relationshipToPrincipalApplicant", "Part3_Line9_Relationship"),
  R("beneficiary.email", "Part3_Line10_DependentEmailAddress"),
  R("beneficiary.daytimeTelephoneNumber", "Part3_Line5i_DependentDaytimeTelephoneNumber3", PHONE),
  R("beneficiary.foreignAddress.line1", "Pt3Line33_StreetNumberName"),
  R("beneficiary.foreignAddress.line2", "Pt3Line33_AptSteFlrNumber"),
  R("beneficiary.foreignAddress.city", "Pt3Line33_CityOrTown"),
  R("beneficiary.foreignAddress.state", "Pt3Line33_Province"),
  R("beneficiary.foreignAddress.postalCode", "Pt3Line33_PostalCode"),
  R("beneficiary.foreignAddress.country", "Pt3Line33_Country", COUNTRY),
  R("beneficiary.foreignTelephoneNumber", "Part3_Line34_ForeignNumber", PHONE),
];

module.exports = { I824_RULES };
