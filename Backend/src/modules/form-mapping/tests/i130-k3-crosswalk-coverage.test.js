// DB-free companion test for the K-3 I-130 crosswalk, mirroring
// i129f-k1-crosswalk-coverage.test.js's approach.
const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("path");
const fs = require("fs");
const { PDFDocument } = require("pdf-lib");
const { normalizePdf } = require("../../../utils/normalizePdf");
const { classifyField, MAPPED_EDGES } = require("../config/i130-k3-crosswalk");
const k1 = require("../../family-workflow/questionnaires/k1");

const PDF_PATH = path.resolve(__dirname, "../../../../dev-assets/uscis/i-130_2024-04-01.pdf");

async function loadRealFields() {
  const buffer = fs.readFileSync(PDF_PATH);
  const normalized = await normalizePdf(buffer);
  const pdf = await PDFDocument.load(normalized, { ignoreEncryption: true, updateMetadata: false });
  return pdf.getForm().getFields().map((field) => ({ fieldName: field.getName() }));
}

test("every real I-130 field classifies to a known status, and every mapped edge is grounded in a real field name", async (t) => {
  let fields;
  try {
    fields = await loadRealFields();
  } catch (error) {
    t.skip(`qpdf/normalizePdf unavailable in this environment: ${error.message}`);
    return;
  }

  assert.ok(fields.length >= 400, `expected the real I-130 PDF's fillable field count (~450), got ${fields.length}`);

  const realNames = new Set(fields.map((f) => f.fieldName));
  const badFieldNames = MAPPED_EDGES.filter((edge) => !realNames.has(edge.fieldName)).map((edge) => edge.fieldName);
  assert.deepEqual(badFieldNames, [], "every crosswalk edge must target a real field on the actual I-130 template");

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

test("every crosswalk edge's source key is a real k1.js (reused by k3.js) fieldCatalog key", () => {
  const validKeys = new Set(k1.fieldCatalog().map((entry) => entry.path.replace(/\./g, "_")));
  const sourceKeyPattern = /^raw\.questionnaireAnswers\.(.+)\.value$/;
  const badSources = MAPPED_EDGES
    .map((edge) => edge.source.match(sourceKeyPattern))
    .filter((match) => match && !validKeys.has(match[1]))
    .map((match) => match[1]);
  assert.deepEqual(badSources, [], "every raw.questionnaireAnswers source must resolve to a real fieldCatalog() question key");
});

test("k3.js's fieldCatalog is literally k1.js's (by reference, not a copy)", () => {
  const k3 = require("../../family-workflow/questionnaires/k3");
  assert.equal(k3.fieldCatalog, k1.fieldCatalog, "k3.js must reuse k1.js's fieldCatalog by reference per its own header comment - if this ever changes, i130-k3-crosswalk.js's source keys need re-verification against k3's own catalog");
});
