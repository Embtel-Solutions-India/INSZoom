// Phase 4 (§I.2) - P1-002 fix verification. The 13 false-positive field names and the true DOB
// field names below are quoted directly from docs/forms/issues/P1-002-semantictype-inference-false-positives.md
// and docs/forms/PHASE1_RECONCILIATION.md - not invented.
const assert = require("node:assert/strict");
const test = require("node:test");

const { inferTextSemanticType } = require("../services/PDFFieldScannerService");

// All 13 confirmed false positives from Phase 1's reconciliation report (5 H-1B/L-1A, 4 K-1, 4 K-3).
const FALSE_POSITIVE_FIELD_NAMES = [
  "form1[0].#subform[0].Line_CityTown[0]",
  "form1[0].#subform[2].Part3Line4_CountryOfBirth[0]",
  "form1[0].#subform[2].Part3Line5_PassportorTravDoc[0]",
  "form1[0].#subform[2].Line8d_CityTown[0]",
  "form1[0].#subform[15].ClassHLine5b_PassportorTravDoc[0]",
  "form1[0].#subform[2].Pt1Line24_CityTownOfBirth[0]",
  "form1[0].#subform[2].Pt1Line25_ProvinceOrStateOfBirth[0]",
  "form1[0].#subform[3].Pt2Line7_CityTownOfBirth[0]",
  "form1[0].#subform[3].Pt2Line8_CountryOfBirth[0]",
  "form1[0].#subform[1].Pt2Line6_CityTownOfBirth[0]",
  "form1[0].#subform[1].Pt2Line7_CountryofBirth[0]",
  "form1[0].#subform[4].Pt4Line7_CityTownOfBirth[0]",
  "form1[0].#subform[4].Pt4Line8_CountryOfBirth[0]",
];

// Real true-DOB and other genuinely date-related field names already relied on elsewhere in this
// codebase (h1-i129-mapping.test.js's AC2 assertions, the P0-CD-001 fix, and the ledger's own
// examples) - must still classify as "date" after the fix.
const TRUE_DATE_FIELD_NAMES = [
  "form1[0].#subform[2].Line6_DateOfBirth[0]",
  "form1[0].#subform[1].Pt2Line8_DateofBirth[0]",
  "form1[0].#subform[4].Pt4Line9_DateOfBirth[0]",
  "form1[0].#subform[2].Line11h_DateStatusExpires[0]",
  "form1[0].#subform[2].Part3Line5_DateofArrival[0]",
  "some_dob_field",
  "IssuedDate",
];

test("P1-002: place-of-birth and unrelated bare-substring field names no longer classify as date", () => {
  FALSE_POSITIVE_FIELD_NAMES.forEach((name) => {
    assert.notEqual(inferTextSemanticType(name), "date", `${name} must not classify as "date"`);
  });
});

test("P1-002 regression guard: true date-of-birth and other genuine date fields still classify as date", () => {
  TRUE_DATE_FIELD_NAMES.forEach((name) => {
    assert.equal(inferTextSemanticType(name), "date", `${name} must still classify as "date"`);
  });
});
