// Deterministic MRZ (Machine Readable Zone, ICAO Doc 9303 TD3 format) parser
// for passport biographic pages. Runs entirely in Node.js against whatever
// `rawText` the active document-intelligence provider (Document AI or
// Gemini) already returned - no AI model is asked to "read" the MRZ, since
// the two 44-character MRZ lines are printed in a fixed, checksummed layout
// that a vision model can transcribe imperfectly but a deterministic parser
// either gets exactly right or (via the checksum) knows it got wrong.
//
// Used to SUPPLEMENT passport-extractor.service.js's existing AI-based
// extraction, never to replace it: a field the MRZ can't provide (place of
// birth, issue date - neither appears in the MRZ) still falls back to
// whatever the configured provider returned for that field.

const MRZ_CHECK_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MRZ_WEIGHTS = [7, 3, 1];

function mrzCheckDigit(str) {
  let total = 0;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    const val = ch === "<" ? 0 : MRZ_CHECK_CHARS.indexOf(ch);
    if (val === -1) return null;
    total += val * MRZ_WEIGHTS[i % 3];
  }
  return total % 10;
}

function parseDate(yymmdd) {
  if (!yymmdd || /^<+$/.test(yymmdd)) return null;
  const yy = parseInt(yymmdd.slice(0, 2), 10);
  const mm = parseInt(yymmdd.slice(2, 4), 10);
  const dd = parseInt(yymmdd.slice(4, 6), 10);
  if (Number.isNaN(yy) || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  // MRZ years are 2-digit with no century marker. A passport's date of birth
  // is always in the past and its expiry is typically within ~10 years of
  // issuance, so the standard ICAO convention (00-30 -> 2000s, 31-99 ->
  // 1900s) is applied uniformly here; expiryDate is the one field where this
  // convention can go stale decades from now, same limitation every MRZ
  // parser has.
  const year = yy <= 30 ? 2000 + yy : 1900 + yy;
  return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function splitName(mrzNameField) {
  const [surname, givenBlock] = mrzNameField.split("<<");
  const given = (givenBlock || "").split("<").filter(Boolean);
  return {
    surname: (surname || "").replace(/</g, " ").trim(),
    firstName: given[0] || "",
    middleName: given.slice(1).join(" "),
  };
}

// Finds the two 44-char TD3 lines inside a provider's raw OCR text. MRZ
// lines are the only lines in a passport scan built exclusively from
// uppercase A-Z, 0-9 and '<' at that exact length, so this is looked for
// directly rather than assuming any particular line position.
function extractMrzLines(rawText) {
  if (!rawText) return null;
  const lines = String(rawText)
    .replace(/[​-‍﻿]/g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, "").trim());
  const td3Pattern = /^[A-Z0-9<]{44}$/;
  const candidates = lines.filter((line) => td3Pattern.test(line));
  if (candidates.length < 2) return null;
  // The two MRZ lines are always adjacent in the printed layout; if OCR
  // picked up more than 2 matching-length lines (rare, but possible against
  // a noisy scan), the first adjacent pair where line 1 starts with the
  // document-type character 'P' is preferred over an arbitrary pair.
  for (let i = 0; i < candidates.length - 1; i += 1) {
    if (candidates[i][0] === "P") return [candidates[i], candidates[i + 1]];
  }
  return [candidates[0], candidates[1]];
}

function parseTD3(line1, line2) {
  const issuingCountry = line1.slice(2, 5).replace(/</g, "");
  const { surname, firstName, middleName } = splitName(line1.slice(5, 44));

  const passportNumber = line2.slice(0, 9);
  const passportNumberCheck = parseInt(line2[9], 10);
  const nationality = line2.slice(10, 13).replace(/</g, "");
  const dob = line2.slice(13, 19);
  const dobCheck = parseInt(line2[19], 10);
  const sex = line2[20];
  const expiry = line2.slice(21, 27);
  const expiryCheck = parseInt(line2[27], 10);

  const passportNumberValid = mrzCheckDigit(passportNumber) === passportNumberCheck;
  const dobValid = mrzCheckDigit(dob) === dobCheck;
  const expiryValid = mrzCheckDigit(expiry) === expiryCheck;

  return {
    issuingCountry: issuingCountry || null,
    lastName: surname || null,
    firstName: firstName || null,
    middleName: middleName || null,
    passportNumber: passportNumberValid ? passportNumber.replace(/</g, "") : null,
    nationality: nationality || null,
    dateOfBirth: dobValid ? parseDate(dob) : null,
    gender: sex === "M" ? "Male" : sex === "F" ? "Female" : null,
    expiryDate: expiryValid ? parseDate(expiry) : null,
    mrzData: `${line1}\n${line2}`,
    checksums: { passportNumber: passportNumberValid, dateOfBirth: dobValid, expiryDate: expiryValid },
  };
}

/**
 * Parses TD3 passport MRZ out of a provider's raw OCR text.
 * Returns null if no valid-length MRZ lines are found. Any individual field
 * whose own checksum fails is returned as null rather than a guessed value -
 * callers should treat a null MRZ field the same as "MRZ had nothing to add
 * here," not "MRZ says this is empty."
 */
function parseMrzFromText(rawText) {
  const lines = extractMrzLines(rawText);
  if (!lines) return null;
  return parseTD3(lines[0], lines[1]);
}

module.exports = { parseMrzFromText, mrzCheckDigit };
