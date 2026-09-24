// DB-free, NETWORK-free companion test for the H-4 I-765 crosswalk.
//
// UNLIKE i539-h4-crosswalk-coverage.test.js (which loads the real, checked-
// in I-539 PDF from dev-assets/uscis/), this test CANNOT load a real I-765
// PDF: none exists anywhere in this repo (no dev-assets file, no
// uscis-form-import seed, no USCISFormTemplate) — see i765-h4-crosswalk.js's
// own header for the full explanation. This crosswalk's fieldName values
// were extracted from a live fetch of uscis.gov's public I-765 PDF at
// authoring time, which a test suite must never depend on (no network
// access in CI, and the live PDF can change out from under a fixed test).
//
// So this test only checks what's verifiable WITHOUT a real field-name
// source: internal consistency of the crosswalk file itself. It does NOT,
// and cannot, prove any fieldName here matches whatever USCISFormTemplate
// this codebase eventually imports for I-765 — that verification has to
// happen against the real imported template (see i765-h4-mapping.seed.js's
// own loud mappingCoverage === 0 warning for when that check should run).
const assert = require("node:assert/strict");
const test = require("node:test");
const { classifyField, MAPPED_EDGES, MANUAL_ENTRY_FIELDS } = require("../config/i765-h4-crosswalk");

test("every classifyField() call resolves to exactly one known status for both mapped and manual field names", () => {
  const allNames = [...MAPPED_EDGES.map((e) => e.fieldName), ...Object.values(MANUAL_ENTRY_FIELDS).flat()];
  const unclassified = [];
  allNames.forEach((fieldName) => {
    const result = classifyField({ fieldName });
    if (!["mapped", "manual_entry", "out_of_scope", "uscis_use_only"].includes(result.status)) unclassified.push(fieldName);
  });
  assert.deepEqual(unclassified, []);
});

test("no crosswalk edge fieldName is listed twice, and mapped/manual buckets never overlap", () => {
  const seen = new Map();
  MAPPED_EDGES.forEach((edge) => seen.set(edge.fieldName, (seen.get(edge.fieldName) || 0) + 1));
  const dupes = [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name);
  assert.deepEqual(dupes, [], "MAPPED_EDGES must not list the same fieldName twice");

  const mappedNames = new Set(MAPPED_EDGES.map((e) => e.fieldName));
  const manualNames = Object.values(MANUAL_ENTRY_FIELDS).flat();
  const overlap = manualNames.filter((name) => mappedNames.has(name));
  assert.deepEqual(overlap, [], "a fieldName must never appear in both MAPPED_EDGES and MANUAL_ENTRY_FIELDS");
});

test("every unverified edge is explicitly flagged (sourceVerified: false), never silently promoted", () => {
  const guessedSourcePattern = /^raw\.questionnaireAnswers\.client_/;
  const silentlyUnflagged = MAPPED_EDGES.filter((edge) => guessedSourcePattern.test(edge.source) && edge.sourceVerified !== false);
  assert.deepEqual(
    silentlyUnflagged.map((e) => e.fieldName),
    [],
    "every edge sourced from a guessed h4Checklist.js question key must carry sourceVerified: false"
  );
});

test("every checkboxMatch edge carries both a condition and a boolean transform", () => {
  const badCheckboxEdges = MAPPED_EDGES.filter((edge) => edge.condition && edge.transform?.type !== "boolean").map((e) => e.fieldName);
  assert.deepEqual(badCheckboxEdges, [], "a conditional edge must always resolve via {transform:{type:'boolean'}} per this codebase's checkboxMatch() convention (see i129-h1b-crosswalk.js)");
});
