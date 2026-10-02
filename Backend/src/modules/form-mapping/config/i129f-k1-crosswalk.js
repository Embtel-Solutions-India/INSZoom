// Canonical -> I-129F (K-1 fiancé(e) / K-3 spouse petition) field crosswalk,
// authored against the real bundled I-129F PDF (Backend/dev-assets/uscis/
// i-129f_2025-01-20.pdf). Every widget's meaning below was read from that
// PDF's own tooltip text (e.g. "Part 1. Information About You. Your Mailing
// Address. 8. B. Enter Street Number and Name.") and every checkbox index /
// onValue from pdf-lib - not inferred from the widget's name or position.
//
// ROLES. On I-129F "Part 1" is the PETITIONER ("Information About You") and
// "Part 2" the BENEFICIARY. Every Part 1 widget is therefore wired ONLY to a
// petitioner_* question key and every Part 2 widget ONLY to a beneficiary_*
// key (family-crosswalk-helpers.js documents why that makes cross-role
// contamination structurally impossible; i129f-k1-crosswalk-coverage.test.js
// and family-role-mapping.test.js assert it for every edge).
//
// SOURCES. family-workflow/questionnaires/k1.js (reused verbatim by k3.js, so
// the SAME keys serve K-1 and K-3) has no canonicalPath mechanism for most
// fields, so every edge reads raw.questionnaireAnswers.<key>.value[.<row>.
// <column>] - the key being the fieldCatalog() path with dots replaced by
// underscores (what familyChecklists.js builds each question's key from).
//
// DECISIONS (also see MANUAL_ENTRY_REASONS below):
//  - Free-text address answers are split by AddressParser (never guesses:
//    an unparseable part stays blank for the case manager).
//  - Repeating groups feed the form's fixed slots in the order the client
//    entered them (USCIS instructions: current/most recent first): residence
//    rows 1-2 -> "Physical Address One/Two", employment rows 1-2 ->
//    "Employer One/Two", prior-spouse row 1 -> the single prior-spouse slot.
//  - "Parent One" is the father and "Parent Two" the mother - the checklist
//    asks for them as "Father's ..."/"Mother's ...", which also fixes the sex
//    boxes (Parent One Male / Parent Two Female) once that parent is named.
//  - A Yes/No box is ticked only when the answer supports it ("No" for
//    "previously married" only when marital status is single; "Yes" when a
//    prior spouse is listed or status is widowed/divorced). Otherwise both
//    stay blank rather than guessing.
//  - K-1-only / K-3-only boxes are keyed off case.visaType.
const {
  answerPath, petitionerKey, beneficiaryKey, widget, text, date, digits, edge, checkbox, checkboxWhen, addressBlock,
  exists, empty, equals, isIn, all, any, visaIs, VISA_K1, VISA_K3, BOOLEAN,
} = require("./family-crosswalk-helpers");

const FORM_CODE = "I-129F";
const VERSION = "2025-01-20";

const USCIS_USE_ONLY_PATTERNS = [/PDF417BarCode/];

const P = (path, sub) => answerPath(petitionerKey(path), sub);
const B = (path, sub) => answerPath(beneficiaryKey(path), sub);

const MARITAL = { widowed: 0, divorced: 1, single: 2, married: 3 }; // /W /D /S /M on Pt1Line23 and Pt2Line6 (verified via pdf-lib + tooltips)
const FLOOR_APT_SUITE = { flr: 0, apt: 1, ste: 2 };
const SUITE_FLOOR_APT = { ste: 0, flr: 1, apt: 2 };
const APT_FLOOR_SUITE = { apt: 0, flr: 1, ste: 2 };

function unitWidgets(sf, name, order) {
  return { apt: widget(sf, name, order.apt), ste: widget(sf, name, order.ste), flr: widget(sf, name, order.flr) };
}

// A residence-history ROW (structured columns) -> one "Physical Address" block.
function residenceRow({ sf, key, i, prefix, unitOrder, from, to, note }) {
  const row = (col) => answerPath(key, `${i}.${col}`);
  const w = (name) => widget(sf, `${prefix}_${name}`);
  const edges = [
    ...addressBlock({
      source: row("streetAndNumber"), rows: true, note,
      fields: { street: w("StreetNumberName"), unitNumber: w("AptSteFlrNumber") },
      unit: unitWidgets(sf, `${prefix}_Unit`, unitOrder),
    }),
    text(w("CityOrTown"), row("city"), `${note} - city or town`),
    edge(w("State"), row("provinceState"), `${note} - state (US rows only)`, { transform: { type: "usState", countryPath: row("country") } }),
    edge(w("Province"), row("provinceState"), `${note} - province (non-US rows only)`, { transform: { type: "nonUsProvince", countryPath: row("country") } }),
    edge(w("Country"), row("country"), `${note} - country`, { transform: { type: "country" } }),
  ];
  if (from) edges.push(date(widget(from.sf ?? sf, from.name), row("from"), `${note} - date from`));
  if (to) edges.push(date(widget(to.sf ?? sf, to.name), row("to"), `${note} - date to (left to the form's PRESENT default when blank)`));
  return edges;
}

// An employment-history ROW -> one "Employer" block (name, free-text address, occupation, dates).
function employerRow({ sf, key, i, nameWidget, addrPrefix, addrSf, unitOrder, occupationWidget, from, to, note }) {
  const row = (col) => answerPath(key, `${i}.${col}`);
  const aw = (name) => widget(addrSf ?? sf, `${addrPrefix}_${name}`);
  return [
    text(widget(nameWidget.sf ?? sf, nameWidget.name), row("employerName"), `${note} - employer name`),
    ...addressBlock({
      source: row("employerAddress"), note: `${note} - employer address`,
      fields: {
        street: aw("StreetNumberName"), unitNumber: aw("AptSteFlrNumber"), city: aw("CityOrTown"), state: aw("State"),
        zip: aw("ZipCode"), province: aw("Province"), postalCode: aw("PostalCode"), country: aw("Country"),
      },
      unit: unitWidgets(addrSf ?? sf, `${addrPrefix}_Unit`, unitOrder),
    }),
    text(widget(occupationWidget.sf ?? sf, occupationWidget.name), row("occupation"), `${note} - occupation`),
    date(widget(from.sf ?? sf, from.name), row("from"), `${note} - employment start date`),
    date(widget(to.sf ?? sf, to.name), row("to"), `${note} - employment end date`),
  ];
}

// Father -> "Parent One", mother -> "Parent Two" (see DECISIONS).
function parentBlock({ party, sf, who, family, given, middle, dob, sexCheckbox, sexIndex, countryOfBirth, cityResidence, countryResidence, note }) {
  const key = (name) => (party === "petitioner" ? P : B)(`parents_${who}${name}`);
  const sex = who === "father" ? "Male" : "Female";
  return [
    text(widget(sf, family), key("LastName"), `${note} - family name`),
    text(widget(sf, given), key("FirstName"), `${note} - given name`),
    text(widget(sf, middle), key("MiddleName"), `${note} - middle name`),
    date(widget(sf, dob), key("DateOfBirth"), `${note} - date of birth`),
    checkboxWhen(widget(sf, sexCheckbox, sexIndex), key("LastName"), any(exists(key("LastName")), exists(key("FirstName"))), `${note} - sex ${sex} (implied by the "${who === "father" ? "Father's" : "Mother's"}" checklist block, once that parent is named)`, { fallback: key("FirstName") }),
    text(widget(sf, countryOfBirth), key("CountryOfBirth"), `${note} - country of birth`),
    text(widget(sf, cityResidence), key("CityTownVillageOfResidence"), `${note} - city/town/village of residence`),
    text(widget(sf, countryResidence), key("CountryOfResidence"), `${note} - country of residence`),
  ];
}

// "Has ... ever been previously married?" Yes / No.
function previouslyMarried({ party, sf, name, note }) {
  const A = party === "petitioner" ? P : B;
  const status = A("info_maritalStatus");
  const priorRow = A("priorSpouses", "0.lastName");
  const priorRowFirst = A("priorSpouses", "0.firstName");
  return [
    checkboxWhen(widget(sf, name, 0), status, any(isIn(status, ["widowed", "divorced"]), exists(priorRow), exists(priorRowFirst)), `${note} - Yes (widowed/divorced, or a prior spouse is listed)`),
    checkboxWhen(widget(sf, name, 1), status, all(equals(status, "single"), empty(priorRow), empty(priorRowFirst)), `${note} - No (single, no prior spouse listed)`),
  ];
}

function yesNo(sf, name, source, note, yesIndex = 0, noIndex = 1) {
  return [
    checkbox(widget(sf, name, yesIndex), source, "Yes", `${note} - Yes`),
    checkbox(widget(sf, name, noIndex), source, "No", `${note} - No`),
  ];
}

const MAPPED_EDGES = [
  // ===================== PART 1: PETITIONER (pages 1-4) =====================
  checkbox(widget(0, "Pt1Line4a_Checkboxes", 0), "case.visaType", VISA_K1, "Item 4.A, classification sought - Fiancé(e) (K-1 visa). Keyed off the case's visa type."),
  checkbox(widget(0, "Pt1Line4a_Checkboxes", 1), "case.visaType", VISA_K3, "Item 4.B, classification sought - Spouse (K-3 visa). Keyed off the case's visa type."),
  digits(widget(0, "Pt1Line1_AlienNumber"), P("info_aNumber"), "Item 1, petitioner A-Number (digits only: the widget is 9 characters with 'A-' pre-printed)."),
  text(widget(0, "Pt1Line2_AcctIdentifier"), P("info_uscisOnlineAccountNumber"), "Item 2, petitioner USCIS Online Account Number."),
  digits(widget(0, "Pt1Line3_SSN"), P("info_ssn"), "Item 3, petitioner SSN (digits only: the widget is 9 characters)."),
  text(widget(0, "Pt1Line6a_FamilyName"), P("info_lastName"), "Item 6.A, petitioner family name."),
  text(widget(0, "Pt1Line6b_GivenName"), P("info_firstName"), "Item 6.B, petitioner given name."),
  text(widget(0, "Pt1Line6c_MiddleName"), P("info_middleName"), "Item 6.C, petitioner middle name."),

  // Item 8: petitioner mailing address (one free-text answer).
  ...addressBlock({
    source: P("info_fullMailingAddress"), note: "Item 8, petitioner mailing address",
    fields: {
      street: widget(0, "Pt1Line8_StreetNumberName"), unitNumber: widget(0, "Pt1Line8_AptSteFlrNumber"), city: widget(0, "Pt1Line8_CityOrTown"),
      state: widget(0, "Pt1Line8_State"), zip: widget(0, "Pt1Line8_ZipCode"), province: widget(0, "Pt1Line8_Province"),
      postalCode: widget(0, "Pt1Line8_PostalCode"), country: widget(0, "Pt1Line8_Country"),
    },
    unit: unitWidgets(0, "Pt1Line8_Unit", FLOOR_APT_SUITE),
  }),
  checkboxWhen(widget(0, "Pt1Line8j_Checkboxes", 0), P("info_fullMailingAddress"), all(exists(P("info_fullMailingAddress")), empty(P("info_fullPhysicalAddress"))), "Item 8.J - mailing address is the same as the physical address (no separate physical address answered)."),
  checkboxWhen(widget(0, "Pt1Line8j_Checkboxes", 1), P("info_fullPhysicalAddress"), exists(P("info_fullPhysicalAddress")), "Item 8.J - mailing address differs from the physical address (a separate physical address was answered)."),

  // Items 9-12: physical addresses (residence history rows 1-2).
  ...residenceRow({ sf: 1, key: petitionerKey("residentialHistory"), i: 0, prefix: "Pt1Line9", unitOrder: FLOOR_APT_SUITE, from: { name: "Pt1Line10a_DateFrom" }, to: { name: "Pt1Line10b_ToFrom" }, note: "Items 9-10, petitioner Physical Address One (residence history row 1)" }),
  ...residenceRow({ sf: 1, key: petitionerKey("residentialHistory"), i: 1, prefix: "Pt1Line11", unitOrder: FLOOR_APT_SUITE, from: { name: "Pt1Line12a_DateFrom" }, to: { name: "Pt1Line12b_ToFrom" }, note: "Items 11-12, petitioner Physical Address Two (residence history row 2)" }),

  // Items 13-20: employment (employment history rows 1-2).
  ...employerRow({ sf: 1, key: petitionerKey("employmentHistory"), i: 0, nameWidget: { name: "Pt1Line13_NameofEmployer" }, addrPrefix: "Pt1Line14", unitOrder: FLOOR_APT_SUITE, occupationWidget: { name: "Pt1Line15_Occupation" }, from: { name: "Pt1Line16a_DateFrom" }, to: { name: "Pt1Line16b_ToFrom" }, note: "Items 13-16, petitioner Employer One (employment history row 1)" }),
  ...employerRow({ sf: 1, key: petitionerKey("employmentHistory"), i: 1, nameWidget: { name: "Pt1Line17_NameofEmployer" }, addrPrefix: "Pt1Line18", unitOrder: FLOOR_APT_SUITE, occupationWidget: { name: "Pt1Line19_Occupation" }, from: { sf: 2, name: "Pt1Line20a_DateFrom" }, to: { sf: 2, name: "Pt1Line20b_ToFrom" }, note: "Items 17-20, petitioner Employer Two (employment history row 2)" }),

  // Items 21-26: sex, DOB, marital status, birth.
  checkbox(widget(2, "Pt1Line21_Checkbox", 0), P("info_gender"), "Male", "Item 21, petitioner sex - Male. onValue /M verified via pdf-lib."),
  checkbox(widget(2, "Pt1Line21_Checkbox", 1), P("info_gender"), "Female", "Item 21, petitioner sex - Female. onValue /F verified via pdf-lib."),
  date(widget(2, "Pt1Line22_DateofBirth"), P("info_dateOfBirth"), "Item 22, petitioner date of birth."),
  ...Object.entries(MARITAL).map(([status, index]) => checkbox(widget(2, "Pt1Line23_Checkbox", index), P("info_maritalStatus"), status, `Item 23, petitioner marital status - ${status} (index ${index}, tooltip + onValue verified).`)),
  text(widget(2, "Pt1Line24_CityTownOfBirth"), P("info_cityTownOfBirth"), "Item 24, petitioner city/town/village of birth."),
  text(widget(2, "Pt1Line25_ProvinceOrStateOfBirth"), P("info_stateProvinceOfBirth"), "Item 25, petitioner province or state of birth."),
  // Corrected: the widget is NAMED ...CountryOfCitzOrNationality but its tooltip is "26. Enter Country of Birth".
  text(widget(2, "Pt1Line26_CountryOfCitzOrNationality"), P("info_countryOfBirth"), "Item 26, petitioner COUNTRY OF BIRTH (widget name says citizenship; tooltip says birth)."),

  // Items 27-36: parents.
  ...parentBlock({ party: "petitioner", sf: 2, who: "father", family: "Pt1Line27a_FamilyName", given: "Pt1Line27b_GivenName", middle: "Pt1Line27c_MiddleName", dob: "Pt1Line28_DateofBirth", sexCheckbox: "Pt1Line29_Checkbox", sexIndex: 0, countryOfBirth: "Pt1Line30_CountryOfCitzOrNationality", cityResidence: "Pt1Line31_CityTownOfBirth", countryResidence: "Pt1Line31_CountryOfCitzOrNationality", note: "Items 27-31, petitioner Parent One (father)" }),
  ...parentBlock({ party: "petitioner", sf: 2, who: "mother", family: "Pt1Line32a_FamilyName", given: "Pt1Line32b_GivenName", middle: "Pt1Line32c_MiddleName", dob: "Pt1Line33_DateofBirth", sexCheckbox: "Pt1Line34_Checkbox", sexIndex: 1, countryOfBirth: "Pt1Line35_CountryOfCitzOrNationality", cityResidence: "Pt1Line36a_CityTownOfBirth", countryResidence: "Pt1Line36b_CountryOfCitzOrNationality", note: "Items 32-36, petitioner Parent Two (mother)" }),

  // Items 37-39: previous marriages (one prior-spouse slot).
  ...previouslyMarried({ party: "petitioner", sf: 2, name: "Pt1Line37_Checkboxes", note: "Item 37, petitioner previously married" }),
  text(widget(2, "Pt1Line38a_FamilyName"), P("priorSpouses", "0.lastName"), "Item 38.A, petitioner's prior spouse family name (prior-spouse row 1)."),
  text(widget(2, "Pt1Line38b_GivenName"), P("priorSpouses", "0.firstName"), "Item 38.B, petitioner's prior spouse given name."),
  text(widget(2, "Pt1Line38c_MiddleName"), P("priorSpouses", "0.middleName"), "Item 38.C, petitioner's prior spouse middle name."),
  date(widget(2, "Pt1Line39_DateMarriageEnded"), P("priorSpouses", "0.dateMarriageEnded"), "Item 39, date the petitioner's prior marriage ended."),

  // Items 40-42: citizenship.
  checkbox(widget(2, "Pt1Line40_Checkbox", 0), P("citizenship_throughType"), "Birth in the United States", "Item 40.A, citizen through birth in the United States."),
  checkbox(widget(2, "Pt1Line40_Checkbox", 1), P("citizenship_throughType"), "Naturalization", "Item 40.B, citizen through naturalization."),
  checkbox(widget(2, "Pt1Line40_Checkbox", 2), P("citizenship_throughType"), "US Citizen parents", "Item 40.C, citizen through U.S. citizen parents."),
  ...yesNo(2, "Pt1Line20_Checkboxes", P("citizenship_hasCertificate"), "Item 41 (widget Pt1Line20), obtained a Certificate of Naturalization/Citizenship"),
  text(widget(3, "Pt1Line21a_CertificateNumber"), P("citizenship_certificateNumber"), "Item 42.A, certificate number."),
  text(widget(3, "Pt1Line21b_PlaceofIssuance"), P("citizenship_certificatePlaceOfIssuance"), "Item 42.B, certificate place of issuance."),
  date(widget(3, "Pt1Line21c_DateOfIssuance"), P("citizenship_certificateDateOfIssuance"), "Item 42.C, certificate date of issuance."),

  // Items 43-47: prior I-129F filings.
  ...yesNo(3, "Pt1Line43_Checkboxes", P("i129f_filedBefore"), "Item 43, ever filed I-129F for another beneficiary"),
  digits(widget(3, "Pt1Line44_AlienNumber"), P("i129f_aNumber"), "Item 44, A-Number of that other beneficiary."),
  text(widget(3, "Pt1Line45a_FamilyName"), P("i129f_lastName"), "Item 45.A, other beneficiary family name."),
  text(widget(3, "Pt1Line45b_GivenName"), P("i129f_firstName"), "Item 45.B, other beneficiary given name."),
  text(widget(3, "Pt1Line45c_MiddleName"), P("i129f_middleName"), "Item 45.C, other beneficiary middle name."),
  date(widget(3, "Pt1Line46_DateOfFiling"), P("i129f_dateOfFiling"), "Item 46, date of that filing."),
  text(widget(3, "Pt1Line47_Result"), P("i129f_uscisAction"), "Item 47, USCIS action on that filing."),

  // Items 48-49: children under 18.
  ...yesNo(3, "Pt1Line48_Checkboxes", P("children_hasChildrenUnder18"), "Item 48, children under 18"),
  edge(widget(3, "Pt1Line49a_Age"), P("children_ages"), "Item 49.A, first child's age (first number in the ages answer).", { transform: { type: "listItem", index: 0 } }),
  edge(widget(3, "Pt1Line49b_Age"), P("children_ages"), "Item 49.B, second child's age (second number in the ages answer).", { transform: { type: "listItem", index: 1 } }),

  // Items 50-51: states/countries lived in since age 18 (first two rows).
  edge(widget(3, "Pt1Line50a_State"), P("statesCountriesSince18", "0.state"), "Item 50.A, residence one - state (US only).", { transform: { type: "usState", countryPath: P("statesCountriesSince18", "0.country") } }),
  edge(widget(3, "Pt1Line50b_CountryOfCitzOrNationality"), P("statesCountriesSince18", "0.country"), "Item 50.B, residence one - country.", { transform: { type: "country" } }),
  edge(widget(3, "Pt1Line51a_State"), P("statesCountriesSince18", "1.state"), "Item 51.A, residence two - state (US only).", { transform: { type: "usState", countryPath: P("statesCountriesSince18", "1.country") } }),
  edge(widget(3, "Pt1Line51b_CountryOfCitzOrNationality"), P("statesCountriesSince18", "1.country"), "Item 51.B, residence two - country.", { transform: { type: "country" } }),

  // ===================== PART 2: BENEFICIARY (pages 4-8) =====================
  text(widget(3, "Pt2Line1a_FamilyName"), B("info_lastName"), "Item 1.A, beneficiary family name."),
  text(widget(3, "Pt2Line1b_GivenName"), B("info_firstName"), "Item 1.B, beneficiary given name."),
  text(widget(3, "Pt2Line1c_MiddleName"), B("info_middleName"), "Item 1.C, beneficiary middle name."),
  digits(widget(3, "Pt2Line2_AlienNumber"), B("info_aNumber"), "Item 2, beneficiary A-Number (digits only)."),
  digits(widget(3, "Pt2Line3_SSN"), B("info_ssn"), "Item 3, beneficiary SSN (digits only)."),
  date(widget(3, "Pt2Line4_DateOfBirth"), B("info_dateOfBirth"), "Item 4, beneficiary date of birth."),
  checkbox(widget(3, "Pt2Line5_Checkboxes", 0), B("info_gender"), "Male", "Item 5, beneficiary sex - Male. onValue /M verified via pdf-lib."),
  checkbox(widget(3, "Pt2Line5_Checkboxes", 1), B("info_gender"), "Female", "Item 5, beneficiary sex - Female. onValue /F verified via pdf-lib."),
  ...Object.entries(MARITAL).map(([status, index]) => checkbox(widget(3, "Pt2Line6_Checkboxes", index), B("info_maritalStatus"), status, `Item 6, beneficiary marital status - ${status} (index ${index}, tooltip + onValue verified).`)),
  text(widget(3, "Pt2Line7_CityTownOfBirth"), B("info_cityTownOfBirth"), "Item 7, beneficiary city/town/village of birth."),
  text(widget(3, "Pt2Line8_CountryOfBirth"), B("info_countryOfBirth"), "Item 8, beneficiary country of birth."),
  text(widget(3, "Pt2Line9_CountryofCitzOrNationality"), B("info_countryOfCitizenship"), "Item 9, beneficiary country of citizenship/nationality."),

  // Item 11: beneficiary mailing address.
  ...addressBlock({
    source: B("info_fullMailingAddress"), note: "Item 11, beneficiary mailing address",
    fields: {
      street: widget(4, "Pt2Line11_StreetNumberName"), unitNumber: widget(4, "Pt2Line11_AptSteFlrNumber"), city: widget(4, "Pt2Line11_CityOrTown"),
      state: widget(4, "Pt2Line11_State"), zip: widget(4, "Pt2Line11_ZipCode"), province: widget(4, "Pt2Line11_Province"),
      postalCode: widget(4, "Pt2Line11_PostalCode"), country: widget(4, "Pt2Line11_Country"),
    },
    unit: unitWidgets(4, "Pt2Line11_Unit", SUITE_FLOOR_APT),
  }),

  // Items 12-15: beneficiary physical addresses (residence history rows 1-2).
  ...residenceRow({ sf: 4, key: beneficiaryKey("residentialHistory"), i: 0, prefix: "Pt2Line12", unitOrder: FLOOR_APT_SUITE, from: { name: "Pt2Line13a_DateFrom" }, to: { name: "Pt2Line13b_ToFrom" }, note: "Items 12-13, beneficiary Physical Address One (residence history row 1)" }),
  ...residenceRow({ sf: 4, key: beneficiaryKey("residentialHistory"), i: 1, prefix: "Pt2Line14", unitOrder: FLOOR_APT_SUITE, from: { name: "Pt2Line15a_DateFrom" }, to: { name: "Pt2Line15b_ToFrom" }, note: "Items 14-15, beneficiary Physical Address Two (residence history row 2)" }),

  // Items 16-23: beneficiary employment (rows 1-2).
  ...employerRow({ sf: 4, key: beneficiaryKey("employmentHistory"), i: 0, nameWidget: { name: "Pt2Line16_NameofEmployer" }, addrPrefix: "Pt2Line17", unitOrder: FLOOR_APT_SUITE, occupationWidget: { name: "Pt2Line18_Occupation" }, from: { name: "Pt2Line19a_DateFrom" }, to: { name: "Pt2Line19b_ToFrom" }, note: "Items 16-19, beneficiary Employer One (employment history row 1)" }),
  ...employerRow({ sf: 5, key: beneficiaryKey("employmentHistory"), i: 1, nameWidget: { name: "Pt2Line20_NameofEmployer" }, addrPrefix: "Pt2Line21", unitOrder: FLOOR_APT_SUITE, occupationWidget: { name: "Pt2Line22_Occupation" }, from: { name: "Pt2Line23a_DateFrom" }, to: { name: "Pt2Line23b_ToFrom" }, note: "Items 20-23, beneficiary Employer Two (employment history row 2)" }),

  // Items 24-33: beneficiary parents (Parent One DOB widget is misnamed Pt1Line11_DateofBirth; tooltip says Item 25).
  ...parentBlock({ party: "beneficiary", sf: 5, who: "father", family: "Pt2Line24a_FamilyName", given: "Pt2Line24b_GivenName", middle: "Pt2Line24c_MiddleName", dob: "Pt1Line11_DateofBirth", sexCheckbox: "Pt2Line26_Checkbox", sexIndex: 0, countryOfBirth: "Pt2Line27_CountryOfCitzOrNationality", cityResidence: "Pt2Line28a_CityTownOfBirth", countryResidence: "Pt2Line28b_CountryOfCitzOrNationality", note: "Items 24-28, beneficiary Parent One (father)" }),
  ...parentBlock({ party: "beneficiary", sf: 5, who: "mother", family: "Pt2Line29a_FamilyName", given: "Pt2Line29b_GivenName", middle: "Pt2Line29c_MiddleName", dob: "Pt2Line30_DateofBirth", sexCheckbox: "Pt2Line31_Checkbox", sexIndex: 1, countryOfBirth: "Pt2Line32_CountryOfCitzOrNationality", cityResidence: "Pt2Line33a_CityTownOfBirth", countryResidence: "Pt2Line33b_CountryOfCitzOrNationality", note: "Items 29-33, beneficiary Parent Two (mother)" }),

  // Items 34-36: beneficiary previous marriages.
  ...previouslyMarried({ party: "beneficiary", sf: 5, name: "Pt2Line34_Checkboxes", note: "Item 34, beneficiary previously married" }),
  text(widget(5, "Pt2Line35a_FamilyName"), B("priorSpouses", "0.lastName"), "Item 35.A, beneficiary's prior spouse family name."),
  text(widget(5, "Pt2Line35b_GivenName"), B("priorSpouses", "0.firstName"), "Item 35.B, beneficiary's prior spouse given name."),
  text(widget(5, "Pt2Line35c_MiddleName"), B("priorSpouses", "0.middleName"), "Item 35.C, beneficiary's prior spouse middle name."),
  date(widget(5, "Pt2Line36_DateMarriageEnded"), B("priorSpouses", "0.dateMarriageEnded"), "Item 36, date the beneficiary's prior marriage ended."),

  // Items 37-38: U.S. history.
  ...yesNo(5, "Pt2Line37_Checkboxes", B("usHistory_everBeenToUS"), "Item 37, beneficiary ever been in the United States"),
  text(widget(5, "Pt2Line38a_LastArrivedAs"), B("usHistory_visaOnWhichArrived"), "Item 38.A, visa/class the beneficiary last arrived as."),
  text(widget(5, "Pt2Line38b_ArrivalDeparture"), B("usHistory_i94Number"), "Item 38.B, I-94 number."),
  date(widget(5, "Pt2Line38c_DateofArrival"), B("usHistory_dateOfLastArrival"), "Item 38.C, date of last arrival."),
  date(widget(6, "Pt2Line38d_DateExpired"), B("usHistory_i94ExpiryDate"), "Item 38.D, date authorized stay expires (I-94 expiry; falls back to the 'date status expires' answer).", { fallback: B("usHistory_dateStatusExpires") }),
  text(widget(6, "Pt2Line38e_Passport"), B("usHistory_passportNumber"), "Item 38.E, passport number."),
  text(widget(6, "Pt2Line38g_CountryOfIssuance"), B("usHistory_passportCountryOfIssuance"), "Item 38.G, passport country of issuance."),
  date(widget(6, "Pt2Line38h_ExpDate"), B("usHistory_passportExpirationDate"), "Item 38.H, passport expiration date."),

  // Items 39-42: beneficiary's children (first child row; the form has one child slot).
  checkboxWhen(widget(6, "Pt2Line39_Checkboxes", 0), B("children", "0.lastName"), any(exists(B("children", "0.lastName")), exists(B("children", "0.firstName"))), "Item 39 - beneficiary has children (a child is listed).", { fallback: B("children", "0.firstName") }),
  text(widget(6, "Pt2Line40a_FamilyName"), B("children", "0.lastName"), "Item 40.A, beneficiary's child family name (child row 1)."),
  text(widget(6, "Pt2Line40b_GivenName"), B("children", "0.firstName"), "Item 40.B, beneficiary's child given name."),
  text(widget(6, "Pt2Line40c_MiddleName"), B("children", "0.middleName"), "Item 40.C, beneficiary's child middle name."),
  text(widget(6, "Pt2Line41_CountryOfBirth"), B("children", "0.countryOfBirth"), "Item 41, beneficiary's child country of birth."),
  date(widget(6, "Pt2Line42_DateofBirth"), B("children", "0.dateOfBirth"), "Item 42, beneficiary's child date of birth."),

  // Item 45: where the beneficiary intends to live in the U.S.
  ...addressBlock({
    source: B("intendedUsAddress"), note: "Item 45, U.S. address where the beneficiary intends to live",
    fields: {
      street: widget(6, "Pt2Line45a_StreetNumberName"), unitNumber: widget(6, "Pt2Line45b_AptSteFlrNumber"), city: widget(6, "Pt2Line45c_CityOrTown"),
      state: widget(6, "Pt2Line45d_State"), zip: widget(6, "Pt2Line45e_ZipCode"),
    },
    unit: unitWidgets(6, "Pt2Line45b_Unit", SUITE_FLOOR_APT),
  }),
  // Item 47: beneficiary's physical address abroad.
  ...addressBlock({
    source: B("outsideUsAddress"), note: "Item 47, beneficiary physical address abroad",
    fields: {
      street: widget(6, "Pt2Line47_StreetNumberName"), unitNumber: widget(6, "Pt2Line47_AptSteFlrNumber"), city: widget(6, "Pt2Line47_CityOrTown"),
      province: widget(6, "Pt2Line47_Province"), postalCode: widget(6, "Pt2Line47_PostalCode"), country: widget(6, "Pt2Line47_Country"),
    },
    unit: unitWidgets(6, "Pt2Line47_Unit", APT_FLOOR_SUITE),
  }),

  // Items 51 / 53: relationship and meeting requirement (K-1 vs K-3 specific).
  checkbox(widget(7, "Pt2Line51_Checkboxes", 2), "case.visaType", VISA_K3, "Item 51 - 'Not applicable, beneficiary is my spouse' (K-3 case)."),
  checkbox(widget(7, "Pt2Line53_Checkboxes", 0), "case.visaType", VISA_K3, "Item 53 - 'Not applicable, beneficiary is my spouse' (K-3 case)."),
  checkboxWhen(widget(7, "Pt2Line53_Checkboxes", 2), B("metWithinTwoYears"), all(visaIs(VISA_K1), equals(B("metWithinTwoYears"), "Yes")), "Item 53 - Yes, met in person within the two years before filing (K-1 case, 'metWithinTwoYears' = Yes)."),
  checkboxWhen(widget(7, "Pt2Line53_Checkboxes", 1), B("metWithinTwoYears"), all(visaIs(VISA_K1), equals(B("metWithinTwoYears"), "No")), "Item 53 - No (K-1 case, 'metWithinTwoYears' = No)."),

  // Item 55: International Marriage Broker.
  ...yesNo(7, "Pt2Line55_Checkboxes", B("marriageBroker_usedBroker"), "Item 55, met through an International Marriage Broker"),

  // Item 62: consular processing location.
  edge(widget(7, "Pt2Line62a_CityTown"), B("consulateCityCountry"), "Item 62.A, U.S. embassy/consulate city.", { transform: { type: "cityCountry", part: "city" } }),
  edge(widget(7, "Pt2Line62b_Country"), B("consulateCityCountry"), "Item 62.B, U.S. embassy/consulate country.", { transform: { type: "cityCountry", part: "country" } }),

  // ===================== PART 5: PETITIONER CONTACT (page 10) =====================
  // Petitioner's own account contact details (profile.petitioner.* - built by
  // CanonicalBuilderService from the petitioner User, never from the beneficiary's account).
  text(widget(9, "Pt5Line3_Email"), "petitioner.email", "Part 5 item 3, petitioner email (petitioner's own account)."),
  text(widget(9, "Pt5Line1_DaytimePhoneNumber1"), "petitioner.phone", "Part 5 item 1, petitioner daytime phone (petitioner's own account)."),
];

const MANUAL_ENTRY_REASONS = {
  not_collected_by_checklist: [
    "Part 1 item 5 (K-3: has Form I-130 been filed) - not asked by the checklist; the I-130 receipt is a document, not an answer",
    "Part 1 item 7 / Part 2 item 10 other names used", "Part 2 items 43-44 child residence and address", "Part 2 items 46/48 beneficiary phone numbers",
    "Part 2 items 49-50 beneficiary name/address in native alphabet", "Part 2 items 51-52 relationship between the parties (K-1)",
    "Part 2 items 54, 56-61 IMB name/address/website (the checklist stores them as one combined free-text 'name and address')",
    "Part 3 criminal / waiver questions", "Part 5 petitioner mobile phone, Parts 6-7 interpreter/preparer",
  ],
  petitioner_biographic_part4_not_filled_from_beneficiary: [
    "Part 4 (ethnicity/race/height/weight/eye+hair colour) is the PETITIONER's biographic block. The checklist's 'Biographical Information' (height/weight/eye/hair) is asked of the BENEFICIARY, so it is deliberately NOT mapped here - doing so would put the beneficiary's data in the petitioner's section.",
  ],
  beyond_the_forms_slots: [
    "residence/employment/prior-spouse/child rows beyond the form's own slots (two physical addresses, two employers, one prior spouse, one child per party) - use Part 8 Additional Information",
  ],
};

function classifyField(field) {
  const fieldName = field.fieldName || field.pdfFieldName || field.fieldId;
  if (USCIS_USE_ONLY_PATTERNS.some((pattern) => pattern.test(fieldName))) {
    return { status: "uscis_use_only", note: "USCIS-internal barcode/processing field." };
  }
  const mappedEdge = MAPPED_EDGES.find((edge) => edge.fieldName === fieldName);
  if (mappedEdge) return { status: "mapped", edge: mappedEdge };
  return {
    status: "manual_entry",
    note: "Not collected by the K-1/K-3 checklists (or deliberately left to the case manager) - see MANUAL_ENTRY_REASONS in this file.",
  };
}

module.exports = { FORM_CODE, VERSION, USCIS_USE_ONLY_PATTERNS, MAPPED_EDGES, MANUAL_ENTRY_REASONS, classifyField, BOOLEAN };
