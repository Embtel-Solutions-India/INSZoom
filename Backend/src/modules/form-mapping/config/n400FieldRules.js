// Form N-400 (Application for Naturalization): every box a fact of the applicant's own can fill, wired to the canonical paths the N-400 client checklist writes
// (canonical/config/partyChecklistPaths.js). On this form the APPLICANT is the checklist's client, stored under petitioner.* - there is no separate beneficiary.
// Stems are exact PDF field names (case-insensitive, without "[n]"); an index restriction separates the boxes of one name that belong to different people / rows.
//
// Left to the case manager, on purpose (nothing collects it, or the box is not the applicant's own fact): the eligibility basis (Part 1), the Yes / No good-moral-
// character and eligibility questions (Parts 9 / 12 - their labels in the PDF are not reliable enough to wire a yes or a no), race / ethnicity, height, other names
// used, the name-change request, dates written as month + year only, criminal-history rows, selective service, the interpreter and the preparer, signatures, and
// the additional-information pages.
const R = (to, stems, options = {}) => ({ to, stems: [].concat(stems), ...options });
const a = (part) => ({ type: "address", part });
const rowOf = (collection, index, itemPath, extra = {}) => ({ type: "arrayItem", collection, index, itemPath, ...extra });

// one composite address (checklist "mailing address") spread over the boxes of an address block
const addr = (path, names) => {
  const [street, unit, unitNumber, city, state, zip, province, postal, country] = names;
  return [
    R(path, street, { transform: a("street") }),
    // N-400 lists the unit boxes as Floor, Suite, Apartment
    R(path, unit, { index: 0, box: true, transform: a("unitFlr") }),
    R(path, unit, { index: 1, box: true, transform: a("unitSte") }),
    R(path, unit, { index: 2, box: true, transform: a("unitApt") }),
    R(path, unitNumber, { transform: a("unitNumber") }),
    R(path, city, { transform: a("city") }),
    R(path, state, { transform: a("state") }),
    R(path, zip, { transform: a("zip") }),
    R(path, province, { transform: a("province") }),
    R(path, postal, { transform: a("postalCode") }),
    R(path, country, { transform: a("country") }),
  ];
};

const EYE = ["Brown", "Blue", "Green", "Hazel", "Gray", "Black", "Pink", "Maroon", "Unknown / Other"];
const HAIR = ["Bald (No hair)", "Sandy", "Red", "White", "Gray", "Blond", "Brown", "Black", "Unknown / Other"];

const N400_RULES = [
  // ---- the applicant's A-Number (the header of every page repeats it) ----
  R("petitioner.aNumber", "Line1_AlienNumber", { transform: { type: "digits" } }),

  // ---- Part 2: about you ----
  R("petitioner.lastName", "P2_Line1_FamilyName"),
  R("petitioner.firstName", "P2_Line1_GivenName"),
  R("petitioner.middleName", "P2_Line1_MiddleName"),
  R("petitioner.uscisOnlineAccountNumber", "P2_Line6_USCISELISAcctNumber", { transform: { type: "digits" } }),
  R("petitioner.gender", "P2_Line7_Gender", { index: 0, checkboxEquals: "Male", ignoreCase: true }),
  R("petitioner.gender", "P2_Line7_Gender", { index: 1, checkboxEquals: "Female", ignoreCase: true }),
  R("petitioner.dateOfBirth", "P2_Line8_DateOfBirth"),
  R("petitioner.dateBecameLpr", "P2_Line9_DateBecamePermanentResident"),
  R("petitioner.countryOfBirth", "P2_Line10_CountryOfBirth", { transform: { type: "country" } }),
  R("petitioner.countryOfCitizenship", "P2_Line11_CountryOfNationality", { transform: { type: "country" } }),
  R("petitioner.ssn", "Line12b_SSN", { transform: { type: "digits" } }),

  // ---- Part 3 (physical description) ----
  R("petitioner.weight", "P7_Line4_Pounds1", { transform: { type: "digitAt", pad: 3, index: 0 } }),
  R("petitioner.weight", "P7_Line4_Pounds2", { transform: { type: "digitAt", pad: 3, index: 1 } }),
  R("petitioner.weight", "P7_Line4_Pounds3", { transform: { type: "digitAt", pad: 3, index: 2 } }),
  ...EYE.map((color, index) => R("petitioner.eyeColor", "P7_Line5_Eye", { index, checkboxEquals: color, ignoreCase: true })),
  ...HAIR.map((color, index) => R("petitioner.hairColor", "P7_Line6_Hair", { index, checkboxEquals: color, ignoreCase: true })),

  // ---- Part 4: where you live now (the first address of the residential history) ----
  R("petitioner.residentialHistory", "P4_Line1_StreetName", { transform: rowOf("petitioner.residentialHistory", 0, "streetAndNumber") }),
  R("petitioner.residentialHistory", "P4_Line1_City", { transform: rowOf("petitioner.residentialHistory", 0, "city") }),
  R("petitioner.residentialHistory", "P4_Line1_State", { index: 0, transform: rowOf("petitioner.residentialHistory", 0, "stateProvince") }),
  R("petitioner.residentialHistory", "P4_Line1_Country", { transform: rowOf("petitioner.residentialHistory", 0, "country") }),
  // ...and the three addresses before it (rows 2-4), as they were asked on the first page of Part 4
  ...[1, 2, 3].flatMap((n) => [
    R("petitioner.residentialHistory", `P4_Line3_PhysicalAddress${n}`, { transform: rowOf("petitioner.residentialHistory", n, "streetAndNumber") }),
    R("petitioner.residentialHistory", `P4_Line3_CityTown${n}`, { transform: rowOf("petitioner.residentialHistory", n, "city") }),
    R("petitioner.residentialHistory", `P4_Line3_State${n}`, { transform: rowOf("petitioner.residentialHistory", n, "stateProvince") }),
    R("petitioner.residentialHistory", `P4_Line3_Country${n}`, { transform: rowOf("petitioner.residentialHistory", n, "country") }),
  ]),

  // ---- Part 5: mailing address ----
  // (the mailing address's State box is named like the residence one: it is the SECOND box of that name)
  ...addr("petitioner.mailingAddress", ["P5_Line1b_StreetName", "P5_Line1b_Unit", "P5_Line1b_Number", "P5_Line1b_City", "P4_Line1_State", "P5_Line1b_ZipCode", "P5_Line1b_Province", "P5_Line1b_PostalCode", "P5_Line1b_Country"])
    .map((rule) => (rule.stems[0] === "P4_Line1_State" ? { ...rule, index: 1 } : rule)),

  // ---- Part 10: marital history ----
  R("petitioner.maritalStatus", "P10_Line1_MaritalStatus", { index: 1, checkboxEquals: "Single, Never Married", ignoreCase: true }),
  R("petitioner.maritalStatus", "P10_Line1_MaritalStatus", { index: 3, checkboxEquals: "Married", ignoreCase: true }),
  R("petitioner.maritalStatus", "P10_Line1_MaritalStatus", { index: 0, checkboxEquals: "Divorced", ignoreCase: true }),
  R("petitioner.maritalStatus", "P10_Line1_MaritalStatus", { index: 2, checkboxEquals: "Widowed", ignoreCase: true }),
  R("petitioner.maritalStatus", "P10_Line1_MaritalStatus", { index: 4, checkboxEquals: "Marriage Annulled", ignoreCase: true }),
  R("petitioner.maritalStatus", "P10_Line1_MaritalStatus", { index: 5, checkboxEquals: "Separated", ignoreCase: true }),
  R("petitioner.currentSpouse.lastName", "P10_Line4a_FamilyName"),
  R("petitioner.currentSpouse.firstName", "P10_Line4a_GivenName"),
  R("petitioner.currentSpouse.middleName", "P10_Line4a_MiddleName"),
  R("petitioner.currentSpouse.dateOfBirth", "P10_Line4d_DateofBirth"),
  R("petitioner.currentSpouse.marriageDate", "P10_Line4e_DateEnterMarriage"),
  R("petitioner.currentSpouse.employerCompany", ["P10_Line4g_Employer", "TextField1"]),
  R("petitioner.currentSpouse.isUsCitizen", "P10_Line5_Citizen", { index: 1, checkbox: true }),
  R("petitioner.currentSpouse.isUsCitizen", "P10_Line5_Citizen", { index: 0, checkbox: false }),
  R("petitioner.currentSpouse.dateBecameUsCitizen", "P10_Line5b_DateBecame"),
  R("petitioner.currentSpouse.inArmedForces", "P7_Line2_Forces", { index: 1, checkbox: true }),
  R("petitioner.currentSpouse.inArmedForces", "P7_Line2_Forces", { index: 0, checkbox: false }),

  // ---- Part 11: children ----
  R("petitioner.totalNumberOfChildren", "P11_Line1_TotalChildren"),

  // ---- Part 7: employment (the first three employers of the history) ----
  ...[1, 2, 3].flatMap((n) => {
    const row = n - 1;
    const employerAddress = (part) => rowOf("petitioner.employmentHistory", row, "employerAddress", { addressPart: part });
    return [
      R("petitioner.employmentHistory", `P5_EmployerName${n}`, { transform: rowOf("petitioner.employmentHistory", row, "employerName") }),
      R("petitioner.employmentHistory", `P7_OccupationFieldStudy${n}`, { index: 2, transform: rowOf("petitioner.employmentHistory", row, "occupation") }),
      R("petitioner.employmentHistory", `P7_City${n}`, { transform: employerAddress("city") }),
      R("petitioner.employmentHistory", `P7_State${n}`, { transform: employerAddress("state") }),
      R("petitioner.employmentHistory", `P7_ZipCode${n}`, { transform: employerAddress("zip") }),
      R("petitioner.employmentHistory", `P7_Country${n}`, { transform: employerAddress("country") }),
    ];
  }),

  // ---- Part 8: trips outside the United States (the first six) ----
  ...[1, 2, 3, 4, 5, 6].flatMap((n) => [
    R("petitioner.travelHistory", `P8_Line1_DateLeft${n}`, { transform: rowOf("petitioner.travelHistory", n - 1, "dateLeftUS", { format: "mm/dd/yyyy" }) }),
    R("petitioner.travelHistory", `P8_Line1_DateReturn${n}`, { transform: rowOf("petitioner.travelHistory", n - 1, "dateReturnedUS", { format: "mm/dd/yyyy" }) }),
    R("petitioner.travelHistory", n === 1 ? "P9_Line1_Countries1" : `P8_Line1_Countries${n}`, { transform: rowOf("petitioner.travelHistory", n - 1, "countriesVisited") }),
  ]),

  // ---- Part 13: the applicant's contact details ----
  // These three boxes are worded "the Applicant's ..." and the generic contract reads that as the beneficiary side, while the N-400 checklist stores the applicant
  // under petitioner.*: the beneficiary path is the primary source and the checklist's own petitioner path is the fallback, so the answer still fills.
  R("beneficiary.primaryPhone", "P12_Line3_Telephone", { transform: { type: "phone" }, fallback: "petitioner.phone" }),
  R("beneficiary.mobilePhone", "P12_Line3_Mobile", { transform: { type: "phone" }, fallback: "petitioner.mobilePhone" }),
  R("beneficiary.email", "P12_Line5_Email", { fallback: "petitioner.email" }),
];

module.exports = { N400_RULES };
