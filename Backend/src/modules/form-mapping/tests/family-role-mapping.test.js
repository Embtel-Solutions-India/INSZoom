// DB-free proof that the K-1 (I-129F) and K-3 (I-130) crosswalks fill every
// petitioner widget ONLY from petitioner answers and every beneficiary widget
// ONLY from beneficiary answers - never swapped, never blank when the answer
// exists, never cross-contaminated.
//
// Reuses the REAL resolution path (FormMappingService.applyMappingGraph +
// mapTemplate -> MappingResolver) over the crosswalks' own edges, so a change
// to either the edges or the resolver is caught here. The widget names are
// checked against the real PDFs by the *-crosswalk-coverage tests.
const assert = require("node:assert/strict");
const test = require("node:test");

const FormMappingService = require("../services/FormMappingService");
const i129f = require("../config/i129f-k1-crosswalk");
const i130 = require("../config/i130-k3-crosswalk");
const { mappingTypeFor } = require("../config/family-crosswalk-helpers");
const k1 = require("../../family-workflow/questionnaires/k1");

const CATALOG_KEYS = new Set(k1.fieldCatalog().map((entry) => entry.path.replace(/\./g, "_")));

const PETITIONER = {
  info_lastName: "Whitfield", info_firstName: "Daniel", info_middleName: "Ray", info_gender: "Male", info_dateOfBirth: "1985-04-12",
  info_cityTownOfBirth: "Columbus", info_stateProvinceOfBirth: "OH", info_countryOfBirth: "United States", info_countryOfCitizenship: "United States",
  info_fullMailingAddress: "12 Oak St Apt 4B, Columbus, OH 43004", info_ssn: "111-22-3333", info_uscisOnlineAccountNumber: "100200300400",
  info_aNumber: "A111111111", info_maritalStatus: "divorced",
  residentialHistory: [
    { streetAndNumber: "12 Oak St Apt 4B", city: "Columbus", provinceState: "OH", country: "United States", from: "2019-03-01", to: "" },
    { streetAndNumber: "9 Elm Road", city: "Dayton", provinceState: "Ohio", country: "USA", from: "2015-01-10", to: "2019-02-28" },
  ],
  employmentHistory: [
    { employerName: "Acme Corp", employerAddress: "100 Market St, Columbus, OH 43215", occupation: "Engineer", from: "2018-05-01", to: "" },
    { employerName: "Beta LLC", employerAddress: "7 Pine Ave, Dayton, OH 45402", occupation: "Analyst", from: "2014-02-01", to: "2018-04-30" },
  ],
  parents_fatherLastName: "Whitfield", parents_fatherFirstName: "Robert", parents_fatherMiddleName: "J", parents_fatherDateOfBirth: "1955-01-02",
  parents_fatherCountryOfBirth: "United States", parents_fatherCityTownVillageOfResidence: "Toledo", parents_fatherCountryOfResidence: "United States",
  parents_motherLastName: "Hale", parents_motherFirstName: "Susan", parents_motherMiddleName: "M", parents_motherDateOfBirth: "1957-03-04",
  parents_motherCountryOfBirth: "Canada", parents_motherCityTownVillageOfResidence: "Toledo", parents_motherCountryOfResidence: "United States",
  priorSpouses: [{ lastName: "Prior", firstName: "Pat", middleName: "Q", dateMarriageEnded: "2015-06-30" }],
  citizenship_throughType: "Naturalization", citizenship_hasCertificate: "Yes", citizenship_certificateNumber: "N-1234567",
  citizenship_certificatePlaceOfIssuance: "Cleveland, OH", citizenship_certificateDateOfIssuance: "2001-07-04",
  i129f_filedBefore: "No", children_hasChildrenUnder18: "Yes", children_ages: "5, 8",
  statesCountriesSince18: [{ state: "OH", country: "United States" }, { state: "", country: "Canada" }],
};

const BENEFICIARY = {
  info_lastName: "Fontaine", info_firstName: "Elise", info_middleName: "Marie", info_gender: "Female", info_dateOfBirth: "1990-09-30",
  info_cityTownOfBirth: "Lyon", info_stateProvinceOfBirth: "Auvergne", info_countryOfBirth: "France", info_countryOfCitizenship: "France",
  info_fullMailingAddress: "5 Rue de la Paix, Lyon, 69001, France", info_ssn: "", info_aNumber: "A222222222", info_maritalStatus: "single",
  residentialHistory: [
    { streetAndNumber: "5 Rue de la Paix", city: "Lyon", provinceState: "Auvergne", country: "France", from: "2020-01-01", to: "" },
    { streetAndNumber: "3 Quai Saint-Antoine", city: "Lyon", provinceState: "Auvergne", country: "France", from: "2012-05-05", to: "2019-12-31" },
  ],
  employmentHistory: [
    { employerName: "Maison Lumiere", employerAddress: "8 Rue Victor Hugo, Lyon, France", occupation: "Designer", from: "2016-09-01", to: "" },
  ],
  parents_fatherLastName: "Fontaine", parents_fatherFirstName: "Louis", parents_fatherDateOfBirth: "1958-08-08", parents_fatherCountryOfBirth: "France",
  parents_motherLastName: "Girard", parents_motherFirstName: "Claire", parents_motherDateOfBirth: "1960-09-09", parents_motherCountryOfBirth: "Belgium",
  usHistory_everBeenToUS: "Yes", usHistory_i94Number: "99887766554", usHistory_dateOfLastArrival: "2023-06-15", usHistory_visaOnWhichArrived: "B-2",
  usHistory_i94ExpiryDate: "2023-12-15", usHistory_passportNumber: "X1234567", usHistory_passportCountryOfIssuance: "France", usHistory_passportExpirationDate: "2030-01-01",
  children: [{ lastName: "Fontaine", firstName: "Leo", middleName: "A", dateOfBirth: "2014-02-03", countryOfBirth: "France" }],
  intendedUsAddress: "77 Maple Dr Suite 5, Cleveland, OH 44101", outsideUsAddress: "5 Rue de la Paix, Lyon, 69001, France",
  consulateCityCountry: "Paris, France", marriageBroker_usedBroker: "No", metWithinTwoYears: "Yes",
};

function answersFor(role, data) {
  const out = {};
  Object.entries(data).forEach(([path, value]) => {
    const key = `${role}_${path}`;
    assert.ok(CATALOG_KEYS.has(key), `fixture key ${key} must be a real k1/k3 checklist question key`);
    out[key] = { value, status: "submitted" };
  });
  return out;
}

function canonicalFor({ visaType, petitioner = PETITIONER, beneficiary = BENEFICIARY, extra = {} }) {
  return {
    case: { visaType },
    raw: { questionnaireAnswers: { ...(petitioner ? answersFor("petitioner", petitioner) : {}), ...(beneficiary ? answersFor("beneficiary", beneficiary) : {}) } },
    petitioner: { email: "daniel.whitfield@example.com", phone: "6145550100" },
    beneficiary: { email: "elise.fontaine@example.com" },
    ...extra,
  };
}

// Resolve every crosswalk edge exactly like AutoFillService would: persisted
// graph edge -> applyMappingGraph -> mapTemplate.
function runCrosswalk(crosswalk, canonicalData) {
  const edges = crosswalk.MAPPED_EDGES.map((edge, index) => ({
    mappingId: `t:${index}`, sourcePath: edge.source, targetFieldId: edge.fieldName, mappingType: mappingTypeFor(edge),
    transform: edge.transform || { type: "direct" }, condition: edge.condition, fallback: edge.fallback, status: "active",
  }));
  const template = { formFields: crosswalk.MAPPED_EDGES.map((edge) => ({ fieldId: edge.fieldName, fieldName: edge.fieldName })) };
  FormMappingService.applyMappingGraph(template, { graph: { edges }, mappingVersion: 1, _id: "mv" });
  return FormMappingService.mapTemplate(template, canonicalData).fieldValues;
}

const field = (values, name) => values[name];
const f129 = (sf, name, idx = 0) => `form1[0].#subform[${sf}].${name}[${idx}]`;

test("I-129F (K-1): Part 1 is petitioner-only and Part 2 is beneficiary-only for identity, birth, marital status, sex and A-number/SSN", () => {
  const v = runCrosswalk(i129f, canonicalFor({ visaType: "K-1" }));
  // Petitioner (Part 1)
  assert.equal(v[f129(0, "Pt1Line6a_FamilyName")], "Whitfield");
  assert.equal(v[f129(0, "Pt1Line6b_GivenName")], "Daniel");
  assert.equal(v[f129(0, "Pt1Line6c_MiddleName")], "Ray");
  assert.equal(v[f129(0, "Pt1Line1_AlienNumber")], "111111111", "A-number is digits only (9-char widget, 'A-' pre-printed)");
  assert.equal(v[f129(0, "Pt1Line3_SSN")], "111223333", "SSN is digits only (9-char widget)");
  assert.equal(v[f129(2, "Pt1Line22_DateofBirth")], "04/12/1985");
  assert.equal(v[f129(2, "Pt1Line24_CityTownOfBirth")], "Columbus");
  assert.equal(v[f129(2, "Pt1Line25_ProvinceOrStateOfBirth")], "OH");
  assert.equal(v[f129(2, "Pt1Line26_CountryOfCitzOrNationality")], "United States", "Item 26 is COUNTRY OF BIRTH (widget name says citizenship)");
  // Beneficiary (Part 2)
  assert.equal(v[f129(3, "Pt2Line1a_FamilyName")], "Fontaine");
  assert.equal(v[f129(3, "Pt2Line1b_GivenName")], "Elise");
  assert.equal(v[f129(3, "Pt2Line1c_MiddleName")], "Marie");
  assert.equal(v[f129(3, "Pt2Line2_AlienNumber")], "222222222");
  assert.equal(v[f129(3, "Pt2Line3_SSN")], undefined, "an unanswered beneficiary SSN stays blank - it never borrows the petitioner's");
  assert.equal(v[f129(3, "Pt2Line4_DateOfBirth")], "09/30/1990");
  assert.equal(v[f129(3, "Pt2Line7_CityTownOfBirth")], "Lyon");
  assert.equal(v[f129(3, "Pt2Line8_CountryOfBirth")], "France");
  assert.equal(v[f129(3, "Pt2Line9_CountryofCitzOrNationality")], "France");
});

test("I-129F (K-1): exactly one sex box and one marital-status box per party, on the right index", () => {
  const v = runCrosswalk(i129f, canonicalFor({ visaType: "K-1" }));
  // Petitioner: Male, divorced (index 1). Beneficiary: Female, single (index 2).
  assert.equal(v[f129(2, "Pt1Line21_Checkbox", 0)], true);
  assert.equal(v[f129(2, "Pt1Line21_Checkbox", 1)], undefined);
  assert.deepEqual([0, 1, 2, 3].map((i) => v[f129(2, "Pt1Line23_Checkbox", i)] === true), [false, true, false, false]);
  assert.equal(v[f129(3, "Pt2Line5_Checkboxes", 0)], undefined);
  assert.equal(v[f129(3, "Pt2Line5_Checkboxes", 1)], true);
  assert.deepEqual([0, 1, 2, 3].map((i) => v[f129(3, "Pt2Line6_Checkboxes", i)] === true), [false, false, true, false]);
});

test("I-129F (K-1): addresses, history rows, parents, prior spouse and children land in the right party's block", () => {
  const v = runCrosswalk(i129f, canonicalFor({ visaType: "K-1" }));
  // Petitioner mailing address (Item 8) parsed from one free-text answer.
  assert.equal(v[f129(0, "Pt1Line8_StreetNumberName")], "12 Oak St");
  assert.equal(v[f129(0, "Pt1Line8_Unit", 1)], true, "Apt checkbox (index 1 on this block)");
  assert.equal(v[f129(0, "Pt1Line8_AptSteFlrNumber")], "4B");
  assert.equal(v[f129(0, "Pt1Line8_CityOrTown")], "Columbus");
  assert.equal(v[f129(0, "Pt1Line8_State")], "OH");
  assert.equal(v[f129(0, "Pt1Line8_ZipCode")], "43004");
  assert.equal(v[f129(0, "Pt1Line8_Country")], "United States");
  assert.equal(v[f129(0, "Pt1Line8j_Checkboxes", 0)], true, "no separate physical address answered -> mailing == physical");
  // Petitioner residence rows -> Physical Address One / Two.
  assert.equal(v[f129(1, "Pt1Line9_StreetNumberName")], "12 Oak St");
  assert.equal(v[f129(1, "Pt1Line9_State")], "OH");
  assert.equal(v[f129(1, "Pt1Line10a_DateFrom")], "03/01/2019");
  assert.equal(v[f129(1, "Pt1Line11_CityOrTown")], "Dayton");
  assert.equal(v[f129(1, "Pt1Line11_State")], "OH", "'Ohio' is normalised to the state code");
  assert.equal(v[f129(1, "Pt1Line11_Country")], "United States", "'USA' is normalised");
  assert.equal(v[f129(1, "Pt1Line12b_ToFrom")], "02/28/2019");
  // Petitioner employer one + parents + prior spouse.
  assert.equal(v[f129(1, "Pt1Line13_NameofEmployer")], "Acme Corp");
  assert.equal(v[f129(1, "Pt1Line14_StreetNumberName")], "100 Market St");
  assert.equal(v[f129(1, "Pt1Line14_ZipCode")], "43215");
  assert.equal(v[f129(1, "Pt1Line15_Occupation")], "Engineer");
  assert.equal(v[f129(2, "Pt1Line27a_FamilyName")], "Whitfield");
  assert.equal(v[f129(2, "Pt1Line27b_GivenName")], "Robert");
  assert.equal(v[f129(2, "Pt1Line29_Checkbox", 0)], true, "Parent One is the father -> Male");
  assert.equal(v[f129(2, "Pt1Line32a_FamilyName")], "Hale");
  assert.equal(v[f129(2, "Pt1Line34_Checkbox", 1)], true, "Parent Two is the mother -> Female");
  assert.equal(v[f129(2, "Pt1Line37_Checkboxes", 0)], true, "divorced -> previously married: Yes");
  assert.equal(v[f129(2, "Pt1Line37_Checkboxes", 1)], undefined);
  assert.equal(v[f129(2, "Pt1Line38a_FamilyName")], "Prior");
  assert.equal(v[f129(2, "Pt1Line39_DateMarriageEnded")], "06/30/2015");
  // Citizenship + children.
  assert.equal(v[f129(2, "Pt1Line40_Checkbox", 1)], true);
  assert.equal(v[f129(2, "Pt1Line40_Checkbox", 0)], undefined);
  assert.equal(v[f129(3, "Pt1Line21a_CertificateNumber")], "N-1234567");
  assert.equal(v[f129(3, "Pt1Line48_Checkboxes", 0)], true);
  assert.equal(v[f129(3, "Pt1Line49a_Age")], "5");
  assert.equal(v[f129(3, "Pt1Line49b_Age")], "8");
  assert.equal(v[f129(3, "Pt1Line50a_State")], "OH");
  assert.equal(v[f129(3, "Pt1Line51b_CountryOfCitzOrNationality")], "Canada");
  assert.equal(v[f129(3, "Pt1Line51a_State")], undefined, "a non-US row never fills the State dropdown");
  // Beneficiary mailing address (foreign), physical rows, US address, address abroad, history, children, consulate, IMB, meeting.
  assert.equal(v[f129(4, "Pt2Line11_StreetNumberName")], "5 Rue de la Paix");
  assert.equal(v[f129(4, "Pt2Line11_CityOrTown")], "Lyon");
  assert.equal(v[f129(4, "Pt2Line11_PostalCode")], "69001");
  assert.equal(v[f129(4, "Pt2Line11_Country")], "France");
  assert.equal(v[f129(4, "Pt2Line11_State")], undefined);
  assert.equal(v[f129(4, "Pt2Line12_StreetNumberName")], "5 Rue de la Paix");
  assert.equal(v[f129(4, "Pt2Line12_Province")], "Auvergne", "non-US row province goes to the Province widget");
  assert.equal(v[f129(4, "Pt2Line12_State")], undefined);
  assert.equal(v[f129(4, "Pt2Line13a_DateFrom")], "01/01/2020");
  assert.equal(v[f129(4, "Pt2Line16_NameofEmployer")], "Maison Lumiere");
  assert.equal(v[f129(5, "Pt2Line24a_FamilyName")], "Fontaine");
  assert.equal(v[f129(5, "Pt2Line26_Checkbox", 0)], true);
  assert.equal(v[f129(5, "Pt2Line29a_FamilyName")], "Girard");
  assert.equal(v[f129(5, "Pt1Line11_DateofBirth")], "08/08/1958", "the misnamed Pt1Line11_DateofBirth widget is beneficiary Parent One's DOB (Part 2 item 25)");
  assert.equal(v[f129(5, "Pt2Line37_Checkboxes", 0)], true);
  assert.equal(v[f129(5, "Pt2Line38b_ArrivalDeparture")], "99887766554");
  assert.equal(v[f129(6, "Pt2Line38d_DateExpired")], "12/15/2023");
  assert.equal(v[f129(6, "Pt2Line38e_Passport")], "X1234567");
  assert.equal(v[f129(6, "Pt2Line40b_GivenName")], "Leo");
  assert.equal(v[f129(6, "Pt2Line45a_StreetNumberName")], "77 Maple Dr");
  assert.equal(v[f129(6, "Pt2Line45b_Unit", 0)], true, "Suite is index 0 on this block");
  assert.equal(v[f129(6, "Pt2Line45c_CityOrTown")], "Cleveland");
  assert.equal(v[f129(6, "Pt2Line45d_State")], "OH");
  assert.equal(v[f129(6, "Pt2Line47_StreetNumberName")], "5 Rue de la Paix");
  assert.equal(v[f129(6, "Pt2Line47_Country")], "France");
  assert.equal(v[f129(7, "Pt2Line62a_CityTown")], "Paris");
  assert.equal(v[f129(7, "Pt2Line62b_Country")], "France");
  assert.equal(v[f129(7, "Pt2Line55_Checkboxes", 1)], true);
  assert.equal(v[f129(7, "Pt2Line53_Checkboxes", 2)], true, "K-1: met in person -> Yes");
  assert.equal(v[f129(7, "Pt2Line53_Checkboxes", 0)], undefined);
  assert.equal(v[f129(7, "Pt2Line51_Checkboxes", 2)], undefined, "'beneficiary is my spouse' is K-3 only");
  // Classification + petitioner contact come from the case / the petitioner's own account.
  assert.equal(v[f129(0, "Pt1Line4a_Checkboxes", 0)], true);
  assert.equal(v[f129(0, "Pt1Line4a_Checkboxes", 1)], undefined);
  assert.equal(v[f129(9, "Pt5Line3_Email")], "daniel.whitfield@example.com", "petitioner contact is the petitioner's account, not the beneficiary's");
});

test("I-129F (K-3): classification and K-3-specific boxes follow the visa type", () => {
  const v = runCrosswalk(i129f, canonicalFor({ visaType: "K-3" }));
  assert.equal(v[f129(0, "Pt1Line4a_Checkboxes", 1)], true);
  assert.equal(v[f129(0, "Pt1Line4a_Checkboxes", 0)], undefined);
  assert.equal(v[f129(7, "Pt2Line51_Checkboxes", 2)], true);
  assert.equal(v[f129(7, "Pt2Line53_Checkboxes", 0)], true);
  assert.equal(v[f129(7, "Pt2Line53_Checkboxes", 2)], undefined);
});

// ---------------------------------------------------------------------------
// Role isolation: strip one party's answers entirely and prove NONE of that
// party's widgets fill and NONE of the other party's values leak in.
// ---------------------------------------------------------------------------
// The widget #subform[5].Pt1Line11_DateofBirth is misnamed: its tooltip is Part 2 item 25 (beneficiary Parent One DOB).
const MISNAMED_BENEFICIARY_129 = /#subform\[5\]\.Pt1Line11_DateofBirth/;
const isPetitionerWidget129 = (name) => /\.Pt1Line|\.Pt5Line/.test(name) && !/Pt1Line4a_Checkboxes/.test(name) && !MISNAMED_BENEFICIARY_129.test(name);
const isBeneficiaryWidget129 = (name) => (/\.Pt2Line/.test(name) && !/Pt2Line5[13]_Checkboxes/.test(name)) || MISNAMED_BENEFICIARY_129.test(name);

test("I-129F: with ONLY petitioner answers, no beneficiary widget fills; with ONLY beneficiary answers, no petitioner widget fills", () => {
  const onlyPetitioner = runCrosswalk(i129f, canonicalFor({ visaType: "K-1", beneficiary: null, extra: { beneficiary: undefined } }));
  const leakedIntoBeneficiary = Object.keys(onlyPetitioner).filter(isBeneficiaryWidget129);
  assert.deepEqual(leakedIntoBeneficiary, [], "no beneficiary widget may be filled from petitioner data");
  assert.ok(Object.keys(onlyPetitioner).filter(isPetitionerWidget129).length > 60, "petitioner widgets still fill");

  const onlyBeneficiary = runCrosswalk(i129f, canonicalFor({ visaType: "K-1", petitioner: null, extra: { petitioner: undefined } }));
  const leakedIntoPetitioner = Object.keys(onlyBeneficiary).filter(isPetitionerWidget129);
  assert.deepEqual(leakedIntoPetitioner, [], "no petitioner widget may be filled from beneficiary data");
  assert.ok(Object.keys(onlyBeneficiary).filter(isBeneficiaryWidget129).length > 50, "beneficiary widgets still fill");
});

test("I-129F: no widget in one party's part ever holds a value that only the other party supplied", () => {
  const v = runCrosswalk(i129f, canonicalFor({ visaType: "K-1" }));
  const strings = (data) => new Set(JSON.stringify(data).match(/"[^"]{3,}"/g)?.map((s) => s.slice(1, -1)) || []);
  const petitionerOnly = [...strings(PETITIONER)].filter((s) => !strings(BENEFICIARY).has(s));
  const beneficiaryOnly = [...strings(BENEFICIARY)].filter((s) => !strings(PETITIONER).has(s));
  const digitsOf = (s) => s.replace(/\D/g, "");
  Object.entries(v).forEach(([name, value]) => {
    if (typeof value !== "string") return;
    if (isBeneficiaryWidget129(name)) {
      assert.ok(!petitionerOnly.some((s) => value === s || (digitsOf(s).length >= 6 && value === digitsOf(s))), `${name} (beneficiary widget) holds petitioner-only value "${value}"`);
    }
    if (isPetitionerWidget129(name)) {
      assert.ok(!beneficiaryOnly.some((s) => value === s || (digitsOf(s).length >= 6 && value === digitsOf(s))), `${name} (petitioner widget) holds beneficiary-only value "${value}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// I-130 (K-3)
// ---------------------------------------------------------------------------
const f130 = (sf, name, idx = 0) => `form1[0].#subform[${sf}].${name}[${idx}]`;
// Pt2Line36_USCitizen is case-driven (a K-3 petitioner is by definition a citizen), not answer-driven.
const isPetitionerWidget130 = (name) => /\.Pt2Line|\.PtLine20/.test(name) && !/Pt2Line36_USCitizen/.test(name);
const isBeneficiaryWidget130 = (name) => /\.Pt4Line|\.P4Line/.test(name);

test("I-130 (K-3): Part 2 is petitioner-only and Part 4 is beneficiary-only", () => {
  const v = runCrosswalk(i130, canonicalFor({ visaType: "K-3" }));
  assert.equal(v[f130(0, "Pt1Line1_Spouse")], true);
  assert.equal(v[f130(0, "Pt2Line4a_FamilyName")], "Whitfield");
  assert.equal(v[f130(0, "Pt2Line4b_GivenName")], "Daniel");
  assert.equal(v[f130(0, "Pt2Line4c_MiddleName")], "Ray");
  assert.equal(v["form1[0].#subform[0].#area[4].Pt2Line1_AlienNumber[0]"], "111111111");
  assert.equal(v[f130(0, "Pt2Line11_SSN")], "111223333");
  assert.equal(v[f130(1, "Pt2Line6_CityTownOfBirth")], "Columbus");
  assert.equal(v[f130(1, "Pt2Line7_CountryofBirth")], "United States");
  assert.equal(v[f130(1, "Pt2Line8_DateofBirth")], "04/12/1985");
  assert.equal(v[f130(4, "Pt4Line4a_FamilyName")], "Fontaine");
  assert.equal(v[f130(4, "Pt4Line4b_GivenName")], "Elise");
  assert.equal(v[f130(4, "Pt4Line4c_MiddleName")], "Marie");
  assert.equal(v["form1[0].#subform[4].#area[6].Pt4Line1_AlienNumber[0]"], "222222222");
  assert.equal(v[f130(4, "Pt4Line3_SSN")], undefined, "unanswered beneficiary SSN stays blank");
  assert.equal(v[f130(4, "Pt4Line7_CityTownOfBirth")], "Lyon");
  assert.equal(v[f130(4, "Pt4Line8_CountryOfBirth")], "France");
  assert.equal(v[f130(4, "Pt4Line9_DateOfBirth")], "09/30/1990");
});

test("I-130 (K-3): exactly one sex box and one marital box per party - Male XOR Female, and beneficiary Single is index 3 (not Separated, index 2)", () => {
  const v = runCrosswalk(i130, canonicalFor({ visaType: "K-3" }));
  assert.equal(v[f130(1, "Pt2Line9_Male")], true);
  assert.equal(v[f130(1, "Pt2Line9_Female")], undefined);
  assert.equal(v[f130(4, "Pt4Line9_Male")], undefined);
  assert.equal(v[f130(4, "Pt4Line9_Female")], true);
  const petitionerMarital = ["Widowed", "Single", "Married", "Divorced"].filter((name) => v[f130(1, `Pt2Line17_${name}`)] === true);
  assert.deepEqual(petitionerMarital, ["Divorced"]);
  const beneficiaryMarital = [0, 1, 2, 3, 4, 5].filter((i) => v[f130(5, "Pt4Line18_MaritalStatus", i)] === true);
  assert.deepEqual(beneficiaryMarital, [3], "single -> 'Single, Never Married' (index 3, /SNM)");
  // And the other statuses land on their own indices.
  const married = runCrosswalk(i130, canonicalFor({ visaType: "K-3", beneficiary: { ...BENEFICIARY, info_maritalStatus: "married" } }));
  assert.deepEqual([0, 1, 2, 3, 4, 5].filter((i) => married[f130(5, "Pt4Line18_MaritalStatus", i)] === true), [4]);
  const widowed = runCrosswalk(i130, canonicalFor({ visaType: "K-3", beneficiary: { ...BENEFICIARY, info_maritalStatus: "widowed" } }));
  assert.deepEqual([0, 1, 2, 3, 4, 5].filter((i) => widowed[f130(5, "Pt4Line18_MaritalStatus", i)] === true), [0]);
  const divorced = runCrosswalk(i130, canonicalFor({ visaType: "K-3", beneficiary: { ...BENEFICIARY, info_maritalStatus: "divorced" } }));
  assert.deepEqual([0, 1, 2, 3, 4, 5].filter((i) => divorced[f130(5, "Pt4Line18_MaritalStatus", i)] === true), [5]);
});

test("I-130 (K-3): addresses, history, parents, prior spouses, children, entry info and citizenship land in the right party's block", () => {
  const v = runCrosswalk(i130, canonicalFor({ visaType: "K-3" }));
  assert.equal(v[f130(1, "Pt2Line10_StreetNumberName")], "12 Oak St");
  assert.equal(v[f130(1, "Pt2Line10_Unit", 0)], true, "Apt is index 0 on the I-130 address blocks");
  assert.equal(v[f130(1, "Pt2Line10_AptSteFlrNumber")], "4B");
  assert.equal(v[f130(1, "Pt2Line10_State")], "OH");
  assert.equal(v[f130(1, "Pt2Line10_ZipCode")], "43004");
  assert.equal(v[f130(1, "Pt2Line11_Yes")], true);
  assert.equal(v[f130(1, "Pt2Line12_StreetNumberName")], "12 Oak St");
  assert.equal(v[f130(1, "Pt2Line13a_DateFrom")], "03/01/2019");
  assert.equal(v[f130(1, "Pt2Line14_CityOrTown")], "Dayton");
  assert.equal(v[f130(1, "Pt2Line15b_DateTo")], "02/28/2019");
  assert.equal(v[f130(2, "Pt2Line22a_FamilyName")], "Prior");
  assert.equal(v[f130(2, "Pt2Line23_DateMarriageEnded")], "06/30/2015");
  assert.equal(v[f130(2, "Pt2Line24_FamilyName")], "Whitfield");
  assert.equal(v[f130(2, "Pt2Line26_Male")], true);
  assert.equal(v[f130(2, "Pt2Line30a_FamilyName")], "Hale");
  assert.equal(v[f130(2, "Pt2Line32_Female")], true);
  assert.equal(v[f130(2, "Pt2Line36_USCitizen")], true);
  assert.equal(v[f130(2, "Pt2Line23b_checkbox")], true, "citizenship through Naturalization");
  assert.equal(v[f130(2, "Pt2Line36_Yes")], true);
  assert.equal(v[f130(2, "Pt2Line37a_CertificateNumber")], "N-1234567");
  assert.equal(v[f130(2, "Pt2Line37c_DateOfIssuance")], "07/04/2001");
  assert.equal(v[f130(3, "Pt2Line40_EmployerOrCompName")], "Acme Corp");
  assert.equal(v[f130(3, "Pt2Line44_EmployerOrOrgName")], "Beta LLC");
  assert.equal(v[f130(3, "Pt2Line43a_DateFrom")], "05/01/2018");
  // Beneficiary
  assert.equal(v[f130(4, "Pt4Line11_StreetNumberName")], "5 Rue de la Paix", "no separate physical address answered -> falls back to the beneficiary's own mailing address");
  assert.equal(v[f130(4, "Pt4Line11_Country")], "France");
  assert.equal(v[f130(4, "Pt4Line12a_StreetNumberName")], "77 Maple Dr");
  assert.equal(v[f130(4, "Pt4Line12b_Unit", 1)], true, "Suite is index 1 on the I-130 blocks");
  assert.equal(v[f130(4, "Pt4Line12d_State")], "OH");
  assert.equal(v[f130(4, "Pt4Line13_StreetNumberName")], "5 Rue de la Paix");
  assert.equal(v[f130(4, "Pt4Line13_PostalCode")], "69001");
  assert.equal(v[f130(5, "Pt4Line16_EmailAddress")], "elise.fontaine@example.com", "beneficiary email is the beneficiary's own, not the petitioner's");
  assert.equal(v[f130(5, "Pt4Line30a_FamilyName")], "Fontaine");
  assert.equal(v[f130(5, "Pt4Line30b_GivenName")], "Leo");
  assert.equal(v[f130(5, "Pt4Line31_Relationship")], "Child");
  assert.equal(v[f130(5, "Pt4Line32_DateOfBirth")], "02/03/2014");
  assert.equal(v[f130(5, "Pt4Line49_CountryOfBirth", 0)], "France");
  assert.equal(v[f130(5, "Pt4Line34a_FamilyName")], undefined, "no second child -> Person 2 stays blank");
  assert.equal(v[f130(6, "Pt4Line20_Yes")], true);
  assert.equal(v["form1[0].#subform[6].#area[8].Pt4Line21b_ArrivalDeparture[0]"], "99887766554");
  assert.equal(v[f130(6, "Pt4Line21d_DateExpired")], "12/15/2023");
  assert.equal(v[f130(6, "Pt4Line22_PassportNumber")], "X1234567");
  assert.equal(v[f130(6, "Pt4Line26_NameOfCompany")], "Maison Lumiere", "current employment = latest row with no end date");
});

test("I-130 (K-3): a beneficiary employer with an end date is NOT reported as current employment", () => {
  const beneficiary = { ...BENEFICIARY, employmentHistory: [{ employerName: "Old Co", employerAddress: "1 Rue X, Paris, France", occupation: "Clerk", from: "2010-01-01", to: "2015-01-01" }] };
  const v = runCrosswalk(i130, canonicalFor({ visaType: "K-3", beneficiary }));
  assert.equal(v[f130(6, "Pt4Line26_NameOfCompany")], undefined);
  assert.equal(v[f130(6, "Pt4Line27_DateEmploymentBegan")], undefined);
});

test("I-130: with ONLY petitioner answers no Part 4 widget fills; with ONLY beneficiary answers no Part 2 widget fills", () => {
  const onlyPetitioner = runCrosswalk(i130, canonicalFor({ visaType: "K-3", beneficiary: null, extra: { beneficiary: undefined } }));
  assert.deepEqual(Object.keys(onlyPetitioner).filter(isBeneficiaryWidget130), []);
  assert.ok(Object.keys(onlyPetitioner).filter(isPetitionerWidget130).length > 60);
  const onlyBeneficiary = runCrosswalk(i130, canonicalFor({ visaType: "K-3", petitioner: null, extra: { petitioner: undefined } }));
  assert.deepEqual(Object.keys(onlyBeneficiary).filter(isPetitionerWidget130), []);
  assert.ok(Object.keys(onlyBeneficiary).filter(isBeneficiaryWidget130).length > 40);
});

test("I-130: a polluted canonical person.* (the beneficiary's data) can never override the petitioner's role-keyed answers", () => {
  const polluted = canonicalFor({
    visaType: "K-3",
    extra: {
      person: { firstName: "Elise", lastName: "Fontaine", dob: "1990-09-30", gender: "female", maritalStatus: "single", alienNumber: "A222222222", countryOfBirth: "France" },
    },
  });
  const v = runCrosswalk(i130, polluted);
  assert.equal(v[f130(0, "Pt2Line4a_FamilyName")], "Whitfield");
  assert.equal(v[f130(0, "Pt2Line4b_GivenName")], "Daniel");
  assert.equal(v[f130(1, "Pt2Line8_DateofBirth")], "04/12/1985");
  assert.equal(v[f130(1, "Pt2Line9_Male")], true);
  assert.equal(v[f130(1, "Pt2Line9_Female")], undefined);
});

test("I-130 (IR/CR/F checklists share this graph): canonical person.* / beneficiary.* still fill the right party, one box per group", () => {
  const canonicalOnly = {
    case: { visaType: "IR-1" },
    raw: { questionnaireAnswers: {} },
    person: { lastName: "Nguyen", firstName: "Daniel", dob: "1978-04-11", gender: "male", maritalStatus: "married", alienNumber: "A987654321", ssn: "123-45-6789" },
    beneficiary: { lastName: "Tran", firstName: "Mai", dateOfBirth: "1985-09-22", gender: "female", maritalStatus: "married", alienRegistrationNumber: "A123456789" },
  };
  const v = runCrosswalk(i130, canonicalOnly);
  assert.equal(v[f130(0, "Pt2Line4a_FamilyName")], "Nguyen");
  assert.equal(v[f130(0, "Pt2Line11_SSN")], "123456789");
  assert.equal(v[f130(1, "Pt2Line8_DateofBirth")], "04/11/1978");
  assert.equal(v[f130(1, "Pt2Line9_Male")], true);
  assert.equal(v[f130(1, "Pt2Line9_Female")], undefined);
  assert.equal(v[f130(1, "Pt2Line17_Married")], true);
  assert.equal(v[f130(1, "Pt2Line17_Single")], undefined);
  assert.equal(v[f130(4, "Pt4Line4a_FamilyName")], "Tran");
  assert.equal(v["form1[0].#subform[4].#area[6].Pt4Line1_AlienNumber[0]"], "123456789");
  assert.equal(v[f130(4, "Pt4Line9_Female")], true);
  assert.equal(v[f130(4, "Pt4Line9_Male")], undefined);
  assert.equal(v[f130(5, "Pt4Line18_MaritalStatus", 4)], true);
  assert.equal(v[f130(5, "Pt4Line18_MaritalStatus", 2)], undefined);
  assert.equal(v[f130(0, "Pt1Line1_Spouse")], undefined, "IR cases are unaffected by the K-3-only classification box");
});

// ---------------------------------------------------------------------------
// Structural guarantees over every edge of both crosswalks.
// ---------------------------------------------------------------------------
function partyOfKey(path) {
  const match = /raw\.questionnaireAnswers\.(petitioner|beneficiary)_/.exec(path || "");
  return match ? match[1] : null;
}

function referencedPaths(edge) {
  const paths = [edge.source, edge.fallback];
  const walk = (rule) => {
    if (!rule) return;
    if (rule.all) rule.all.forEach(walk);
    else if (rule.any) rule.any.forEach(walk);
    else paths.push(rule.field);
  };
  walk(edge.condition);
  return paths.filter(Boolean);
}

test("every I-129F Part 1 / I-130 Part 2 edge reads only petitioner answers and every Part 2 / Part 4 edge only beneficiary answers (source, fallback and condition)", () => {
  const checks = [
    { crosswalk: i129f, petitioner: { test: isPetitionerWidget129 }, beneficiary: { test: isBeneficiaryWidget129 } },
    { crosswalk: i130, petitioner: /\.(Pt2Line|PtLine20)/, beneficiary: /\.(Pt4Line|P4Line)/ },
  ];
  checks.forEach(({ crosswalk, petitioner, beneficiary }) => {
    crosswalk.MAPPED_EDGES.forEach((edge) => {
      const parties = new Set(referencedPaths(edge).map(partyOfKey).filter(Boolean));
      if (petitioner.test(edge.fieldName)) assert.ok(!parties.has("beneficiary"), `${crosswalk.FORM_CODE} ${edge.fieldName} (petitioner widget) references a beneficiary answer`);
      if (beneficiary.test(edge.fieldName)) assert.ok(!parties.has("petitioner"), `${crosswalk.FORM_CODE} ${edge.fieldName} (beneficiary widget) references a petitioner answer`);
      // Canonical fallbacks are role-scoped too: person.* is the petitioner, beneficiary.* the beneficiary.
      if (petitioner.test(edge.fieldName)) assert.ok(!/^beneficiary\./.test(edge.fallback || ""), `${edge.fieldName} falls back to beneficiary.*`);
      if (beneficiary.test(edge.fieldName)) assert.ok(!/^person\./.test(edge.fallback || ""), `${edge.fieldName} falls back to person.*`);
    });
  });
});

test("every checkbox edge carries a condition (a boolean edge without one ticks the box for every answer)", () => {
  [i129f, i130].forEach((crosswalk) => {
    crosswalk.MAPPED_EDGES.filter((edge) => edge.transform?.type === "boolean").forEach((edge) => {
      assert.ok(edge.condition, `${crosswalk.FORM_CODE} ${edge.fieldName} is a boolean edge with no condition`);
    });
  });
});

test("no widget is mapped twice (the graph allows one edge per target)", () => {
  [i129f, i130].forEach((crosswalk) => {
    const names = crosswalk.MAPPED_EDGES.map((edge) => edge.fieldName);
    assert.deepEqual(names.filter((name, index) => names.indexOf(name) !== index), []);
  });
});

test("the beneficiary's biographic answers are never mapped into the petitioner's biographic part (I-129F Part 4 / I-130 Part 3)", () => {
  [i129f, i130].forEach((crosswalk) => {
    const used = crosswalk.MAPPED_EDGES.flatMap(referencedPaths).filter((path) => /biographical/.test(path));
    assert.deepEqual(used, [], `${crosswalk.FORM_CODE} must not read beneficiary_biographical_*`);
  });
});
