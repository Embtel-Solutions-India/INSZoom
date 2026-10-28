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
    // Part 3 Item 1 (page 4): the beneficiary's foreign address
    R("beneficiary.foreignAddress.line1", "Line2b_StreetNumberName", { pages: [4] }),
    R("beneficiary.foreignAddress.line2", "Line2b2_AptSteFlrNumber", { pages: [4] }),
    R("beneficiary.foreignAddress.city", "Line2c_CityTown", { pages: [4] }),
    R("beneficiary.foreignAddress.state", "Line2g2_Province", { pages: [4], index: 0, transform: { type: "usState", countryPath: "beneficiary.foreignAddress.country" } }),
    R("beneficiary.foreignAddress.state", "Line2g2_Province", { pages: [4], index: 1, transform: { type: "nonUsProvince", countryPath: "beneficiary.foreignAddress.country" } }),
    R("beneficiary.foreignAddress.postalCode", "Line3f_PostalCode", { pages: [4] }),
    R("beneficiary.foreignAddress.country", "Line_Country", { pages: [4], transform: { type: "country" } }),
    // Part 4 Item 1: the consulate / inspection facility (one "City, Country" answer)
    R("beneficiary.consularProcessing.consulateCityCountry", "OfficeAddressCity", { pages: [3], transform: { type: "cityCountry", part: "city" } }),
    R("beneficiary.consularProcessing.consulateCityCountry", "Part4_1c_State_or_Country", { pages: [3], transform: { type: "cityCountry", part: "country" } }),
    // Part 4 yes / no items (a box is ticked only when the generic Yes/No answer matches it; unanswered stays blank)
    R("beneficiary.petitionHasValidPassport", "P4Line2_Checkbox", { pages: [4], index: 0, checkbox: true }),
    R("beneficiary.hasDependents", "P4Line5_Yes", { pages: [4], checkbox: true }),
    R("beneficiary.hasDependents", "P4Line5_No", { pages: [4], checkbox: false }),
    R("beneficiary.dependentCount", "P4Line5_HowMany", { pages: [4], index: 0 }),
    R("beneficiary.anyPersonInRemovalProceedings", "P4Line6_Yes", { pages: [4], checkbox: true }),
    R("beneficiary.anyPersonInRemovalProceedings", "P4Line6_No", { pages: [4], checkbox: false }),
    R("beneficiary.employerPreviouslyFiledImmigrantPetition", "P4Line7", { pages: [4], index: 0, checkbox: true }),
    R("beneficiary.employerPreviouslyFiledImmigrantPetition", "P4Line7", { pages: [4], index: 1, checkbox: false }),
    R("beneficiary.hasPreviousO1VisaWithinSevenYears", "P4Line8a_Yes", { pages: [4], checkbox: true }),
    R("beneficiary.hasPreviousO1VisaWithinSevenYears", "P4Line8a_No", { pages: [4], checkbox: false }),
    R("beneficiary.hasO1VisaDenialWithinSevenYears", "P4Line8b_Yes", { pages: [4], checkbox: true }),
    R("beneficiary.hasO1VisaDenialWithinSevenYears", "P4Line8b_No", { pages: [4], checkbox: false }),
    // Part 5 Item 3: work locations that differ from the petitioner's own address (the first two; further ones stay in the profile)
    R("employment.offSiteWorkLocations", "P5Line3a_StreetNumberName", { pages: [5], transform: { type: "arrayItem", collection: "employment.offSiteWorkLocations", index: 0, itemPath: "address" } }),
    R("employment.offSiteWorkLocations", "P5Line3a_AptSteFlrNumber", { pages: [5], transform: { type: "arrayItem", collection: "employment.offSiteWorkLocations", index: 0, itemPath: "unit" } }),
    R("employment.offSiteWorkLocations", "P5Line3a_CityTown", { pages: [5], transform: { type: "arrayItem", collection: "employment.offSiteWorkLocations", index: 0, itemPath: "city" } }),
    R("employment.offSiteWorkLocations", "P5Line3a_State", { pages: [5], transform: { type: "arrayItem", collection: "employment.offSiteWorkLocations", index: 0, itemPath: "state" } }),
    R("employment.offSiteWorkLocations", "P5Line3a_ZipCode", { pages: [5], transform: { type: "arrayItem", collection: "employment.offSiteWorkLocations", index: 0, itemPath: "postalCode" } }),
    R("employment.offSiteWorkLocations", "P5Line3a_ThirdpartyOrganization", { pages: [5], transform: { type: "arrayItem", collection: "employment.offSiteWorkLocations", index: 0, itemPath: "companyOrEndClientName" } }),
    R("employment.offSiteWorkLocations", "P5Line3b_StreetNumberName2", { pages: [5], transform: { type: "arrayItem", collection: "employment.offSiteWorkLocations", index: 1, itemPath: "address" } }),
    R("employment.offSiteWorkLocations", "P5Line3b_AptSteFlrNumber2", { pages: [5], transform: { type: "arrayItem", collection: "employment.offSiteWorkLocations", index: 1, itemPath: "unit" } }),
    R("employment.offSiteWorkLocations", "P5Line3b_CityTown", { pages: [5], transform: { type: "arrayItem", collection: "employment.offSiteWorkLocations", index: 1, itemPath: "city" } }),
    R("employment.offSiteWorkLocations", "P5Line3b_State2", { pages: [5], transform: { type: "arrayItem", collection: "employment.offSiteWorkLocations", index: 1, itemPath: "state" } }),
    R("employment.offSiteWorkLocations", "P5Line3b_ZipCode2", { pages: [5], transform: { type: "arrayItem", collection: "employment.offSiteWorkLocations", index: 1, itemPath: "postalCode" } }),
    R("employment.offSiteWorkLocations", "P5Line3b_ThirdpartyOrganization2", { pages: [5], transform: { type: "arrayItem", collection: "employment.offSiteWorkLocations", index: 1, itemPath: "companyOrEndClientName" } }),
    R("beneficiary.latestPriorPetitionNumber", "Line1_ReceiptNumber", { pages: [2] }),
    R("beneficiary.eadNumber", "Line5_EAD", { pages: [3] }),
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
    // Part 1: USCIS account number; mailing (Item 4) and physical (Item 6) U.S. addresses come from their own structured answers
    R("beneficiary.uscisOnlineAccountNumber", "Pt1Line2_USCISOnlineAcctNumber", { transform: { type: "digits" } }),
    R("beneficiary.usMailingAddress.line1", "Part2_Item11_StreetName"),
    R("beneficiary.usMailingAddress.city", "Part2_Item11_City"),
    R("beneficiary.usMailingAddress.state", "Part2_Item11_State", { transform: { type: "usState" } }),
    R("beneficiary.usMailingAddress.postalCode", "Part2_Item11_ZipCode"),
    R("beneficiary.usPhysicalAddress.line1", "Part1_Item6_StreetName"),
    R("beneficiary.usPhysicalAddress.city", "Part1_Item6_City"),
    R("beneficiary.usPhysicalAddress.state", "Part1_Item6_State", { transform: { type: "usState" } }),
    R("beneficiary.usPhysicalAddress.postalCode", "Part1_Item6_ZipCode"),
    // Part 1 Item 12 / passport: status expiry and passport dates
    R("beneficiary.currentVisaExpirationDate", "SupA_Line1p_DateExpires"),
    R("beneficiary.passport.expirationDate", "SupA_Line1n_ExpDate"),
    // Part 2 Item 1: application type. Reinstatement is deliberately NOT mapped (not an H-4 application type; flagged for case manager review)
    R("application.applicationType", "P2_checkbox", { pages: [2], index: 0, checkboxEquals: "An extension of stay in my current status" }),
    R("application.applicationType", "P2_checkbox", { pages: [2], index: 1, checkboxEquals: "Change of status" }),
    R("application.applicationType", "P2_checkbox", { pages: [2], index: 2, remove: true }),
    // Part 2 Item 2: requested new status and effective date (only when a change of status was requested)
    R("application.requestedStatus", "Pt2Line2a_NewStatus"),
    R("application.requestedStatusEffectiveDate", "Pt2Line2b_EffectiveDate"),
    // Part 4 Item 2: physical address outside the U.S. (state and province are distinct answers; the form has a Province box only)
    R("beneficiary.foreignAddress.streetAddress", "P2_Line10_StreetName"),
    R("beneficiary.foreignAddress.city", "P2_Line10_City"),
    R("beneficiary.foreignAddress.province", "P2_Line10_Province", { fallback: "beneficiary.foreignAddress.state" }),
    R("beneficiary.foreignAddress.postalCode", "P2_Line10_PostalCode"),
    R("beneficiary.foreignAddress.country", "P2_Line10_Country", { transform: { type: "country" } }),
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

// Form I-824: verified rules live in their own file. EXCLUSIVE forms keep ONLY rule-backed edges - any older auto-guessed edge on a field no rule covers
// (e.g. company.name on a beneficiary name box) is removed instead of leaving wrong data on the PDF.
RULES["I-824"] = require("./i824FieldRules").I824_RULES;
// Form I-140: only the boxes USCIS switches on by script (not exclusive - the form's existing edges are kept).
RULES["I-140"] = require("./i140FieldRules").I140_RULES;
// Form I-864: every box the sponsor / principal-immigrant checklists can fill. EXCLUSIVE: only rule-backed edges are kept (an old guess on a box no rule covers
// - a name on the wrong person's box, for instance - is removed instead of leaving wrong data on the form); everything else is the case manager's.
RULES["I-864"] = require("./i864FieldRules").I864_RULES;
// Form N-400: the applicant (the checklist's client, stored as petitioner.*). EXCLUSIVE for the same reason as I-864.
RULES["N-400"] = require("./n400FieldRules").N400_RULES;
// Form I-129S (blanket L supplement): the L-1 employer (petitioner.*) and the transferred worker (beneficiary.*). EXCLUSIVE for the same reason.
RULES["I-129S"] = require("./i129sFieldRules").I129S_RULES;
// Form I-751: the conditional resident (petitioner.*), the spouse (petitioner.currentSpouse.*) and the children (petitioner.children). EXCLUSIVE as well.
RULES["I-751"] = require("./i751FieldRules").I751_RULES;
// Form I-131: the boxes no edge covered (physical description, USCIS online account, I-94 number, the applicant's own phone / e-mail). Not exclusive - the form's existing edges are kept.
RULES["I-131"] = require("./i131FieldRules").I131_RULES;
// Form I-129 supplements (L Classification Section 1: the beneficiary's foreign employment dates and the petitioner's employer abroad) - authored and page-restricted, see i129SupplementRules.js.
RULES["I-129"] = [...RULES["I-129"], ...require("./i129SupplementRules").I129_SUPPLEMENT_RULES];
// EOIR-29: the appellant / petitioner signs and gives a mailing address on page 2; page 1 holds the A-Numbers. (The AR-11 template dated 2026-02-01 holds this same PDF - a wrong
// file, caught by FormIdentityService - so AR-11 has no rules of its own here: the real AR-11 is a different form.)
const APPELLANT = [
  R("petitioner.fullName", "Name", { pages: [2] }),
  R("petitioner.address.line1", "Street Number and Name", { pages: [2] }),
  R("petitioner.address.line2", "Apartment Number or Unit Number (if any)", { pages: [2] }),
  R("petitioner.address.city", "City", { pages: [2] }),
  R("petitioner.address.state", "State", { pages: [2] }),
  R("petitioner.address.zip", "Zip Code", { pages: [2] }),
  R("petitioner.aNumber", "A-Number, if any", { pages: [1] }),
  R("beneficiary.alienRegistrationNumber", "DHS Anumber", { pages: [1] }),
];
RULES["EOIR-29"] = APPELLANT;
// I-193 (waiver of passport / visa): one person, the filer - the petitioner; on an employer-employee case the petitioner is the company, so the employee (beneficiary) is used.
const FILER_OR_EMPLOYEE = (fact, stems, options = {}) => R(`petitioner.${fact}`, stems, { fallback: `beneficiary.${fact}`, ...options });
RULES["I-193"] = [
  FILER_OR_EMPLOYEE("lastName", "MY_NAME_IS_LAST"),
  FILER_OR_EMPLOYEE("firstName", "MY_NAME_IS_FIRST"),
  FILER_OR_EMPLOYEE("middleName", "MY_NAME_IS_MIDDLE"),
  FILER_OR_EMPLOYEE("dateOfBirth", "Date_Of_Birth"),
  FILER_OR_EMPLOYEE("placeOfBirth", "PLACE_OF_BIRTH"),
  FILER_OR_EMPLOYEE("countryOfCitizenship", "THE_COUNTRY_OF_WHICH_I_AM_A_CITIZEN_SUBJECT_OR_NATIONA", { transform: { type: "country" } }),
];
// I-956F / I-956G: address information only (Part 2, Item 3)
const ADDRESS_ONLY = [
  R("petitioner.address.line1", "P2_Line3_StreetNumberName", { pages: [2] }),
  R("petitioner.address.line2", "P2_Line3_AptSteFlrNumber", { pages: [2] }),
  R("petitioner.address.city", "P2_Line3_CityOrTown", { pages: [2] }),
  R("petitioner.address.state", "P2_Line3_State", { pages: [2] }),
  R("petitioner.address.zip", "P2_Line3_ZIPCode", { pages: [2] }),
  R("petitioner.address.country", "P2_Line3_Country", { pages: [2], transform: { type: "country" } }),
];
RULES["I-956F"] = ADDRESS_ONLY;
RULES["I-956G"] = ADDRESS_ONLY;
// I-956 (Regional Center designation): the filer is the regional center entity, i.e. the petitioner. Part 2 only - the entity's legal name, EIN, address (Item 8),
// telephone (Item 9) and e-mail (Item 11, the first of the two e-mail-typed boxes; the second is the website). Everything else on the form (project description,
// persons involved, certifier / preparer / interpreter blocks) is about someone else or free narrative and stays blank for staff.
RULES["I-956"] = [
  R("petitioner.name", "P2_Line1_RegCtrEntityLegalName", { pages: [1] }),
  R("petitioner.ein", "P2_Line7_RegEntFedEmployerNum", { pages: [2], transform: { type: "digits" } }),
  R("petitioner.address.line1", "P2_Line8_StreetNumberName", { pages: [2] }),
  R("petitioner.address.line2", "P2_Line8_AptSteFlrNumber", { pages: [2] }),
  R("petitioner.address.city", "P2_Line8_CityOrTown", { pages: [2] }),
  R("petitioner.address.state", "P2_Line8_State", { pages: [2] }),
  R("petitioner.address.zip", "P2_Line8_ZIPCode", { pages: [2] }),
  R("petitioner.address.country", "P2_Line8_Country", { pages: [2], transform: { type: "country" } }),
  R("petitioner.phone", "P3_Line4_DaytimeTelePhoneNumber", { pages: [2], transform: { type: "phone" } }),
  R("petitioner.email", "P3_Line6_Email", { pages: [2], index: 0 }),
];
// N-644 (posthumous citizenship): the applicant block (page 1, Part 1 items 1-9) is the person the case is for - beneficiary.*, as for the other identity-only forms.
// The decedent's block and the military / family history (Part 2, page 2) have no canonical source, and the telephone is split into area code + number: all left blank.
const LAST_FIRST_MIDDLE = { type: "concat", fields: ["beneficiary.lastName", "beneficiary.firstName", "beneficiary.middleName"], separator: ", " };
RULES["N-644"] = [
  R("beneficiary.fullName", "ApplicanLastFirstMiddleName", { pages: [1], transform: LAST_FIRST_MIDDLE }),
  R("beneficiary.address", "ApplicantAddress", { pages: [1] }),
  R("beneficiary.city", "ApplicantCityStateCountryZip", { pages: [1], transform: { type: "concat", fields: ["beneficiary.city", "beneficiary.state", "beneficiary.zipCode"], separator: ", " } }),
  R("beneficiary.dateOfBirth", "ApplicantDOB", { pages: [1] }),
  R("beneficiary.alienRegistrationNumber", "ApplicantAnumber", { pages: [1], transform: { type: "digits" } }),
  R("beneficiary.email", "ApplicantE-MailAddress", { pages: [1] }),
];
// I-9 (employment eligibility verification): Section 1 (page 1) is the employee - beneficiary.* (the employee on an employer-employee case) - and the employee's name is repeated at the
// top of Supplement A (page 3) and Supplement B (page 4). Section 2 is the employer's and the document lists / status boxes depend on the employee's answers: left blank. Box names
// containing a "." (the List A document lines) are never matched, since a rule stem is the last dot-separated part of the name.
RULES["I-9"] = [
  R("beneficiary.lastName", ["Last Name (Family Name)", "Last Name Family Name from Section 1", "Last Name Family Name from Section 1-2"]),
  R("beneficiary.firstName", ["First Name Given Name", "First Name Given Name from Section 1", "First Name Given Name from Section 1-2"]),
  R("beneficiary.middleName", ["Employee Middle Initial (if any)", "Middle initial if any from Section 1", "Middle initial if any from Section 1-2"], { transform: { type: "initial" } }),
  R("beneficiary.address", "Address Street Number and Name", { pages: [1] }),
  R("beneficiary.apartment", "Apt Number (if any)", { pages: [1] }),
  R("beneficiary.city", "City or Town", { pages: [1] }),
  R("beneficiary.state", "State", { pages: [1] }),
  R("beneficiary.zipCode", "ZIP Code", { pages: [1] }),
  R("beneficiary.dateOfBirth", "Date of Birth mmddyyyy", { pages: [1] }),
  R("beneficiary.ssn", "US Social Security Number", { pages: [1], transform: { type: "digits" } }),
  R("beneficiary.email", "Employees E-mail Address", { pages: [1] }),
  R("beneficiary.primaryPhone", "Telephone Number", { pages: [1], transform: { type: "phone" } }),
];
// every rule above is the product owner's decision, complete for its form: EXCLUSIVE, so no guessed value can reach a box no rule covers
const EXCLUSIVE_FORMS = new Set(["I-824", "I-864", "N-400", "I-129S", "I-751", "EOIR-29", "I-193", "I-956F", "I-956G", "I-956", "N-644", "I-9"]);

module.exports = { RULES, FULL_NAME, EXCLUSIVE_FORMS };
