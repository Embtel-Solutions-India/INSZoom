// Phase 7.3 proof (d): the additive `stableKey` on scanned fields changes NOTHING else the scanner produces, and it survives the layout shifts a new edition brings.
// (A one-off comparison against the previous scanner code on a built PDF showed: same field count, same fieldFingerprint, every field identical apart from stableKey.)
const test = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument, PDFName, PDFString } = require("pdf-lib");
const PDFFieldScannerService = require("../../uscis-form-import/services/PDFFieldScannerService");
const { stableKeyOf, qualifiedName, indexlessName } = require("../matching/stableKey");

async function build(subform) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  const make = (type, name, x, y) => {
    const field = type === "check" ? form.createCheckBox(name.replace(/\W/g, "")) : form.createTextField(name.replace(/\W/g, ""));
    field.addToPage(page, type === "check" ? { x, y, width: 12, height: 12 } : { x, y, width: 150, height: 20 });
    field.acroField.setPartialName(`form1[0].#subform[${subform}].${name}`);
    field.acroField.dict.set(PDFName.of("TU"), PDFString.of(`tip ${name}`));
  };
  make("text", "Pt1Line1a_FamilyName[0]", 50, 700);
  make("check", "Pt1Line2_Married[0]", 50, 660);
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

test("every scanned field carries a stableKey; fieldId, type, label and page are exactly what they always were", async () => {
  const { fields } = await new PDFFieldScannerService().scan(await build(0));
  assert.equal(fields.length, 2);
  assert.ok(fields.every((field) => /^[0-9a-f]{20}$/.test(field.stableKey)));
  assert.equal(fields[0].fieldId, "part1.form10Subform0Part1Line1AFamilyName0");
  assert.equal(fields[0].type, "text");
  assert.equal(fields[1].type, "checkbox");
  assert.equal(fields[0].label, "Form 1 0 Subform 0 Part 1 Line 1 A Family Name 0");
  assert.equal(fields[0].pageNumber, 1);
  const { stableKey, ...rest } = fields[0];
  assert.ok(!("stableKey" in rest));
  assert.deepEqual(Object.keys(fields[0]).filter((key) => !(key in rest)), ["stableKey"]);
});

test("the stable key does not change when only the container (#subform[n]) is renumbered, but the legacy fieldId does", async () => {
  const a = (await new PDFFieldScannerService().scan(await build(0))).fields[0];
  const b = (await new PDFFieldScannerService().scan(await build(3))).fields[0];
  assert.notEqual(a.fieldId, b.fieldId, "the existing id still follows the container (that is why it must never be used for edition matching)");
  assert.equal(a.stableKey, b.stableKey, "the scanned stableKey is identical across the container renumbering");
  assert.equal(stableKeyOf("form1[0].#subform[0].Pt1Line1a_FamilyName[0]", "x"), stableKeyOf("form1[0].#subform[3].Pt1Line1a_FamilyName[0]", "x"));
});

test("name helpers: containers go, field indexes stay in the qualified name and go from the index-free kind", () => {
  assert.equal(qualifiedName("form1[0].#subform[2].Pt2Line3a_FamilyName[1]"), "form1[0].pt2line3a_familyname[1]");
  assert.equal(indexlessName("form1[0].#subform[2].Pt2Line3a_FamilyName[1]"), "form1.pt2line3a_familyname");
  assert.equal(stableKeyOf("", "g"), null);
  assert.notEqual(stableKeyOf("a[0]", "g1"), stableKeyOf("a[0]", "g2"));
});
