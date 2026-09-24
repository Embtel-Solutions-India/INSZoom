// DB-free companion test for the H-4 I-539 crosswalk, mirroring
// i130-k3-crosswalk-coverage.test.js's approach: loads the REAL, checked-in
// I-539 template PDF (the same file uscis-form-import's i539.seed.js
// imports) and confirms every crosswalk edge targets a real field, every
// real field classifies to a known status, and the mapped count matches
// exactly what the crosswalk itself claims.
const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("path");
const fs = require("fs");
const { PDFDocument } = require("pdf-lib");
const { normalizePdf } = require("../../../utils/normalizePdf");
const { classifyField, MAPPED_EDGES, MANUAL_ENTRY_FIELDS } = require("../config/i539-h4-crosswalk");

const PDF_PATH = path.resolve(__dirname, "../../../../dev-assets/uscis/i-539_2024-08-28.pdf");

async function loadRealFields() {
  const buffer = fs.readFileSync(PDF_PATH);
  const normalized = await normalizePdf(buffer);
  const pdf = await PDFDocument.load(normalized, { ignoreEncryption: true, updateMetadata: false });
  return pdf.getForm().getFields().map((field) => ({ fieldName: field.getName() }));
}

test("every real I-539 field classifies to a known status, and every mapped edge is grounded in a real field name", async (t) => {
  let fields;
  try {
    fields = await loadRealFields();
  } catch (error) {
    t.skip(`qpdf/normalizePdf unavailable in this environment: ${error.message}`);
    return;
  }

  assert.ok(fields.length >= 150, `expected the real I-539 PDF's fillable field count (~159), got ${fields.length}`);

  const realNames = new Set(fields.map((f) => f.fieldName));
  const badFieldNames = MAPPED_EDGES.filter((edge) => !realNames.has(edge.fieldName)).map((edge) => edge.fieldName);
  assert.deepEqual(badFieldNames, [], "every crosswalk edge must target a real field on the actual I-539 template");

  const badManualNames = Object.values(MANUAL_ENTRY_FIELDS).flat().filter((name) => !realNames.has(name));
  assert.deepEqual(badManualNames, [], "every MANUAL_ENTRY_FIELDS entry must also target a real field name");

  const counts = { mapped: 0, manual_entry: 0, out_of_scope: 0, uscis_use_only: 0 };
  const unclassified = [];
  fields.forEach(({ fieldName }) => {
    const result = classifyField({ fieldName });
    if (!["mapped", "manual_entry", "out_of_scope", "uscis_use_only"].includes(result.status)) unclassified.push(fieldName);
    counts[result.status] += 1;
  });
  assert.deepEqual(unclassified, [], "every field must resolve to exactly one of the four known classifications");
  assert.equal(counts.mapped + counts.manual_entry + counts.out_of_scope + counts.uscis_use_only, fields.length);
  assert.equal(counts.mapped, MAPPED_EDGES.length, "the mapped count must match this crosswalk's authored edge count exactly");
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
