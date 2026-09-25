const { test } = require("node:test");
const assert = require("node:assert/strict");
const { extract } = require("../extractors/passport-extractor.service");
const { mrzCheckDigit } = require("../extractors/mrz-parser.service");

function buildValidTD3() {
  const passportNumber = "AB1234567";
  const dob = "850422";
  const expiry = "250101";
  const pnCheck = mrzCheckDigit(passportNumber);
  const dobCheck = mrzCheckDigit(dob);
  const expCheck = mrzCheckDigit(expiry);
  const line1 = "P<USASMITH<<JOHN<HENRY".padEnd(44, "<");
  const line2 = `${passportNumber}${pnCheck}USA${dob}${dobCheck}M${expiry}${expCheck}${"<".repeat(14)}00`;
  return `${line1}\n${line2}`;
}

// A stand-in for whatever an AI provider (Gemini or Document AI) would have
// returned on its own for this same document, BEFORE MRZ overrides are
// applied - deliberately gives a wrong first/last name and low confidence to
// prove the MRZ path actually overrides it, plus a placeOfBirth the MRZ
// cannot provide, to prove non-MRZ fields are left untouched.
function providerResponseWithMrz() {
  return {
    rawText: `PASSPORT\nUnited States of America\n${buildValidTD3()}\nP<12345`,
    overallConfidence: 55,
    fields: {
      firstName: { value: "J0HN", confidence: 40 }, // OCR misread, low confidence
      lastName: { value: "SM1TH", confidence: 40 },
      passportNumber: { value: "AB1Z34567", confidence: 35 },
      nationality: { value: "USA", confidence: 90 },
      dateOfBirth: { value: "1985-04-21", confidence: 50 }, // off by one day
      gender: { value: "Male", confidence: 90 },
      expiryDate: { value: "2025-01-02", confidence: 50 }, // off by one day
      placeOfBirth: { value: "New York, NY", confidence: 88 },
      issueDate: { value: "2015-01-01", confidence: 85 },
    },
  };
}

test("passport-extractor overrides AI-guessed fields with checksum-verified MRZ values", async () => {
  const result = await extract({
    document: { fileName: "passport.pdf" },
    geminiResponse: providerResponseWithMrz(),
  });

  // MRZ-sourced fields: exact, high-confidence, regardless of what the AI
  // provider guessed for the same field.
  assert.equal(result.fields.firstName.value, "JOHN");
  assert.equal(result.fields.lastName.value, "SMITH");
  assert.equal(result.fields.passportNumber.value, "AB1234567");
  assert.equal(result.fields.dateOfBirth.value, "1985-04-22");
  assert.equal(result.fields.expiryDate.value, "2025-01-01");
  assert.equal(result.fields.firstName.confidence, 100);
  assert.equal(result.fields.passportNumber.confidence, 100);

  // Fields the MRZ does not encode: untouched, still whatever the provider
  // returned.
  assert.equal(result.fields.placeOfBirth.value, "New York, NY");
  assert.equal(result.fields.issueDate.value, "2015-01-01");

  assert.equal(result.entities.mrz.checksums.passportNumber, true);
});

test("passport-extractor leaves AI-provided fields alone when no MRZ is present in rawText", async () => {
  const result = await extract({
    document: { fileName: "passport.pdf" },
    geminiResponse: {
      rawText: "a scan with no MRZ lines at all",
      overallConfidence: 70,
      fields: { firstName: { value: "JOHN", confidence: 70 } },
    },
  });
  assert.equal(result.fields.firstName.value, "JOHN");
  assert.equal(result.fields.firstName.confidence, 70);
  assert.equal(result.entities.mrz, undefined);
});
