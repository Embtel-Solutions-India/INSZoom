const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseMrzFromText, mrzCheckDigit } = require("../extractors/mrz-parser.service");

// Every check digit below is computed by mrzCheckDigit itself (not copied
// from an external example) and asserted against a hand-computed value, so
// this vector is self-consistent and verifiably correct against the real
// ICAO 9303 weighting (7,3,1 repeating).
function buildValidTD3() {
  const passportNumber = "AB1234567";
  const dob = "850422";
  const expiry = "250101";
  const pnCheck = mrzCheckDigit(passportNumber);
  const dobCheck = mrzCheckDigit(dob);
  const expCheck = mrzCheckDigit(expiry);
  const line1 = "P<USASMITH<<JOHN<HENRY".padEnd(44, "<");
  const line2 = `${passportNumber}${pnCheck}USA${dob}${dobCheck}M${expiry}${expCheck}${"<".repeat(14)}00`;
  return { line1, line2, pnCheck, dobCheck, expCheck };
}

test("mrzCheckDigit matches the ICAO 9303 7/3/1 weighting by hand computation", () => {
  // A=10, B=11 per the MRZ_CHECK_CHARS alphabet; weights cycle 7,3,1.
  // "AB1234567": 10*7 + 11*3 + 1*1 + 2*7 + 3*3 + 4*1 + 5*7 + 6*3 + 7*1 = 191 -> 191 % 10 = 1
  assert.equal(mrzCheckDigit("AB1234567"), 1);
});

test("parseMrzFromText extracts all TD3 fields from a valid, checksummed MRZ", () => {
  const { line1, line2 } = buildValidTD3();
  const result = parseMrzFromText(`some ocr preamble text\n${line1}\n${line2}\nsome trailing text`);
  assert.deepEqual(result, {
    issuingCountry: "USA",
    lastName: "SMITH",
    firstName: "JOHN",
    middleName: "HENRY",
    passportNumber: "AB1234567",
    nationality: "USA",
    dateOfBirth: "1985-04-22",
    gender: "Male",
    expiryDate: "2025-01-01",
    mrzData: `${line1}\n${line2}`,
    checksums: { passportNumber: true, dateOfBirth: true, expiryDate: true },
  });
});

test("a field whose own checksum fails is returned as null, not a wrong value", () => {
  const { line1, line2 } = buildValidTD3();
  const corruptedLine2 = `${line2.slice(0, 9)}5${line2.slice(10)}`; // wrong passport check digit
  const result = parseMrzFromText(`${line1}\n${corruptedLine2}`);
  assert.equal(result.passportNumber, null);
  assert.equal(result.checksums.passportNumber, false);
  // Other, independently-checksummed fields are unaffected by this corruption.
  assert.equal(result.dateOfBirth, "1985-04-22");
  assert.equal(result.checksums.dateOfBirth, true);
});

test("returns null when no valid-length MRZ lines are present", () => {
  assert.equal(parseMrzFromText("just some ordinary OCR text\nwith no MRZ lines at all"), null);
  assert.equal(parseMrzFromText(""), null);
  assert.equal(parseMrzFromText(null), null);
});
