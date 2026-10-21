// Form I-129S (Nonimmigrant Petition Based on a Blanket L Petition): every box a fact the L-1 employer / employee checklists collect can fill, wired to the generic
// canonical paths those checklists write (canonical/config/partyChecklistPaths.js: employer_* -> petitioner.*, employee_* -> beneficiary.*). The petitioner is the
// U.S. employer (Part 1, Part 7); the beneficiary is the transferred worker (Part 2 and the stay history of Part 3); the proposed employment and the foreign employer
// are the employer checklist's job / foreign-company answers. Stems are exact PDF field names (case-insensitive, without "[n]"); a page restriction separates the
// boxes of one name that appear on different pages (the page-8 "pre-populated" copies take the same fact as their page-2 / page-1 masters).
//
// Left to the case manager, on purpose (no checklist question collects it, the answer is a case-specific judgement, or the box is not the petitioner's /
// beneficiary's own fact): the Blanket L receipt number, the Yes / No eligibility questions of Parts 1-4, the Manager / Executive / Specialized-Knowledge choice, the
// in-care-of names, the unit-type boxes (the checklist keeps the unit as one free-text line), the beneficiary's other names, a separate physical address, the
// supervision / reason boxes, the second foreign position, other compensation, fax number, the attorney block, the interpreter, the preparer, signatures and the
// additional-information pages.
const R = (to, stems, options = {}) => ({ to, stems: [].concat(stems), ...options });
const COUNTRY = { transform: { type: "country" } };
const STATE = { transform: { type: "usState" } };
const PHONE = { transform: { type: "phone" } };
const DIGITS = { transform: { type: "digits" } };
const rowOf = (collection, index, itemPath, extra = {}) => ({ type: "arrayItem", collection, index, itemPath, ...extra });

const WORK = "petitioner.job.workLocations";
const HISTORY = "beneficiary.previousStatusHistory";
// a prior stay (row of the previous H / L status list) -> its from / to dates and its nonimmigrant status
const stay = (index, from, to, status) => [
  R(HISTORY, from, { transform: rowOf(HISTORY, index, "arrivalDate", { format: "mm/dd/yyyy" }) }),
  R(HISTORY, to, { transform: rowOf(HISTORY, index, "departureDate", { format: "mm/dd/yyyy" }) }),
  R(HISTORY, status, { transform: rowOf(HISTORY, index, "visaClassification") }),
];

const I129S_RULES = [
  // ---- Part 1: the petitioning organization (the U.S. employer) ----
  R("petitioner.name", "Pt1Line1_NameofBusinessorOrgName"),
  R("petitioner.address.line1", "Pt1Line2b_StreetNumberName"),
  R("petitioner.address.line2", "Pt1Line2c_AptSteFlrNumber"),
  R("petitioner.address.city", "Pt1Line2d_CityOrTown"),
  R("petitioner.address.state", "Pt1Line2e_State", STATE),
  R("petitioner.address.zip", "Pt1Line2f_ZipCode"),
  R("petitioner.phone", "Pt1Line5_DaytimeTelephoneNumber", PHONE),
  R("petitioner.email", "Pt1Line7_EmailAddress"),
  R("petitioner.website", "Pt1Line8_WebsiteAddress"),

  // ---- Part 2: the beneficiary ----
  R("beneficiary.alienRegistrationNumber", "Pt3Line1_AlienNumber", DIGITS),
  R("beneficiary.uscisOnlineAccountNumber", "Pt2Line2_USCISELISAcctNumber", DIGITS),
  R("beneficiary.ssn", "Pt2Line3_SSN", DIGITS),
  R("beneficiary.lastName", "Pt3Line4a_FamilyName"),
  R("beneficiary.firstName", "Pt3Line4b_GivenName"),
  R("beneficiary.middleName", "Pt3Line4c_MiddleName"),
  // the beneficiary's address outside the United States (Item 6)
  R("beneficiary.foreignAddress.line1", "Pt3Line6b_StreetNumberName"),
  R("beneficiary.foreignAddress.line2", "Pt3Line6c_AptSteFlrNumber"),
  R("beneficiary.foreignAddress.city", "Pt3Line6d_CityOrTown"),
  R("beneficiary.foreignAddress.state", "Pt3Line6e_Province"),
  R("beneficiary.foreignAddress.postalCode", "Pt3Line6f_PostalCode"),
  R("beneficiary.foreignAddress.country", "Pt3Line6g_Country", COUNTRY),
  R("beneficiary.dateOfBirth", "Pt2Line9_DateOfBirth"),
  R("beneficiary.gender", "Pt2Line10_Gender", { index: 0, checkboxEquals: "Female", ignoreCase: true }),
  R("beneficiary.gender", "Pt2Line10_Gender", { index: 1, checkboxEquals: "Male", ignoreCase: true }),
  R("beneficiary.cityTownOfBirth", "Pt2Line11_CityOrTownofBirth"),
  R("beneficiary.provinceOfBirth", "Pt2Line12_ProvinceofBirth"),
  R("beneficiary.countryOfBirth", "Pt2Line13_CountryofBirth", COUNTRY),
  R("beneficiary.countryOfCitizenship", "Pt2Line14_CitzorNationality", COUNTRY),

  // ---- Part 3: the beneficiary's earlier stays in H / L status (two entries with dates and status) ----
  ...stay(0, "Pt3Line10a_DateFrom", "Pt3Line10b_DateTo", "Pt3Line11_NonimmigrantStatus"),
  ...stay(1, "Pt3Line12a_DateFrom", "Pt3Line12b_DateTo", "Pt3Line13_NonimmigrantStatus"),

  // ---- the proposed employment: where, how much, which position ----
  R(WORK, "Pt4Line3a_StreetNumberName", { pages: [3], transform: rowOf(WORK, 0, "street") }),
  R(WORK, "Pt4Line3c_CityOrTown", { pages: [3], transform: rowOf(WORK, 0, "city") }),
  R(WORK, "Pt4Line3d_State", { transform: rowOf(WORK, 0, "state") }),
  R(WORK, "Pt4Line3e_ZipCode", { transform: rowOf(WORK, 0, "zipCode") }),
  // the box is worded "Beneficiary's wages", while the employer checklist stores the offered salary under petitioner.wage: the neutral employment path is the
  // primary source and the checklist's own path the fallback, so the answer still fills
  R("employment.wage", "Pt3Line6_Wages", { fallback: "petitioner.wage" }),
  R("employment.hoursPerWeek", "Pt3Line7_HoursPerWeek"),
  R("petitioner.jobTitle", "Pt3Line8_JobTitle"),
  R("petitioner.job.duties", "Pt3Line9_JobDescription", { index: 1 }),

  // ---- Part 4: the beneficiary's employer abroad (the qualifying foreign entity) and the position held there ----
  R("petitioner.foreignCompany.name", "Pt4Line2_ForeignEmployerName"),
  R("petitioner.foreignCompany.address.line1", "Pt4Line3a_StreetNumberName", { pages: [4] }),
  R("petitioner.foreignCompany.address.city", "Pt4Line3c_CityOrTown", { pages: [4] }),
  R("petitioner.foreignCompany.address.state", "Pt4Line3e_Province"),
  R("petitioner.foreignCompany.address.postalCode", "Pt4Line3d_PostalCode"),
  R("petitioner.foreignCompany.address.country", "Line2f_Country", COUNTRY),
  R("beneficiary.foreignEmployment.title", "Pt4Line4_JobTitle"),
  R("beneficiary.foreignEmployment.startDate", "Pt4Line5a_StartDate"),
  R("beneficiary.foreignEmployment.endDate", "Pt4Line5b_EndDate"),

  // ---- Part 7: the petitioner's authorized signatory ----
  R("petitioner.signatory.firstName", "Pt7Line1_PetionerAuthorizedGivenName"),
  R("petitioner.signatory.lastName", "Pt7Line1_PetionerAuthorizedFamilyName"),
  R("petitioner.signatory.title", "Pt7Line2_PetionerAuthorizedMiddleName"),
  R("petitioner.signatory.phone", "Pt7Line3_PetitionerAuthorizedDaytimePhoneNumber1", PHONE),
  R("petitioner.signatory.email", "Pt7Line5_PetitionerAurthorizedEmail"),
];

module.exports = { I129S_RULES };
