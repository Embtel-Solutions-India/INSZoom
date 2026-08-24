// Phase 4 (§I.1) - P0-CD-001 fix verification. Reuses Phase 0's own goldenHarness.js
// (captureGolden) rather than re-implementing case seeding / PDF generation / PDF-byte reading -
// it already runs the REAL AutoFillService.generate + PDFGenerationService pipeline against a
// deterministic K-3 fixture and reads the actual embedded PDF field values via pdf-lib
// (extractPdfFieldSnapshot), which is exactly what §C requires ("every accuracy assertion reads
// the actual PDF bytes"). This file only adds the P0-CD-001-specific assertions on top of that
// existing, proven harness.
const assert = require("node:assert/strict");
const test = require("node:test");

if (!process.env.LOCAL_STORAGE_PATH) {
  process.env.LOCAL_STORAGE_PATH = require("path").resolve(__dirname, "..", "..", "..", "..", "storage");
}
if (!process.env.MONGODB_TEST_URI) {
  process.env.MONGODB_TEST_URI = "mongodb://localhost:27017/immigrationcrm_test";
}

const { captureGolden } = require("../../form-generation/tests/phase0/goldenHarness");
const { disconnectTestDB } = require("../../../test-utils/db");
const k3 = require("../../../test-utils/fixtures/k3-golden");

test("P0-CD-001 fix: I-130/K-3 petitioner and beneficiary identity fields fill correctly in the real generated PDF", async (t) => {
  // captureGolden() connects via test-utils/db.js's connectTestDB() but never disconnects itself
  // (goldenHarness.js is designed to be called many times in one process by phase0Verify.js/
  // phase0CaptureGolden.js, which disconnect once at the very end) - this file is the only
  // consumer that runs standalone, so it must close the connection itself or the process hangs
  // on open handles after the test passes (confirmed: this exact symptom before adding this hook).
  t.after(async () => {
    await disconnectTestDB();
  });
  const snapshot = await captureGolden("k3");
  const pdfFields = new Map(snapshot.pdfSnapshot.fields.map(([name, , value]) => [name, value]));

  const expectations = [
    ["form1[0].#subform[0].Pt2Line4a_FamilyName[0]", k3.BASE.petitioner.lastName],
    ["form1[0].#subform[0].Pt2Line4b_GivenName[0]", k3.BASE.petitioner.firstName],
    ["form1[0].#subform[1].Pt2Line6_CityTownOfBirth[0]", k3.BASE.petitioner.cityTownOfBirth],
    ["form1[0].#subform[1].Pt2Line7_CountryofBirth[0]", k3.BASE.petitioner.countryOfBirth],
    ["form1[0].#subform[1].Pt2Line8_DateofBirth[0]", "02/19/1982"], // petitioner.dateOfBirth "1982-02-19", formatted mm/dd/yyyy
    ["form1[0].#subform[4].Pt4Line4a_FamilyName[0]", k3.BASE.beneficiary.lastName],
    ["form1[0].#subform[4].Pt4Line4b_GivenName[0]", k3.BASE.beneficiary.firstName],
    ["form1[0].#subform[4].Pt4Line7_CityTownOfBirth[0]", k3.BASE.beneficiary.cityTownOfBirth],
    ["form1[0].#subform[4].Pt4Line8_CountryOfBirth[0]", k3.BASE.beneficiary.countryOfBirth],
    ["form1[0].#subform[4].Pt4Line9_DateOfBirth[0]", "06/05/1989"], // beneficiary.dateOfBirth "1989-06-05", formatted mm/dd/yyyy
  ];

  expectations.forEach(([fieldName, expected]) => {
    assert.equal(pdfFields.get(fieldName), expected, `P0-CD-001: ${fieldName} must contain "${expected}" in the actual generated PDF, not be blank`);
  });
});
