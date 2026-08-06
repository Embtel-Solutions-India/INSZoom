// DB-free companion to h1-i129-mapping.test.js's AC5/AC9 (which require a
// live MongoDB connection to read the imported USCISFormTemplate). This test
// gets the same real field/page data a different way - normalizing the
// bundled I-129 PDF locally (the same asset i129.seed.js imports from) via
// pdf-lib, so the L-1A crosswalk addition's coverage can be verified without
// a database at all. Skips (rather than fails) if qpdf isn't installed,
// consistent with normalizePdf's own environment dependency.
const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("path");
const fs = require("fs");
const { PDFDocument } = require("pdf-lib");
const { normalizePdf } = require("../../../utils/normalizePdf");
const { classifyField, L_BLANKET_OUT_OF_SCOPE_FIELDS } = require("../config/i129-h1b-crosswalk");

const PDF_PATH = path.resolve(__dirname, "../../../../dev-assets/uscis/i-129_2026-02-27.pdf");

async function loadRealFields() {
  const buffer = fs.readFileSync(PDF_PATH);
  const normalized = await normalizePdf(buffer);
  const pdf = await PDFDocument.load(normalized, { ignoreEncryption: true, updateMetadata: false });
  const pages = pdf.getPages();
  const pageRefToIndex = new Map(pages.map((p, i) => [p.ref.toString(), i + 1]));
  return pdf.getForm().getFields().map((field) => {
    const widgets = field.acroField.getWidgets();
    const pageNumber = widgets.length ? pageRefToIndex.get(widgets[0].P()?.toString()) : undefined;
    return { fieldName: field.getName(), pageNumber };
  });
}

test("every real I-129 field (H-1B base + L Classification Supplement) classifies to exactly one known status", async (t) => {
  let fields;
  try {
    fields = await loadRealFields();
  } catch (error) {
    t.skip(`qpdf/normalizePdf unavailable in this environment: ${error.message}`);
    return;
  }

  assert.ok(fields.length >= 900, `expected the real I-129 PDF's fillable field count (~980), got ${fields.length}`);

  const counts = { mapped: 0, manual_entry: 0, out_of_scope: 0, uscis_use_only: 0 };
  const unclassified = [];
  fields.forEach(({ fieldName, pageNumber }) => {
    const result = classifyField({ fieldName, pageNumber });
    if (!["mapped", "manual_entry", "out_of_scope", "uscis_use_only"].includes(result.status)) unclassified.push(fieldName);
    counts[result.status] += 1;
  });

  assert.deepEqual(unclassified, [], "every field must resolve to exactly one of the four known classifications");
  assert.equal(counts.mapped + counts.manual_entry + counts.out_of_scope + counts.uscis_use_only, fields.length);
  assert.ok(counts.mapped >= 85, `expected at least 85 mapped fields (70+ H-1B base/H-supplement + 17 new L-supplement edges), got ${counts.mapped}`);
});

test("L Classification Supplement (pages 24-27) is in scope: real field names map or manual_entry, only blanket-petition fields stay out_of_scope", async (t) => {
  let fields;
  try {
    fields = await loadRealFields();
  } catch (error) {
    t.skip(`qpdf/normalizePdf unavailable in this environment: ${error.message}`);
    return;
  }

  const lSupplementFields = fields.filter((f) => f.pageNumber >= 24 && f.pageNumber <= 27);
  assert.ok(lSupplementFields.length > 0, "the real template must have fields on pages 24-27 (L Classification Supplement)");

  const mappedFieldNames = [];
  lSupplementFields.forEach(({ fieldName, pageNumber }) => {
    const result = classifyField({ fieldName, pageNumber });
    if (result.status === "mapped") mappedFieldNames.push(fieldName);
    if (result.status === "out_of_scope") {
      assert.ok(
        L_BLANKET_OUT_OF_SCOPE_FIELDS.has(fieldName),
        `${fieldName} is on an L-supplement page but classified out_of_scope without being a known blanket-petition field`
      );
    }
  });

  // Spot-check the highest-value real edges this crosswalk addition authored.
  ["form1[0].#subform[25].a_L1A[0]", "form1[0].#subform[25].b_L1B[0]", "form1[0].#subform[25].LSuppLine3_NameofEmployerAbroad[0]", "form1[0].#subform[27].a_Parent[0]"].forEach((name) => {
    assert.ok(mappedFieldNames.includes(name), `expected ${name} to be mapped`);
  });
});
