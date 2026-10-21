// Form I-751 (Petition to Remove Conditions on Residence): every box a fact of the conditional resident, the spouse and the children can fill, wired to the generic
// canonical paths the permanent-resident checklists write (canonical/config/partyChecklistPaths*.js: the I-90 "mailingAddressDetail / physicalAddressDetail /
// cardExpirationDate / height / weight / race / ethnicity" family, the N-400 spouse and children answers). The petitioner of this single-party case is the
// conditional resident, so the applicant is petitioner.*; the spouse or former spouse is petitioner.currentSpouse.*; the children are petitioner.children.
// Stems are exact PDF field names (case-insensitive, without "[n]"); an index restriction separates the boxes of one name that belong to different people / rows.
//
// Left to the case manager, on purpose (nothing collects it, or the answer is a judgement the generic facts cannot make): the basis for filing (Parts 3-4
// checkboxes), every Yes / No question (Items 16-23 of Part 1 other than the physical-address question, and the children's Yes / No boxes), other names used, the
// children's A-Numbers, the accommodation request, the interpreter and the preparer, signatures and the additional-information pages.
const R = (to, stems, options = {}) => ({ to, stems: [].concat(stems), ...options });
const COUNTRY = { transform: { type: "country" } };
const STATE = { transform: { type: "usState" } };
const DIGITS = { transform: { type: "digits" } };
const PHONE = { transform: { type: "phone" } };
const TEXT = { transform: { type: "string" } };
const rowOf = (collection, index, itemPath, extra = {}) => ({ type: "arrayItem", collection, index, itemPath, ...extra });
const CASE = { ignoreCase: true };

// one address block read from the checklist's separate address answers (line1 / unit type / unit number / city / state / zip): street, Apt / Ste / Flr boxes,
// unit number, city, state, ZIP
const detailAddress = (base, names) => {
  const [street, unit, unitNumber, city, state, zip] = names;
  return [
    R(`${base}.line1`, street),
    R(`${base}.unitType`, unit, { index: 0, checkboxEquals: "apartment", ...CASE }),
    R(`${base}.unitType`, unit, { index: 1, checkboxEquals: "suite", ...CASE }),
    R(`${base}.unitType`, unit, { index: 2, checkboxEquals: "floor", ...CASE }),
    R(`${base}.unitNumber`, unitNumber),
    R(`${base}.city`, city),
    R(`${base}.state`, state, STATE),
    R(`${base}.zip`, zip),
  ];
};

// an address spread over the boxes of a block from ONE free-text answer of a row (a child's current address)
const rowAddress = (collection, index, item, names) => {
  const part = (name) => ({ transform: rowOf(collection, index, item, { addressPart: name }) });
  const [street, city, state, zip, province, postal, country] = names;
  return [
    R(collection, street, part("street")),
    R(collection, city, part("city")),
    R(collection, state, part("state")),
    R(collection, zip, part("zip")),
    R(collection, province, part("province")),
    R(collection, postal, part("postalCode")),
    R(collection, country, part("country")),
  ];
};

const CHILDREN = "petitioner.children";
// a child's name and date of birth (Part 5)
const child = (index, family, given, middle, dob, familyIndex) => {
  const at = familyIndex === undefined ? {} : { index: familyIndex };
  return [
    R(CHILDREN, family, { ...at, transform: rowOf(CHILDREN, index, "lastName") }),
    R(CHILDREN, given, { ...at, transform: rowOf(CHILDREN, index, "firstName") }),
    R(CHILDREN, middle, { ...at, transform: rowOf(CHILDREN, index, "middleName") }),
    R(CHILDREN, dob, { ...at, transform: rowOf(CHILDREN, index, "dateOfBirth", { format: "mm/dd/yyyy" }) }),
  ];
};
const childAddress = (index, prefix) => rowAddress(CHILDREN, index, "currentAddress", ["StreetNumberName", "CityOrTown", "State", "ZipCode", "Province", "PostalCode", "Country"].map((name) => `${prefix}_${name}`));

const SPOUSE = "petitioner.currentSpouse";
const EYE = ["Blue", "Green", "Hazel", "Pink", "Maroon", "Brown", "Black", "Unknown / Other", "Gray"];
const HAIR = ["Bald (No hair)", "Blond", "Gray", "Sandy", "Unknown / Other", "White", "Red", "Brown", "Black"];
const RACE = [["White", "white"], ["Asian", "asian"], ["Black", "black_or_african_american"], ["Indian", "american_indian_or_alaska_native"], ["Hawaiian", "native_hawaiian_or_other_pacific_islander"]];

const I751_RULES = [
  // ---- Part 1: the conditional resident ----
  R("petitioner.lastName", "Pt1Line1a_FamilyName"),
  R("petitioner.firstName", "Pt1Line1b_GivenName"),
  R("petitioner.middleName", "Pt1Line1c_MiddleName"),
  R("petitioner.dateOfBirth", "P1_Line4_DateOfBirth"),
  R("petitioner.countryOfBirth", "P1_Line5_CountryOfBirth", COUNTRY),
  R("petitioner.countryOfCitizenship", "P1_Line6_CountryOfCitizenship", COUNTRY),
  R("petitioner.aNumber", "P1_Line7_AlienNumber", DIGITS),
  R("petitioner.ssn", "P1_Line8_SSN", DIGITS),
  R("petitioner.uscisOnlineAccountNumber", "P1_Line9_AcctIdentifier", DIGITS),
  // Item 10: marital status
  R("petitioner.maritalStatus", "Part1_Line10_MaritalStatus", { index: 0, checkboxEquals: "Married", ...CASE }),
  R("petitioner.maritalStatus", "Part1_Line10_MaritalStatus", { index: 1, checkboxEquals: "Widowed", ...CASE }),
  R("petitioner.maritalStatus", "Part1_Line10_MaritalStatus", { index: 2, checkboxEquals: "Single, Never Married", ...CASE }),
  R("petitioner.maritalStatus", "Part1_Line10_MaritalStatus", { index: 3, checkboxEquals: "Divorced", ...CASE }),
  R(`${SPOUSE}.marriageDate`, "P1_Line11_DateOfMarriage"),
  R(`${SPOUSE}.marriagePlace`, "P1_Line12_PlaceOfMarriage"),
  R("petitioner.marriageEndDate", "P1_Line13_DateMarriageEnded"),
  R("petitioner.cardExpirationDate", "P1_Line14_CRExpiresOn"),
  // Item 15: mailing address (a U.S. address on this form)
  ...detailAddress("petitioner.mailingAddressDetail", ["Line17b_Street_Number_Name", "Line17c_Unit", "Line17c_Apt_Ste_Flr_Number", "Line17d_City_Town", "Pt1Line15e_State", "Pt1Line15f_ZipCode"]),
  // Item 16: is the physical address different? ([0] No, [1] Yes) - Item 17 is that physical address
  R("petitioner.physicalAddressDifferent", "Line16_Checkbox", { index: 1, checkbox: true }),
  R("petitioner.physicalAddressDifferent", "Line16_Checkbox", { index: 0, checkbox: false }),
  ...detailAddress("petitioner.physicalAddressDetail", ["Pt1Line17_StreetNumberName", "Pt1Line17_Unit", "Pt1Line17_AptSteFlrNumber", "Pt1Line17_CityOrTown", "Pt1Line17_State", "Pt1Line17_ZipCode"]),

  // ---- Part 3 (biographic information) ----
  R("petitioner.ethnicity", "P3_checkbox6", { index: 0, checkboxEquals: "not_hispanic_or_latino", ...CASE }),
  R("petitioner.ethnicity", "P3_checkbox6", { index: 1, checkboxEquals: "hispanic_or_latino", ...CASE }),
  ...RACE.map(([box, value]) => R("petitioner.race", `P3_checkbox7_${box}`, { checkboxEquals: value, ...CASE })),
  R("petitioner.heightFeet", "P3_Line8_HeightFeet", TEXT),
  R("petitioner.heightInches", "P3_Line8_HeightInches", TEXT),
  // weight: three one-digit boxes, zero-padded on the left (the boxes are named ...HeightInches1-3 but ask for the weight in pounds)
  R("petitioner.weightPounds", "P3_Line9_HeightInches1", { transform: { type: "digitAt", pad: 3, index: 0 } }),
  R("petitioner.weightPounds", "P3_Line9_HeightInches2", { transform: { type: "digitAt", pad: 3, index: 1 } }),
  R("petitioner.weightPounds", "P3_Line9_HeightInches3", { transform: { type: "digitAt", pad: 3, index: 2 } }),
  ...EYE.map((color, index) => R("petitioner.eyeColor", "P3_checkbox10", { index, checkboxEquals: color, ...CASE })),
  ...HAIR.map((color, index) => R("petitioner.hairColor", "P3_checkbox11", { index, checkboxEquals: color, ...CASE })),

  // ---- Part 4: the spouse or former spouse ----
  R(`${SPOUSE}.lastName`, "Pt4Line2a_FamilyName2"),
  R(`${SPOUSE}.firstName`, "Pt4Line2b_GivenName2"),
  R(`${SPOUSE}.middleName`, "Pt4Line2c_MiddleName2"),
  R(`${SPOUSE}.dateOfBirth`, "Line3_DateOfBirth"),
  R(`${SPOUSE}.ssn`, "Line4_SSN", DIGITS),
  R(`${SPOUSE}.aNumber`, "Line5_AlienNumber", { ...DIGITS, pages: [3] }),
  R(`${SPOUSE}.address.line1`, "Pt4Line6_StreetNumberName"),
  R(`${SPOUSE}.address.line2`, "Pt4Line6_AptSteFlrNumber"),
  R(`${SPOUSE}.address.city`, "Pt4Line6_CityOrTown"),
  R(`${SPOUSE}.address.state`, "Pt4Line6_State", STATE),
  R(`${SPOUSE}.address.zip`, "Pt4Line6_ZipCode"),
  R(`${SPOUSE}.address.state`, "Pt4Line6_Province", { transform: { type: "nonUsProvince", countryPath: `${SPOUSE}.address.country` } }),
  R(`${SPOUSE}.address.postalCode`, "Pt4Line6_PostalCode"),
  R(`${SPOUSE}.address.country`, "Pt4Line6_Country", COUNTRY),

  // ---- Part 5: the children (up to five) ----
  ...child(0, "Line1a_FamilyName3", "Line1b_GivenName3", "Line1c_MiddleName3", "Line2_DateOfBirth2"),
  ...[1, 2, 3, 4].flatMap((row) => child(row, "Line13a_FamilyName", "Line13b_GivenName", "Line13c_MiddleName", "Line14_DateOfBirth", row - 1)),
  ...childAddress(0, "Pt5Line6"),
  ...childAddress(1, "Pt5Line12"),
  ...childAddress(2, "Pt5Line18"),
  ...childAddress(3, "Pt5Line24"),
  ...childAddress(4, "Pt5Line30"),

  // ---- the petitioner's contact details (the spouse's own are not collected) ----
  R("petitioner.phone", "P5_Line3_DaytimePhoneNumber", { index: 0, ...PHONE }),
  R("petitioner.mobilePhone", "P5_Line4_MobilePhoneNumber", { index: 0, ...PHONE }),
  R("petitioner.email", "P5_Line5_EmailAddress", { index: 0 }),
];

module.exports = { I751_RULES };
