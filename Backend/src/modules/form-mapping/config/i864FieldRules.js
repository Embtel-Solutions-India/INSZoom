// Form I-864 (Affidavit of Support): every box that asks for a fact the sponsor / principal-immigrant checklists collect, wired to the generic canonical paths those
// checklists write (canonical/config/partyChecklistPaths.js: I864_PETITIONER and the beneficiary.* family paths). The SPONSOR (Part 4, field names P4_*) is the
// petitioner.*; the PRINCIPAL IMMIGRANT (Part 2, P2_*) is the beneficiary.*. Stems are exact PDF field names (case-insensitive, without "[n]"); a page / index
// restriction is used wherever the same name is reused for a different person.
//
// Left to the case manager, on purpose (no canonical fact says it, or it is not the sponsor's / immigrant's own): the basis-for-filing choices (Part 1), the
// attorney / representative block, the sponsored family members (Part 3 rows 2+), household rows 2-4, the household-size counts, assets of the immigrant,
// tax-year labels, signature / date-signed boxes, the interpreter and the preparer, and the additional-information pages.
const R = (to, stems, options = {}) => ({ to, stems: [].concat(stems), ...options });

// one address block: every box of an Apt / Ste / Flr + street + city + state + ZIP + province + postal code + country row, taken from ONE composite address answer
const addr = (path, prefix, names) => {
  const a = (part) => ({ type: "address", part });
  const [street, unit, unitNumber, city, state, zip, province, postal, country] = names.map((name) => `${prefix}${name}`);
  return [
    R(path, street, { transform: a("street") }),
    R(path, unit, { index: 0, box: true, transform: a("unitApt") }),
    R(path, unit, { index: 1, box: true, transform: a("unitSte") }),
    R(path, unit, { index: 2, box: true, transform: a("unitFlr") }),
    R(path, unitNumber, { transform: a("unitNumber") }),
    R(path, city, { transform: a("city") }),
    R(path, state, { transform: a("state") }),
    R(path, zip, { transform: a("zip") }),
    R(path, province, { transform: a("province") }),
    R(path, postal, { transform: a("postalCode") }),
    R(path, country, { transform: a("country") }),
  ];
};

const I864_RULES = [
  // ---- Part 4: the sponsor ----
  R("petitioner.lastName", "P4_Line1a_FamilyName"),
  R("petitioner.firstName", "P4_Line1b_GivenName"),
  R("petitioner.middleName", "P4_Line1c_MiddleName"),
  ...addr("petitioner.mailingAddress", "P4_", ["Line2b_StreetNumberName", "Line2c_Unit", "Line2d_AptSteFlrNumber", "Line2e_CityOrTown", "Line2f_State", "Line2g_ZipCode", "Line2h_Province", "Line2i_PostalCode", "Line2j_Country"]),
  R("petitioner.physicalAddressSameAsMailing", "P1_Line3_Checkbox", { index: 0, checkbox: true }),
  R("petitioner.physicalAddressSameAsMailing", "P1_Line3_Checkbox", { index: 1, checkbox: false }),
  ...addr("petitioner.physicalAddress", "P4_", ["Line4a_StreetNumberName", "Line4b_Unit", "Line4c_AptSteFlrNumber", "Line4d_CityOrTown", "Line4e_State", "Line4f_ZipCode", "Line4g_Province", "Line4h_PostalCode", "Line4i_Country"]),
  R("petitioner.countryOfDomicile", "P4_Line5_CountryOfDomicile", { transform: { type: "country" } }),
  R("petitioner.dateOfBirth", "P4_Line6_DateOfBirth"),
  R("petitioner.cityTownOfBirth", "P4_Line7_CityofBirth"),
  R("petitioner.ssn", "P4_Line10_SocialSecurityNumber", { transform: { type: "digits" } }),
  R("petitioner.immigrationStatus", "P4_Line11a_Checkbox", { checkboxEquals: "U.S. Citizen" }),
  R("petitioner.immigrationStatus", "P4_Line11c_Checkbox", { checkboxEquals: "Green Card / LPR" }),
  R("petitioner.aNumber", "P4_Line12_AlienNumber", { transform: { type: "digits" } }),
  R("petitioner.uscisOnlineAccountNumber", "P4_Line13_AcctIdentifier", { transform: { type: "digits" } }),

  // ---- Part 1: how the sponsor is related to the immigrant (the explanation boxes) ----
  R("petitioner.relationshipToBeneficiary", ["P1_Line1b_Relationship", "P1_Line1c_Relationship", "P1_Line1f_Relationship"]),

  // ---- Part 2: the principal immigrant ----
  R("beneficiary.lastName", "P2_Line1a_FamilyName"),
  R("beneficiary.firstName", "P2_Line1b_GivenName"),
  R("beneficiary.middleName", "P2_Line1c_MiddleName"),
  ...addr("beneficiary.mailingAddress", "P2_Line2_", ["StreetNumberName", "Unit", "AptSteFlrNumber", "CityOrTown", "State", "ZipCode", "Province", "PostalCode", "Country"]),
  R("beneficiary.countryOfCitizenship", "P2_Line3_CountryCitizenship", { transform: { type: "country" } }),
  R("beneficiary.dateOfBirth", "P2_Line4_DateOfBirth"),
  R("beneficiary.alienRegistrationNumber", "P2_Line5_AlienNumber", { index: 0, transform: { type: "digits" } }),
  R("beneficiary.uscisOnlineAccountNumber", "Pt2_Line6_USCISOnlineAcctNumber", { transform: { type: "digits" } }),
  R("beneficiary.primaryPhone", "P2_Line7_DaytimePhoneNumber", { transform: { type: "phone" } }),

  // ---- Part 5: household ----
  R("petitioner.numberOfDependentChildren", "P5_Line4_DependentChildren"),
  R("petitioner.numberOfOtherDependents", "P5_Line5_OtherDependents"),

  // ---- Part 6: the sponsor's employment and income ----
  R("petitioner.occupation", "P6_Line1a_NameofEmployer"),
  R("petitioner.employer1", "P6_Line1a1_NameofEmployer"),
  R("petitioner.employer2", "P6_Line1a2_NameofEmployer"),
  R("petitioner.selfEmployedOccupation", "P6_Line4a_SelfEmployedAs"),
  R("petitioner.income.currentAnnual", "P6_Line2_TotalIncome"),
  // household member (Items 8): the one household member the checklist collects
  R("petitioner.householdMember.fullName", "P6_Line3_Name"),
  R("petitioner.householdMember.relationship", "P6_Line4_Relationship"),
  R("petitioner.householdMember.income", "P6_Line5_CurrentIncome"),
  // income from the last three tax returns (the tax-year labels are not collected)
  R("petitioner.income.taxYear1", "P6_Line19a_TotalIncome"),
  R("petitioner.income.taxYear2", "P6_Line19b_TotalIncome"),
  R("petitioner.income.taxYear3", "P6_Line19c_TotalIncome"),

  // ---- Part 7: the sponsor's assets ----
  R("petitioner.assets.savingsAndChecking", "P7_Line1_BalanceofAccounts"),
  R("petitioner.assets.realEstateNetCashValue", "P7_Line2_RealEstate"),
  R("petitioner.assets.stocksBondsNetCashValue", "P7_Line3_StocksBonds"),

  // ---- Part 8: the sponsor's contact details ----
  R("petitioner.phone", "P8_Line3_DaytimeTelephoneNumber", { transform: { type: "phone" } }),
  R("petitioner.email", "P7Line7_EmailAddress"),
];

module.exports = { I864_RULES };
