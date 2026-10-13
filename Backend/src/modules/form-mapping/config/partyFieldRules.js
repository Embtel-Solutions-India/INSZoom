// Generic party mapping rules: which fields of a USCIS form carry a fact about the BENEFICIARY or the PETITIONER, expressed against the two generic
// canonical roots (beneficiary.* / petitioner.* - see canonical PartyAliasService) instead of against any one questionnaire or visa.
//
// A rule names a canonical path and EVERY field (by its real PDF field-name stem, with an optional page restriction) that asks for that fact - so a
// value is filled as many times as the form repeats it (the petitioner's name is on the I-129 cover, its supplements, its signature blocks...).
// Stems are exact (case-insensitive) matches of the last PDF name segment without "[n]", never label guesses. A field is deliberately NOT listed
// when it asks about someone else (preparer, interpreter, joint employer, a foreign employer, an additional beneficiary, an attorney).
const R = (to, stems, options = {}) => ({ to, stems: [].concat(stems), ...options });
const FULL_NAME = { type: "concat", fields: ["beneficiary.firstName", "beneficiary.middleName", "beneficiary.lastName"], separator: " " };

const RULES = {
  "I-129": [
    // ---- petitioner (the sponsoring employer) ----
    R("petitioner.name", ["Line3_CompanyorOrgName", "SupELine1_NameofEmployer", "TASupLine1_NameofPetitioner", "Line1_PetitionerName", "Sect1_PetitionerPrintedName", "Sect3_PartA_PetitionerName"]),
    R("petitioner.ein", "TextField1", { pages: [1] }),
    R("petitioner.address.line1", "Line7b_StreetNumberName", { pages: [1] }),
    R("petitioner.address.line2", "Line3_AptSteFlrNumber", { pages: [1] }),
    R("petitioner.address.city", "Line_CityTown", { pages: [1] }),
    R("petitioner.address.state", "P1_Line3_State"),
    R("petitioner.address.zip", "P1_Line3_ZipCode"),
    R("petitioner.address.country", "P1_Line3_Country", { transform: { type: "country" } }),
    R("petitioner.phone", "Line2_DaytimePhoneNumber1_Part8", { transform: { type: "phone" } }),
    R("petitioner.email", "Line9_EmailAddress"),
    R("petitioner.businessType", "Part5Line12_TypeofBusiness"),
    R("petitioner.yearEstablished", "P5Line13_YearEstablished"),
    R("petitioner.numberOfEmployees", "P5Line14_NumberofEmployees"),
    R("petitioner.grossAnnualIncome", "Line15_GrossAnnualIncome"),
    R("petitioner.netAnnualIncome", "Line16_NetAnnualIncome"),
    R("petitioner.jobTitle", "Part5_Q1_JobTitle"),
    R("petitioner.wage", "Line8_Wages"),
    R("petitioner.signatory.lastName", ["Line1a_PetitionerLastName", "TASupLine1a_PetitionerLastName"]),
    R("petitioner.signatory.firstName", ["Line1b_PetitionerFirstName", "TASupLine1b_PetitionerFirstName"]),
    R("petitioner.signatory.email", "Pt7Line3_EmailAddress"),
    R("petitioner.signatory.phone", "Pt7Line3_DaytimePhoneNumber1", { transform: { type: "phone" } }),
    // ---- beneficiary (the worker) ----
    R("beneficiary.firstName", ["Part3_Line2_GivenName", "HSupLine2_GivenName"]),
    R("beneficiary.middleName", ["Part3_Line2_MiddleName", "HSupLine2_MiddleName"]),
    R("beneficiary.lastName", ["Part3_Line2_FamilyName", "HSupLine2_FamilyName"]),
    R("beneficiary.fullName", ["Line2_BeneficiaryName", "TASupLine1_NameofBeneficiary"], { transform: FULL_NAME }),
    R("beneficiary.alienRegistrationNumber", "Line1_AlienNumber", { pages: [3], transform: { type: "digits" } }),
    R("beneficiary.dateOfBirth", "Line6_DateOfBirth", { pages: [3] }),
    R("beneficiary.ssn", "Line5_SSN", { pages: [3], transform: { type: "digits" } }),
    R("beneficiary.countryOfBirth", "Part3Line4_CountryOfBirth"),
    R("beneficiary.provinceOfBirth", "Part4Line3_DProvince", { pages: [3] }),
    R("beneficiary.countryOfCitizenship", "Part3Line4_CountryOfCitizenship"),
    R("beneficiary.passport.number", ["Part3Line5_PassportorTravDoc", "ClassHLine5b_PassportorTravDoc"]),
    R("beneficiary.passport.country", "Line_CountryOfIssuance", { pages: [3] }),
    R("beneficiary.i94Number", "Part3Line5_ArrivalDeparture"),
    R("beneficiary.lastArrivalDate", "Part3Line5_DateofArrival"),
    R("beneficiary.sevisId", "Line5_SEVIS"),
    R("beneficiary.currentVisaExpirationDate", "Line11h_DateStatusExpires"),
    R("beneficiary.address", "Line8a_StreetNumberName"),
    R("beneficiary.apartment", "Line6_AptSteFlrNumber"),
    R("beneficiary.city", "Line8d_CityTown"),
    R("beneficiary.state", "Line8e_State"),
    R("beneficiary.zipCode", "Line8f_ZipCode"),
  ],

  "I-907": [
    // requestor = the person acting for the petitioner; company = the petitioner
    R("petitioner.signatory.firstName", ["Pt1Line3_GivenName", "Part2_Line4_PetitionerApplicantGivenName", "Part1_Line8_NameOfCompanyPOC_GivenName"]),
    R("petitioner.signatory.lastName", ["Pt1Line3_FamilyName", "Part2_Line4_PetitionerApplicantFamilyName", "Part1_Line8_NameOfCompanyPOC_FamilyName"]),
    R("petitioner.signatory.title", "Part1_Line8_NameOfCompanyPOC_TitleofPOC"),
    R("petitioner.name", "Part1_Line4_CompanyorOrganizationName"),
    R("petitioner.ein", "Part1_Line9_CompanyIRSTaxNumber", { transform: { type: "digits" } }),
    R("petitioner.address.line1", ["Part1_Line5_MailingAddress_StreetNumberName", "Part1_Line7_PhysicalAddress_StreetNumberName"]),
    R("petitioner.address.line2", ["Part1_Line5_MailingAddress_AptSteFlrNumber", "Part1_Line7_PhysicalAddress_AptSteFlrNumber"]),
    R("petitioner.address.city", ["Part1_Line5_MailingAddress_CityTown", "Part1_Line7_PhysicalAddress_CityTown"]),
    R("petitioner.address.state", ["Part1_Line5_MailingAddress_State", "Part1_Line7_PhysicalAddress_State"]),
    R("petitioner.address.zip", ["Part1_Line5_MailingAddress_ZipCode", "Part1_Line7_PhysicalAddress_ZipCode"]),
    R("petitioner.address.country", ["Part1_Line5_MailingAddress_Country", "Part1_Line7_PhysicalAddress_Country"], { transform: { type: "country" } }),
    R("petitioner.signatory.phone", "P3_Line4_DaytimeTelePhoneNumber", { transform: { type: "phone" } }),
    R("petitioner.signatory.email", "P3_Line6_Email"),
    R("beneficiary.firstName", "Line_GivenName"),
    R("beneficiary.middleName", "Line_MiddleName"),
    R("beneficiary.lastName", "Line_FamilyName"),
  ],

  // the applicant of an I-539 is the person extending / changing status (for TN, the TD dependent)
  "I-539": [
    R("beneficiary.lastName", "P1Line1a_FamilyName"),
    R("beneficiary.firstName", "P1_Line1b_GivenName"),
    R("beneficiary.middleName", "P1_Line1c_MiddleName"),
    R("beneficiary.alienRegistrationNumber", "Pt1Line2_AlienNumber", { transform: { type: "digits" } }),
    R("beneficiary.dateOfBirth", "P1_Line8_DateOfBirth"),
    R("beneficiary.countryOfCitizenship", "P1_Line7_CountryOfCitizenship"),
    R("beneficiary.countryOfBirth", "P1_Line6_CountryOfBirth"),
    R("beneficiary.ssn", "P1_Line9_SSN", { transform: { type: "digits" } }),
    R("beneficiary.address", ["Part1_Item6_StreetName", "Part2_Item11_StreetName"]),
    R("beneficiary.city", ["Part1_Item6_City", "Part2_Item11_City"]),
    R("beneficiary.state", ["Part1_Item6_State", "Part2_Item11_State"]),
    R("beneficiary.zipCode", ["Part1_Item6_ZipCode", "Part2_Item11_ZipCode"]),
    R("beneficiary.lastArrivalDate", "SupA_Line1i_DateOfArrival"),
    R("beneficiary.i94Number", "SupA_Line1j_ArrivalDeparture"),
    R("beneficiary.passport.number", "SupA_Line1k_Passport"),
    R("beneficiary.passport.country", "SupA_Line1m_CountryOfIssuance"),
    R("beneficiary.primaryPhone", "P5_Line3_DaytimePhoneNumber", { transform: { type: "phone" } }),
    R("beneficiary.mobilePhone", "P5_Line4_MobilePhoneNumber", { transform: { type: "phone" } }),
    R("beneficiary.email", "P5_Line5_EmailAddress"),
  ],

  // G-28 for an employer petition: the client is the petitioner entity and its signatory
  "G-28": [
    R("petitioner.signatory.lastName", "Pt3Line5a_FamilyName"),
    R("petitioner.signatory.firstName", "Pt3Line5b_GivenName"),
    R("petitioner.name", "Pt3Line7a_NameOfEntity"),
    R("petitioner.signatory.title", "Pt3Line7b_TitleofEntity"),
    R("petitioner.address.line1", "Line12a_StreetNumberName"),
    R("petitioner.address.line2", "Line12b_AptSteFlrNumber"),
    R("petitioner.address.city", "Line12c_CityOrTown"),
    R("petitioner.address.state", "Line12d_State"),
    R("petitioner.address.zip", "Line12e_ZipCode"),
    R("petitioner.address.country", "Line12h_Country", { transform: { type: "country" } }),
  ],
};

module.exports = { RULES, FULL_NAME };
