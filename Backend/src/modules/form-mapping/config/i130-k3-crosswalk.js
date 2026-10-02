// Canonical -> I-130 (K-3 spouse petition) field crosswalk, authored against
// the real bundled I-130 PDF (Backend/dev-assets/uscis/i-130_2024-04-01.pdf).
// Every widget's meaning was read from that PDF's own tooltip text and every
// checkbox index / onValue from pdf-lib - not inferred from names/positions.
//
// ROLES. On I-130, "Part 2" is "Information About You (Petitioner)" and
// "Part 4" is "Information About Beneficiary" (NOT "Part 2 = beneficiary" as
// the part number alone might suggest; confirmed by the tooltips and by which
// side has a USCIS Online Account Number field). Every Part 2 widget is wired
// ONLY to a petitioner_* question key and every Part 4 widget ONLY to a
// beneficiary_* key (see family-crosswalk-helpers.js).
//
// SOURCES. k3.js reuses k1.js's fieldCatalog(), so K-3 question keys are the
// same petitioner_*/beneficiary_* keys i129f-k1-crosswalk.js reads. The I-130
// template is ALSO the PDF for the IR/CR/F family checklists
// (i130_<code>_petitioner/beneficiary_checklist, keys like petitioner_lastName)
// whose answers reach the form through canonical paths (person.* /
// beneficiary.* - see canonicalPathFixes.seed.js). One template = one active
// mapping graph, so every identity edge here reads the role-keyed K-3 answer
// FIRST and falls back to that canonical path (edge.fallback) - K-3 never
// depends on a canonicalPath having been patched onto its questions, and the
// IR/CR/F cases keep the data they already got.
//
// DECISIONS (see i129f-k1-crosswalk.js for the shared rules: address
// splitting, row -> slot order, Parent One = father/Parent Two = mother,
// Yes/No only when the answer supports it):
//  - Beneficiary marital status uses Pt4Line18_MaritalStatus indices
//    [0]=Widowed [3]=Single (Never Married) [4]=Married [5]=Divorced. The
//    earlier crosswalk ticked index [2] for "single" - that widget is
//    "Separated" (/S); "Single, Never Married" is [3] (/SNM).
//  - Every checkbox keeps its condition (exactly one box of a group can
//    pass). The live graph had lost them, ticking Male AND Female and every
//    marital status at once.
//  - "Spouse 1" (the CURRENT spouse) on both sides is the other party of this
//    very petition; the petition's own other party is not copied across the
//    role boundary, so only each party's PRIOR spouse (-> "Spouse 2") is
//    mapped.
//  - Part 3 (petitioner biographic) is not mapped: the checklist's
//    biographical block belongs to the beneficiary.
const {
  answerPath, petitionerKey, beneficiaryKey, widget, text, date, digits, edge, checkbox, checkboxWhen, addressBlock,
  exists, empty, equals, isIn, all, any, visaIs, VISA_K1, VISA_K3,
} = require("./family-crosswalk-helpers");

const FORM_CODE = "I-130";
const VERSION = "2024-04-01";

const USCIS_USE_ONLY_PATTERNS = [/PDF417BarCode/];

const P = (path, sub) => answerPath(petitionerKey(path), sub);
const B = (path, sub) => answerPath(beneficiaryKey(path), sub);

const APT_SUITE_FLOOR = { apt: 0, ste: 1, flr: 2 };
function unitWidgets(sf, name, order = APT_SUITE_FLOOR) {
  return { apt: widget(sf, name, order.apt), ste: widget(sf, name, order.ste), flr: widget(sf, name, order.flr) };
}

// Identity edge: role-keyed answer first, canonical path as the IR/CR/F fallback.
const withFallback = (fallback) => ({ fallback });

// Checkbox for the shared graph: ticked when the role-keyed answer equals one
// of `values`, or - when that answer is absent (IR/CR/F cases) - when the
// canonical value is one of `canonicalValues`.
function dualCheckbox(fieldName, source, values, canonicalPath, canonicalValues, note) {
  return edge(fieldName, source, note, {
    // The canonical alternative applies ONLY while the role-keyed answer is absent - a
    // polluted/stale canonical value can never tick a box the K-3 answer contradicts.
    condition: any(isIn(source, [].concat(values)), all(empty(source), isIn(canonicalPath, [].concat(canonicalValues)))),
    transform: { type: "boolean" },
    fallback: canonicalPath,
  });
}

function residenceRow({ sf, key, i, prefix, unitOrder = APT_SUITE_FLOOR, from, to, note }) {
  const row = (col) => answerPath(key, `${i}.${col}`);
  const w = (name) => widget(sf, `${prefix}_${name}`);
  return [
    ...addressBlock({
      source: row("streetAndNumber"), rows: true, note,
      fields: { street: w("StreetNumberName"), unitNumber: w("AptSteFlrNumber") },
      unit: unitWidgets(sf, `${prefix}_Unit`, unitOrder),
    }),
    text(w("CityOrTown"), row("city"), `${note} - city or town`),
    edge(w("State"), row("provinceState"), `${note} - state (US rows only)`, { transform: { type: "usState", countryPath: row("country") } }),
    edge(w("Province"), row("provinceState"), `${note} - province (non-US rows only)`, { transform: { type: "nonUsProvince", countryPath: row("country") } }),
    edge(w("Country"), row("country"), `${note} - country`, { transform: { type: "country" } }),
    date(widget(sf, from), row("from"), `${note} - date from`),
    date(widget(sf, to), row("to"), `${note} - date to (left blank for the current address: the form wants "Present"/no entry)`),
  ];
}

function employerRow({ sf, key, i, nameWidget, addrPrefix, occupationWidget, from, to, note, gate }) {
  const row = (col) => answerPath(key, `${i}.${col}`);
  const aw = (name) => widget(sf, `${addrPrefix}_${name}`);
  const gated = (edges) => (gate ? edges.map((item) => ({ ...item, condition: item.condition ? all(gate, item.condition) : gate })) : edges);
  return gated([
    text(widget(sf, nameWidget), row("employerName"), `${note} - employer name`),
    ...addressBlock({
      source: row("employerAddress"), note: `${note} - employer address`,
      fields: {
        street: aw("StreetNumberName"), unitNumber: aw("AptSteFlrNumber"), city: aw("CityOrTown"), state: aw("State"),
        zip: aw("ZipCode"), province: aw("Province"), postalCode: aw("PostalCode"), country: aw("Country"),
      },
      unit: unitWidgets(sf, `${addrPrefix}_Unit`),
    }),
    ...(occupationWidget ? [text(widget(sf, occupationWidget), row("occupation"), `${note} - occupation`)] : []),
    date(widget(sf, from), row("from"), `${note} - employment start date`),
    ...(to ? [date(widget(sf, to), row("to"), `${note} - employment end date`)] : []),
  ]);
}

// Father -> "Parent One", mother -> "Parent Two".
function parentBlock({ who, sf, family, given, middle, dob, sexWidget, countryOfBirth, cityResidence, countryResidence, note }) {
  const key = (name) => P(`parents_${who}${name}`);
  const sex = who === "father" ? "Male" : "Female";
  return [
    text(widget(sf, family), key("LastName"), `${note} - family name`),
    text(widget(sf, given), key("FirstName"), `${note} - given name`),
    text(widget(sf, middle), key("MiddleName"), `${note} - middle name`),
    date(widget(sf, dob), key("DateOfBirth"), `${note} - date of birth`),
    checkboxWhen(widget(sf, sexWidget), key("LastName"), any(exists(key("LastName")), exists(key("FirstName"))), `${note} - sex ${sex} (implied by the "${who === "father" ? "Father's" : "Mother's"}" checklist block, once that parent is named)`, { fallback: key("FirstName") }),
    text(widget(sf, countryOfBirth), key("CountryOfBirth"), `${note} - country of birth`),
    text(widget(sf, cityResidence), key("CityTownVillageOfResidence"), `${note} - city/town/village of residence`),
    text(widget(sf, countryResidence), key("CountryOfResidence"), `${note} - country of residence`),
  ];
}

// Beneficiary's children rows -> "Information About Beneficiary's Family" Person 1-5.
function personBlock({ i, sf, family, given, middle, relationship, dob, country, countryIndex = 0, note }) {
  const row = (col) => B("children", `${i}.${col}`);
  const named = any(exists(row("lastName")), exists(row("firstName")));
  return [
    text(widget(sf, family), row("lastName"), `${note} - family name`),
    text(widget(sf, given), row("firstName"), `${note} - given name`),
    text(widget(sf, middle), row("middleName"), `${note} - middle name`),
    edge(widget(sf, relationship), row("lastName"), `${note} - relationship (a listed child of the beneficiary)`, { condition: named, transform: { type: "constant", value: "Child" }, fallback: row("firstName") }),
    date(widget(sf, dob), row("dateOfBirth"), `${note} - date of birth`),
    text(widget(sf, country, countryIndex), row("countryOfBirth"), `${note} - country of birth`),
  ];
}

const MAPPED_EDGES = [
  // ===================== PART 1: RELATIONSHIP =====================
  // Every K-3 case is, by definition, a spousal petition.
  checkbox(widget(0, "Pt1Line1_Spouse"), "case.visaType", VISA_K3, "Item 1, relationship - Spouse. K-3 is inherently spousal; keyed off the case's visa type."),

  // ===================== PART 2: PETITIONER =====================
  text("form1[0].#subform[0].Pt2Line4a_FamilyName[0]", P("info_lastName"), "Item 4.A, petitioner family name.", withFallback("person.lastName")),
  text("form1[0].#subform[0].Pt2Line4b_GivenName[0]", P("info_firstName"), "Item 4.B, petitioner given name.", withFallback("person.firstName")),
  text("form1[0].#subform[0].Pt2Line4c_MiddleName[0]", P("info_middleName"), "Item 4.C, petitioner middle name.", withFallback("person.middleName")),
  digits("form1[0].#subform[0].#area[4].Pt2Line1_AlienNumber[0]", P("info_aNumber"), "Item 1, petitioner A-Number (digits only: 9-character widget).", withFallback("person.alienNumber")),
  text("form1[0].#subform[0].#area[5].Pt2Line2_USCISOnlineActNumber[0]", P("info_uscisOnlineAccountNumber"), "Item 2, petitioner USCIS Online Account Number.", withFallback("person.uscisOnlineAccountNumber")),
  digits(widget(0, "Pt2Line11_SSN"), P("info_ssn"), "Item 3, petitioner SSN (widget is named Pt2Line11 but its tooltip is Item 3; digits only: 9-character widget).", withFallback("person.ssn")),

  text(widget(1, "Pt2Line6_CityTownOfBirth"), P("info_cityTownOfBirth"), "Item 6, petitioner city/town/village of birth.", withFallback("person.cityTownOfBirth")),
  text(widget(1, "Pt2Line7_CountryofBirth"), P("info_countryOfBirth"), "Item 7, petitioner country of birth.", withFallback("person.countryOfBirth")),
  date(widget(1, "Pt2Line8_DateofBirth"), P("info_dateOfBirth"), "Item 8, petitioner date of birth.", withFallback("person.dob")),
  dualCheckbox(widget(1, "Pt2Line9_Male"), P("info_gender"), "Male", "person.gender", ["male", "Male"], "Item 9, petitioner sex - Male. onValue /Y verified via pdf-lib."),
  dualCheckbox(widget(1, "Pt2Line9_Female"), P("info_gender"), "Female", "person.gender", ["female", "Female"], "Item 9, petitioner sex - Female."),

  // Item 10: petitioner mailing address; Item 11: same as physical?
  ...addressBlock({
    source: P("info_fullMailingAddress"), note: "Item 10, petitioner mailing address",
    fields: {
      street: widget(1, "Pt2Line10_StreetNumberName"), unitNumber: widget(1, "Pt2Line10_AptSteFlrNumber"), city: widget(1, "Pt2Line10_CityOrTown"),
      state: widget(1, "Pt2Line10_State"), zip: widget(1, "Pt2Line10_ZipCode"), province: widget(1, "Pt2Line10_Province"),
      postalCode: widget(1, "Pt2Line10_PostalCode"), country: widget(1, "Pt2Line10_Country"),
    },
    unit: unitWidgets(1, "Pt2Line10_Unit"),
  }),
  checkboxWhen(widget(1, "Pt2Line11_Yes"), P("info_fullMailingAddress"), all(exists(P("info_fullMailingAddress")), empty(P("info_fullPhysicalAddress"))), "Item 11 - mailing address is the same as the physical address (no separate physical address answered)."),
  checkboxWhen(widget(1, "Pt2Line11_No"), P("info_fullPhysicalAddress"), exists(P("info_fullPhysicalAddress")), "Item 11 - mailing address differs from the physical address (a separate physical address was answered)."),

  // Items 12-15: address history (residence rows 1-2).
  ...residenceRow({ sf: 1, key: petitionerKey("residentialHistory"), i: 0, prefix: "Pt2Line12", from: "Pt2Line13a_DateFrom", to: "Pt2Line13b_DateTo", note: "Items 12-13, petitioner Physical Address 1 (residence history row 1)" }),
  ...residenceRow({ sf: 1, key: petitionerKey("residentialHistory"), i: 1, prefix: "Pt2Line14", from: "Pt2Line15a_DateFrom", to: "Pt2Line15b_DateTo", note: "Items 14-15, petitioner Physical Address 2 (residence history row 2)" }),

  // Item 17: current marital status.
  dualCheckbox(widget(1, "Pt2Line17_Widowed"), P("info_maritalStatus"), "widowed", "person.maritalStatus", ["widowed", "Widowed"], "Item 17, petitioner marital status - Widowed."),
  dualCheckbox(widget(1, "Pt2Line17_Single"), P("info_maritalStatus"), "single", "person.maritalStatus", ["single", "Single"], "Item 17, petitioner marital status - Single, Never Married."),
  dualCheckbox(widget(1, "Pt2Line17_Married"), P("info_maritalStatus"), "married", "person.maritalStatus", ["married", "Married"], "Item 17, petitioner marital status - Married."),
  dualCheckbox(widget(1, "Pt2Line17_Divorced"), P("info_maritalStatus"), "divorced", "person.maritalStatus", ["divorced", "Divorced"], "Item 17, petitioner marital status - Divorced."),

  // Items 22-23: Spouse 2 = the petitioner's prior spouse (Spouse 1 is the current spouse - see DECISIONS).
  text(widget(2, "Pt2Line22a_FamilyName"), P("priorSpouses", "0.lastName"), "Item 22.A, petitioner's prior spouse family name (prior-spouse row 1)."),
  text(widget(2, "Pt2Line22b_GivenName"), P("priorSpouses", "0.firstName"), "Item 22.B, petitioner's prior spouse given name."),
  text(widget(2, "Pt2Line22c_MiddleName"), P("priorSpouses", "0.middleName"), "Item 22.C, petitioner's prior spouse middle name."),
  date(widget(2, "Pt2Line23_DateMarriageEnded"), P("priorSpouses", "0.dateMarriageEnded"), "Item 23, date the petitioner's prior marriage ended."),

  // Items 24-35: petitioner's parents.
  ...parentBlock({ who: "father", sf: 2, family: "Pt2Line24_FamilyName", given: "Pt2Line24_GivenName", middle: "Pt2Line24_MiddleName", dob: "Pt2Line25_DateofBirth", sexWidget: "Pt2Line26_Male", countryOfBirth: "Pt2Line27_CountryofBirth", cityResidence: "Pt2Line28_CityTownOrVillageOfResidence", countryResidence: "Pt2Line29_CountryOfResidence", note: "Items 24-29, petitioner Parent One (father)" }),
  ...parentBlock({ who: "mother", sf: 2, family: "Pt2Line30a_FamilyName", given: "Pt2Line30b_GivenName", middle: "Pt2Line30c_MiddleName", dob: "Pt2Line31_DateofBirth", sexWidget: "Pt2Line32_Female", countryOfBirth: "Pt2Line33_CountryofBirth", cityResidence: "Pt2Line34_CityTownOrVillageOfResidence", countryResidence: "Pt2Line35_CountryOfResidence", note: "Items 30-35, petitioner Parent Two (mother)" }),

  // Items 36-38: status and citizenship.
  checkbox(widget(2, "Pt2Line36_USCitizen"), "case.visaType", VISA_K3, "Item 36 - 'I am a U.S. Citizen'. A K-3 petitioner is by definition a U.S. citizen; keyed off the case's visa type."),
  checkbox(widget(2, "Pt2Line23a_checkbox"), P("citizenship_throughType"), "Birth in the United States", "Item 37 - citizenship acquired through birth in the United States."),
  checkbox(widget(2, "Pt2Line23b_checkbox"), P("citizenship_throughType"), "Naturalization", "Item 37 - citizenship acquired through naturalization."),
  checkbox(widget(2, "Pt2Line23c_checkbox"), P("citizenship_throughType"), "US Citizen parents", "Item 37 - citizenship acquired through parents."),
  checkbox(widget(2, "Pt2Line36_Yes"), P("citizenship_hasCertificate"), "Yes", "Item 38 - obtained a Certificate of Naturalization/Citizenship: Yes."),
  checkbox(widget(2, "Pt2Line36_No"), P("citizenship_hasCertificate"), "No", "Item 38 - obtained a Certificate of Naturalization/Citizenship: No."),
  text(widget(2, "Pt2Line37a_CertificateNumber"), P("citizenship_certificateNumber"), "Item 39.A, certificate number.", withFallback("person.certificateNumber")),
  text(widget(2, "Pt2Line37b_PlaceOfIssuance"), P("citizenship_certificatePlaceOfIssuance"), "Item 39.B, certificate place of issuance.", withFallback("person.certificatePlaceOfIssuance")),
  date(widget(2, "Pt2Line37c_DateOfIssuance"), P("citizenship_certificateDateOfIssuance"), "Item 39.C, certificate date of issuance.", withFallback("person.certificateDateOfIssuance")),

  // Items 43-49: petitioner employment (rows 1-2).
  ...employerRow({ sf: 3, key: petitionerKey("employmentHistory"), i: 0, nameWidget: "Pt2Line40_EmployerOrCompName", addrPrefix: "Pt2Line41", occupationWidget: "Pt2Line42_Occupation", from: "Pt2Line43a_DateFrom", to: "Pt2Line43b_DateTo", note: "Employer 1, petitioner (employment history row 1)" }),
  ...employerRow({ sf: 3, key: petitionerKey("employmentHistory"), i: 1, nameWidget: "Pt2Line44_EmployerOrOrgName", addrPrefix: "Pt2Line45", occupationWidget: "Pt2Line46_Occupation", from: "Pt2Line47a_DateFrom", to: "Pt2Line47b_DateTo", note: "Employer 2, petitioner (employment history row 2)" }),

  // ===================== PART 4: BENEFICIARY =====================
  digits("form1[0].#subform[4].#area[6].Pt4Line1_AlienNumber[0]", B("info_aNumber"), "Item 1, beneficiary A-Number (digits only).", withFallback("beneficiary.alienRegistrationNumber")),
  digits(widget(4, "Pt4Line3_SSN"), B("info_ssn"), "Item 3, beneficiary SSN (digits only). No canonical fallback: a full SSN is never read from a masked canonical field."),
  text(widget(4, "Pt4Line4a_FamilyName"), B("info_lastName"), "Item 4.A, beneficiary family name.", withFallback("beneficiary.lastName")),
  text(widget(4, "Pt4Line4b_GivenName"), B("info_firstName"), "Item 4.B, beneficiary given name.", withFallback("beneficiary.firstName")),
  text(widget(4, "Pt4Line4c_MiddleName"), B("info_middleName"), "Item 4.C, beneficiary middle name.", withFallback("beneficiary.middleName")),
  text(widget(4, "Pt4Line7_CityTownOfBirth"), B("info_cityTownOfBirth"), "Item 6, beneficiary city/town/village of birth (widget Pt4Line7).", withFallback("beneficiary.cityTownOfBirth")),
  text(widget(4, "Pt4Line8_CountryOfBirth"), B("info_countryOfBirth"), "Item 7, beneficiary country of birth (widget Pt4Line8).", withFallback("beneficiary.countryOfBirth")),
  date(widget(4, "Pt4Line9_DateOfBirth"), B("info_dateOfBirth"), "Item 8, beneficiary date of birth (widget Pt4Line9).", withFallback("beneficiary.dateOfBirth")),
  dualCheckbox(widget(4, "Pt4Line9_Male"), B("info_gender"), "Male", "beneficiary.gender", ["male", "Male"], "Item 9, beneficiary sex - Male. onValue /Y verified via pdf-lib."),
  dualCheckbox(widget(4, "Pt4Line9_Female"), B("info_gender"), "Female", "beneficiary.gender", ["female", "Female"], "Item 9, beneficiary sex - Female."),

  // Items 11-13: beneficiary addresses.
  ...addressBlock({
    source: B("info_fullPhysicalAddress"), fallback: B("info_fullMailingAddress"), note: "Item 11, beneficiary physical address (the mailing address when no separate physical address was answered)",
    fields: {
      street: widget(4, "Pt4Line11_StreetNumberName"), unitNumber: widget(4, "Pt4Line11_AptSteFlrNumber"), city: widget(4, "Pt4Line11_CityOrTown"),
      state: widget(4, "Pt4Line11_State"), zip: widget(4, "Pt4Line11_ZipCode"), province: widget(4, "Pt4Line11_Province"),
      postalCode: widget(4, "Pt4Line11_PostalCode"), country: widget(4, "Pt4Line11_Country"),
    },
    unit: unitWidgets(4, "Pt4Line11_Unit"),
  }),
  ...addressBlock({
    source: B("intendedUsAddress"), note: "Item 12, U.S. address where the beneficiary intends to live",
    fields: {
      street: widget(4, "Pt4Line12a_StreetNumberName"), unitNumber: widget(4, "Pt4Line12b_AptSteFlrNumber"), city: widget(4, "Pt4Line12c_CityOrTown"),
      state: widget(4, "Pt4Line12d_State"), zip: widget(4, "Pt4Line12e_ZipCode"),
    },
    unit: unitWidgets(4, "Pt4Line12b_Unit"),
  }),
  ...addressBlock({
    source: B("outsideUsAddress"), note: "Item 13, beneficiary address outside the United States",
    fields: {
      street: widget(4, "Pt4Line13_StreetNumberName"), unitNumber: widget(4, "Pt4Line13_AptSteFlrNumber"), city: widget(4, "Pt4Line13_CityOrTown"),
      province: widget(4, "Pt4Line13_Province"), postalCode: widget(4, "Pt4Line13_PostalCode"), country: widget(4, "Pt4Line13_Country"),
    },
    unit: unitWidgets(4, "Pt4Line13_Unit"),
  }),
  // Item 16: beneficiary email - the beneficiary's own record (profile.beneficiary.email), never the petitioner's account.
  text(widget(5, "Pt4Line16_EmailAddress"), "beneficiary.email", "Item 16, beneficiary email (beneficiary record)."),

  // Item 18: beneficiary current marital status (verified indices: [0] W, [1] Annulled, [2] Separated, [3] Single/Never Married, [4] M, [5] D).
  dualCheckbox(widget(5, "Pt4Line18_MaritalStatus", 0), B("info_maritalStatus"), "widowed", "beneficiary.maritalStatus", ["widowed", "Widowed"], "Item 18, beneficiary marital status - Widowed (index 0, /W)."),
  dualCheckbox(widget(5, "Pt4Line18_MaritalStatus", 3), B("info_maritalStatus"), "single", "beneficiary.maritalStatus", ["single", "Single"], "Item 18, beneficiary marital status - Single, Never Married (index 3, /SNM; index 2 is Separated)."),
  dualCheckbox(widget(5, "Pt4Line18_MaritalStatus", 4), B("info_maritalStatus"), "married", "beneficiary.maritalStatus", ["married", "Married"], "Item 18, beneficiary marital status - Married (index 4, /M)."),
  dualCheckbox(widget(5, "Pt4Line18_MaritalStatus", 5), B("info_maritalStatus"), "divorced", "beneficiary.maritalStatus", ["divorced", "Divorced"], "Item 18, beneficiary marital status - Divorced (index 5, /D)."),

  // Spouse 2 = the beneficiary's prior spouse (Spouse 1 is the current spouse - see DECISIONS).
  text(widget(5, "Pt4Line18a_FamilyName"), B("priorSpouses", "0.lastName"), "Spouse 2 family name - the beneficiary's prior spouse (prior-spouse row 1)."),
  text(widget(5, "Pt4Line18b_GivenName"), B("priorSpouses", "0.firstName"), "Spouse 2 given name - the beneficiary's prior spouse."),
  text(widget(5, "Pt4Line18c_MiddleName"), B("priorSpouses", "0.middleName"), "Spouse 2 middle name - the beneficiary's prior spouse."),
  date(widget(5, "Pt4Line17_DateMarriageEnded", 1), B("priorSpouses", "0.dateMarriageEnded"), "Spouse 2 date marriage ended - the beneficiary's prior marriage."),

  // Beneficiary's children -> "Information About Beneficiary's Family" Person 1-5.
  ...personBlock({ i: 0, sf: 5, family: "Pt4Line30a_FamilyName", given: "Pt4Line30b_GivenName", middle: "Pt4Line30c_MiddleName", relationship: "Pt4Line31_Relationship", dob: "Pt4Line32_DateOfBirth", country: "Pt4Line49_CountryOfBirth", countryIndex: 0, note: "Family Person 1, beneficiary's child (child row 1)" }),
  ...personBlock({ i: 1, sf: 5, family: "Pt4Line34a_FamilyName", given: "Pt4Line34b_GivenName", middle: "Pt4Line34c_MiddleName", relationship: "Pt4Line35_Relationship", dob: "Pt4Line36_DateOfBirth", country: "Pt4Line37_CountryOfBirth", note: "Family Person 2, beneficiary's child (child row 2)" }),
  ...personBlock({ i: 2, sf: 5, family: "Pt4Line38a_FamilyName", given: "Pt4Line38b_GivenName", middle: "Pt4Line38c_MiddleName", relationship: "Pt4Line39_Relationship", dob: "Pt4Line40_DateOfBirth", country: "Pt4Line41_CountryOfBirth", note: "Family Person 3, beneficiary's child (child row 3)" }),
  ...personBlock({ i: 3, sf: 6, family: "Pt4Line42a_FamilyName", given: "Pt4Line42b_GivenName", middle: "Pt4Line42c_MiddleName", relationship: "Pt4Line43_Relationship", dob: "Pt4Line44_DateOfBirth", country: "Pt4Line45_CountryOfBirth", note: "Family Person 4, beneficiary's child (child row 4)" }),
  ...personBlock({ i: 4, sf: 6, family: "Pt4Line46a_FamilyName", given: "Pt4Line46b_GivenName", middle: "Pt4Line46c_MiddleName", relationship: "Pt4Line47_Relationship", dob: "Pt4Line48_DateOfBirth", country: "Pt4Line49_CountryOfBirth", countryIndex: 1, note: "Family Person 5, beneficiary's child (child row 5)" }),

  // Items 45-50: entry information.
  checkbox(widget(6, "Pt4Line20_Yes"), B("usHistory_everBeenToUS"), "Yes", "Item 45 - beneficiary ever in the United States: Yes."),
  checkbox(widget(6, "Pt4Line20_No"), B("usHistory_everBeenToUS"), "No", "Item 45 - beneficiary ever in the United States: No."),
  text(widget(6, "Pt4Line21a_ClassOfAdmission"), B("usHistory_visaOnWhichArrived"), "Item 46.A, class of admission the beneficiary arrived as (dropdown: only a matching choice is applied)."),
  text("form1[0].#subform[6].#area[8].Pt4Line21b_ArrivalDeparture[0]", B("usHistory_i94Number"), "Item 46.B, I-94 number."),
  date(widget(6, "Pt4Line21c_DateOfArrival"), B("usHistory_dateOfLastArrival"), "Item 46.C, date of last arrival."),
  date(widget(6, "Pt4Line21d_DateExpired"), B("usHistory_i94ExpiryDate"), "Item 46.D, date authorized stay expires (I-94 expiry; falls back to the 'date status expires' answer).", { fallback: B("usHistory_dateStatusExpires") }),
  text(widget(6, "Pt4Line22_PassportNumber"), B("usHistory_passportNumber"), "Item 47, passport number."),
  text(widget(6, "Pt4Line24_CountryOfIssuance"), B("usHistory_passportCountryOfIssuance"), "Item 49, passport country of issuance."),
  date(widget(6, "Pt4Line25_ExpDate"), B("usHistory_passportExpirationDate"), "Item 50, passport expiration date."),

  // Items 51-52: beneficiary's CURRENT employment = the most recent employment row, only when it has no end date.
  ...(() => {
    const row = (col) => B("employmentHistory", `0.${col}`);
    const current = all(exists(row("employerName")), empty(row("to")));
    const aw = (name) => widget(6, `Pt4Line26_${name}`);
    const gate = (item) => ({ ...item, condition: current });
    return [
      gate(text(aw("NameOfCompany"), row("employerName"), "Item 51.A, beneficiary's current employer (most recent employment row with no end date).")),
      ...addressBlock({
        source: row("employerAddress"), note: "Item 51, beneficiary's current employer address",
        fields: { street: aw("StreetNumberName"), unitNumber: aw("AptSteFlrNumber"), city: aw("CityOrTown"), state: aw("State"), zip: aw("ZipCode"), province: aw("Province"), postalCode: aw("PostalCode"), country: aw("Country") },
        unit: unitWidgets(6, "Pt4Line26_Unit"),
      }).map(gate),
      gate(date(widget(6, "Pt4Line27_DateEmploymentBegan"), row("from"), "Item 52, date the beneficiary's current employment began.")),
    ];
  })(),
];

const MANUAL_ENTRY_REASONS = {
  not_collected_by_checklist: [
    "Part 1 items 2-4 (child/parent/sibling relationship detail), Part 2 item 5 / Part 4 item 5 other names used",
    "Part 2 items 16, 18-21 (number of marriages, date/place of current marriage, current spouse = the beneficiary - not copied across the role boundary)",
    "Part 2 items 40-41 (lawful permanent resident details - a K-3 petitioner is a citizen)",
    "Part 4 item 2 beneficiary USCIS Online Account Number, 10 prior petitions, 14-15 phone numbers, 17-20 number/date/place of marriage and the current spouse",
    "Part 4 items 48 travel document, 53-56 immigration proceedings, 57-59 name/address in native alphabet",
    "Parts 5-8 sworn statements, interpreter, preparer, additional information",
  ],
  petitioner_biographic_part3_not_filled_from_beneficiary: [
    "Part 3 (ethnicity/race/height/weight/eye+hair colour) is the PETITIONER's biographic block. The checklist's 'Biographical Information' is asked of the BENEFICIARY, so it is deliberately NOT mapped - doing so would put the beneficiary's data in the petitioner's section.",
  ],
  beyond_the_forms_slots: [
    "residence/employment/prior-spouse rows beyond the form's own slots (two addresses, two employers, one prior spouse per party) and children beyond Person 5 - use Part 8 Additional Information",
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
    note: "Not collected by the K-3 checklists (or deliberately left to the case manager) - see MANUAL_ENTRY_REASONS in this file.",
  };
}

module.exports = { FORM_CODE, VERSION, USCIS_USE_ONLY_PATTERNS, MAPPED_EDGES, MANUAL_ENTRY_REASONS, classifyField };
