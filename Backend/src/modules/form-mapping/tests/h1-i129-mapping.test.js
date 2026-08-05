// Phase H1 acceptance tests. Like Phase H0's h0-i129-seed.test.js, this
// connects to the REAL configured MongoDB and exercises the REAL
// AutoFillService.generate() pipeline against a golden H-1B case - the
// acceptance criteria (exact filled values, zero cross-contamination,
// correct mutually-exclusive checkboxes, real versioning/activation) are
// inherently integration-level and can't be proven against a mocked model.
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");
const env = require("../../../config/env");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const USCISMappingVersion = require("../../../models/USCISMappingVersion");
const MappingResolver = require("../services/MappingResolver");
const MappingGraphService = require("../services/MappingGraphService");
const CanonicalDataService = require("../services/CanonicalDataService");
const AutoFillService = require("../services/AutoFillService");
const seedI129H1bMapping = require("../seeds/i129-h1b-mapping.seed");
const { MAPPED_EDGES, classifyField, OUT_OF_SCOPE_PAGES, USCIS_USE_ONLY_PATTERNS } = require("../config/i129-h1b-crosswalk");
const { buildGoldenH1bCase, GOLDEN } = require("./i129-h1b-golden-case");

const FORM_CODE = "I-129";
const VERSION = "2026-02-27";

let template;
let fieldNameToFieldId;

test.before(async () => {
  if (mongoose.connection.readyState === 0) await mongoose.connect(env.mongoUri);
  await seedI129H1bMapping({});
  template = await USCISFormTemplate.findOne({ formCode: FORM_CODE, version: VERSION }).lean();
  fieldNameToFieldId = new Map(template.formFields.map((f) => [f.fieldName, f.fieldId]));
});

test.after(async () => {
  await mongoose.disconnect();
});

function fieldId(fieldName) {
  const id = fieldNameToFieldId.get(fieldName);
  if (!id) throw new Error(`No field on the template matches fieldName "${fieldName}"`);
  return id;
}

test("AC1 - every mapped edge's source path resolves to a non-undefined value in the golden case's real canonical data", async () => {
  const golden = await buildGoldenH1bCase();
  try {
    const canonicalData = await CanonicalDataService.build(golden.caseId, golden.user, {});
    const unresolved = [];
    MAPPED_EDGES.forEach((edge) => {
      const value = MappingResolver.resolvePath(canonicalData, edge.source);
      if (value === undefined) unresolved.push({ fieldName: edge.fieldName, source: edge.source });
    });
    assert.deepEqual(unresolved, [], `every mapped edge's source must resolve against the real canonical namespace, found ${unresolved.length} that don't`);
  } finally {
    await golden.cleanup();
  }
});

test("AC2 - AutoFillService.generate produces the exact expected values from the golden case (>=30 assertions)", async () => {
  const golden = await buildGoldenH1bCase();
  try {
    const { caseForm } = await AutoFillService.generate(golden.caseId, FORM_CODE, golden.user, {});
    const filled = caseForm.filledData;
    const get = (fieldName) => MappingResolver.resolvePath(filled, fieldId(fieldName));

    // Beneficiary identity
    assert.equal(get("form1[0].#subform[1].Part3_Line2_FamilyName[0]"), "Lovelace");
    assert.equal(get("form1[0].#subform[1].Part3_Line2_GivenName[0]"), "Ada");
    assert.equal(get("form1[0].#subform[1].Part3_Line2_MiddleName[0]"), "Kingsley");
    assert.equal(get("form1[0].#subform[2].Line6_DateOfBirth[0]"), "03/15/1990");
    assert.equal(get("form1[0].#subform[2].Part3Line4_CountryOfBirth[0]"), "United Kingdom");
    assert.equal(get("form1[0].#subform[2].Part3Line4_CountryOfCitizenship[0]"), "United Kingdom");
    assert.equal(get("form1[0].#subform[2].Part3Line5_PassportorTravDoc[0]"), "X1234567");
    assert.equal(get("form1[0].#subform[2].Line5_SSN[0]"), "123456789");
    assert.equal(get("form1[0].#subform[2].Line5_SEVIS[0]"), "N0012345678");
    assert.equal(get("form1[0].#subform[2].Part3Line5_ArrivalDeparture[0]"), "11223344556");
    assert.equal(get("form1[0].#subform[2].Line11g_CurrentNon[0]"), "F-1");
    assert.equal(get("form1[0].#subform[2].Line11h_DateStatusExpires[0]"), "05/31/2027");
    assert.equal(get("form1[0].#subform[2].Part3Line5_DateofArrival[0]"), "08/15/2022");
    assert.equal(get("form1[0].#subform[2].Line8a_StreetNumberName[0]"), "221B Baker Street");
    assert.equal(get("form1[0].#subform[2].Line8d_CityTown[0]"), "New York");
    assert.equal(get("form1[0].#subform[2].Line8e_State[0]"), "NY");
    assert.equal(get("form1[0].#subform[2].Line8f_ZipCode[0]"), "10001");

    // Classification / petition-level
    assert.equal(get("form1[0].#subform[1].Part2_ClassificationSymbol[0]"), "H-1B");
    assert.equal(get("form1[0].#subform[1].Line1_ReceiptNumber[0]"), "None");

    // Petitioner / employer
    assert.equal(get("form1[0].#subform[0].Line3_CompanyorOrgName[0]"), "Acme Analytics Inc");
    assert.equal(get("form1[0].#subform[0].Line7b_StreetNumberName[0]"), "500 Market Street");
    assert.equal(get("form1[0].#subform[0].Line_CityTown[0]"), "San Francisco");
    assert.equal(get("form1[0].#subform[0].P1_Line3_State[0]"), "CA");
    assert.equal(get("form1[0].#subform[0].P1_Line3_ZipCode[0]"), "94105");
    assert.equal(get("form1[0].#subform[13].Line1_PetitionerName[0]"), "Acme Analytics Inc");
    assert.equal(get("form1[0].#subform[13].Line2_BeneficiaryName[0]"), "Ada Kingsley Lovelace");
    assert.equal(get("form1[0].#subform[5].Line1a_PetitionerLastName[0]"), "Hopper");
    assert.equal(get("form1[0].#subform[5].Line1b_PetitionerFirstName[0]"), "Grace");

    // Job / employment
    assert.equal(get("form1[0].#subform[4].Part5_Q1_JobTitle[0]"), "Senior Software Engineer");
    assert.equal(get("form1[0].#subform[4].Line8_Wages[0]"), "135000");
    assert.equal(get("form1[0].#subform[4].Part5_Q10_DateFrom[0]"), "10/01/2026");
    assert.equal(get("form1[0].#subform[5].Part5Line12_TypeofBusiness[0]"), "Software Development");
    assert.equal(get("form1[0].#subform[5].P5Line13_YearEstablished[0]"), "2015");
    assert.equal(get("form1[0].#subform[5].P5Line14_NumberofEmployees[0]"), "80");
    assert.equal(get("form1[0].#subform[5].Line15_GrossAnnualIncome[0]"), "8000000");
    assert.equal(get("form1[0].#subform[5].Line16_NetAnnualIncome[0]"), "1200000");
    assert.equal(get("form1[0].#subform[15].Line1_Duties[0]"), GOLDEN.answers.employer.employer_jobDescription_duties);

    // H-1B Data Collection Supplement
    assert.equal(get("form1[0].#subform[22].PartA_q3_Field_of_Study[0]"), "Computer Science");
    assert.equal(get("form1[0].#subform[22].Line2f[0].Line6_NAICSCode[0]"), "541511");
    assert.equal(get("form1[0].#subform[22].Line4_RateofPayPerYear[0]"), "135000");
    assert.equal(get("form1[0].#subform[24].H1bSec3Line3a_Name[0]"), "Stanford University");
    assert.equal(get("form1[0].#subform[24].H1bSec3Line3c_TypeofDegree[0]"), "MS Computer Science");
  } finally {
    await golden.cleanup();
  }
});

test("AC3 - no cross-contamination between beneficiary, petitioner, and colliding date fields", async () => {
  const golden = await buildGoldenH1bCase();
  try {
    const { caseForm } = await AutoFillService.generate(golden.caseId, FORM_CODE, golden.user, {});
    const filled = caseForm.filledData;
    const get = (fieldName) => MappingResolver.resolvePath(filled, fieldId(fieldName));

    // Beneficiary's own name must not appear in the petitioner name field, and vice versa.
    const petitionerName = get("form1[0].#subform[13].Line1_PetitionerName[0]");
    const beneficiaryName = get("form1[0].#subform[13].Line2_BeneficiaryName[0]");
    assert.notEqual(petitionerName, beneficiaryName);
    assert.ok(!String(petitionerName).includes("Lovelace"), "petitioner name field must not contain the beneficiary's surname");
    assert.ok(!String(beneficiaryName).includes("Acme"), "beneficiary name field must not contain the petitioner's company name");

    // Beneficiary's US residence must not leak into the petitioner's mailing address, and vice versa.
    const beneficiaryStreet = get("form1[0].#subform[2].Line8a_StreetNumberName[0]");
    const petitionerStreet = get("form1[0].#subform[0].Line7b_StreetNumberName[0]");
    assert.notEqual(beneficiaryStreet, petitionerStreet);
    assert.equal(beneficiaryStreet, "221B Baker Street");
    assert.equal(petitionerStreet, "500 Market Street");

    // The two most collision-prone dates on the form (passport expiry area
    // vs. current-status expiry, see the Phase H1 report) must not be equal in the
    // golden case (they're deliberately set to different years) and the
    // status-expiry field specifically must hold the status expiry value,
    // not the passport expiry value.
    const statusExpiry = get("form1[0].#subform[2].Line11h_DateStatusExpires[0]");
    assert.equal(statusExpiry, "05/31/2027");
    assert.notEqual(statusExpiry, GOLDEN.answers.employee.employee_immigrationStatus_dateOfLastArrival);
  } finally {
    await golden.cleanup();
  }
});

test("AC4 - mutually exclusive checkboxes: exactly the correct widget is true, all siblings are false or unset", async () => {
  const golden = await buildGoldenH1bCase();
  try {
    const { caseForm } = await AutoFillService.generate(golden.caseId, FORM_CODE, golden.user, {});
    const filled = caseForm.filledData;
    const get = (fieldName) => MappingResolver.resolvePath(filled, fieldId(fieldName));

    // Filing type: New H1B - only "new" should be true.
    assert.equal(get("form1[0].#subform[1].new[0]"), true);
    ["continuation", "concurrent", "change", "amended"].forEach((box) => {
      assert.notEqual(get(`form1[0].#subform[1].${box}[0]`), true, `${box} must not be checked for a New H1B filing`);
    });

    // Gender: Female - only the Female widget should be true.
    assert.notEqual(get("form1[0].#subform[2].Line1_Gender_P3[0]"), true, "Male widget must not be checked");
    assert.equal(get("form1[0].#subform[2].Line1_Gender_P3[1]"), true, "Female widget must be checked");

    // Classification: H-1B Specialty Occupation - only choice 'a' (index 0).
    assert.equal(get("form1[0].#subform[13].SubHLine4_class[0]"), true);
    for (let i = 1; i <= 7; i += 1) {
      assert.notEqual(get(`form1[0].#subform[13].SubHLine4_class[${i}]`), true, `SubHLine4_class[${i}] must not be checked`);
    }

    // Wage Level II - only WageLevelBox[1] true.
    assert.equal(get("form1[0].#subform[23].WageLevelBox[1]"), true);
    [0, 2, 3].forEach((i) => assert.notEqual(get(`form1[0].#subform[23].WageLevelBox[${i}]`), true, `WageLevelBox[${i}] must not be checked`));

    // Regular CAP - only Cap[0] true.
    assert.equal(get("form1[0].#subform[23].Cap[0]"), true);
    assert.notEqual(get("form1[0].#subform[23].Cap[1]"), true);

    // H-1B-dependent employer = No.
    assert.equal(get("form1[0].#subform[22].H1BSecALine1a_No[0]"), true);
    assert.notEqual(get("form1[0].#subform[22].H1BSecALine1a_Yes[0]"), true);
  } finally {
    await golden.cleanup();
  }
});

test("AC5 - every field on the H-1B-required subset (not out_of_scope, not uscis_use_only) is exactly mapped or manual_entry; coverage is reported", () => {
  const counts = { mapped: 0, manual_entry: 0, out_of_scope: 0, uscis_use_only: 0 };
  const unclassified = [];
  template.formFields.forEach((field) => {
    const result = classifyField({ fieldName: field.fieldName, pageNumber: field.pageNumber });
    if (!["mapped", "manual_entry", "out_of_scope", "uscis_use_only"].includes(result.status)) unclassified.push(field.fieldName);
    counts[result.status] += 1;
  });
  assert.deepEqual(unclassified, [], "every field must resolve to exactly one of the four known classifications");
  assert.equal(counts.mapped + counts.manual_entry + counts.out_of_scope + counts.uscis_use_only, template.formFields.length);
  assert.ok(counts.mapped >= 70, `expected at least 70 mapped fields, got ${counts.mapped}`);
  const requiredSubsetCoverage = Math.round((counts.mapped / (counts.mapped + counts.manual_entry)) * 100);
  console.log(`H-1B-required-subset coverage: ${counts.mapped} mapped / ${counts.mapped + counts.manual_entry} in-scope (${requiredSubsetCoverage}%); ${counts.out_of_scope} out_of_scope; ${counts.uscis_use_only} uscis_use_only.`);
});

test("AC6 - exactly one active USCISMappingVersion for I-129/2026-02-27, and re-running the seed is idempotent", async () => {
  const before = await USCISMappingVersion.find({ formCode: FORM_CODE, formVersion: VERSION, status: "active" });
  assert.equal(before.length, 1);

  const firstRun = await seedI129H1bMapping({});
  const secondRun = await seedI129H1bMapping({});
  assert.equal(firstRun.mappingVersion._id.toString(), secondRun.mappingVersion._id.toString(), "re-running with an unchanged crosswalk must not create a new version");

  const activeVersions = await USCISMappingVersion.find({ formCode: FORM_CODE, formVersion: VERSION, status: "active" });
  assert.equal(activeVersions.length, 1, "exactly one version must be active at a time");

  const refreshedTemplate = await USCISFormTemplate.findById(template._id).lean();
  assert.equal(refreshedTemplate.mappingStatus, "active");
  assert.equal(String(refreshedTemplate.activeMappingVersionId), activeVersions[0]._id.toString());
});

test("AC7 - an existing USCISMappingVersion's graph is immutable (schema-enforced)", async () => {
  const active = await USCISMappingVersion.findOne({ formCode: FORM_CODE, formVersion: VERSION, status: "active" });
  const originalChecksum = active.checksum;
  active.graph = { edges: [], tampered: true };
  await active.save();
  const reloaded = await USCISMappingVersion.findById(active._id).lean();
  assert.equal(reloaded.checksum, originalChecksum, "checksum must be unchanged");
  assert.notDeepEqual(reloaded.graph, { edges: [], tampered: true }, "graph field is schema-immutable and must reject the mutation");
});

test("AC9 (partial) - classification totals for the whole template are internally consistent", () => {
  const barcodeCount = template.formFields.filter((field) => USCIS_USE_ONLY_PATTERNS.some((pattern) => pattern.test(field.fieldName))).length;
  const outOfScopeCount = template.formFields.filter((field) => OUT_OF_SCOPE_PAGES.has(field.pageNumber) && !USCIS_USE_ONLY_PATTERNS.some((pattern) => pattern.test(field.fieldName))).length;
  assert.ok(barcodeCount > 0);
  assert.ok(outOfScopeCount > 0);
});
