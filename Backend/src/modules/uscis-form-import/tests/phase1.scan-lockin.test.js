// Phase 1 (USCIS-forms re-architecture) lock-in tests. The authoritative AcroForm field
// dictionary already exists - it's PDFFieldScannerService.scan()'s output, persisted verbatim to
// USCISFormTemplate.formFields[] (USCISFormImporterService.js:320) and read verbatim by the
// renderer (see docs/forms/PHASE1_BASELINE.md's authority-chain trace). This file does not add
// any new extraction or storage - it locks in behavior PDFFieldScannerService.test.js does not
// yet assert (geometry, pdfFlags, classified flag objects, semanticType, options triples,
// determinism), so a future refactor that silently narrows the scan output fails here instead of
// being discovered downstream in the renderer or Phase 2's reconciliation.
const assert = require("node:assert/strict");
const test = require("node:test");
const { PDFDocument } = require("pdf-lib");

const PDFFieldScannerService = require("../services/PDFFieldScannerService");
const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const storageService = require("../../uploads/storage.service");

async function buildFixturePdf() {
  const pdfDoc = await PDFDocument.create();
  const page1 = pdfDoc.addPage([612, 792]);
  const page2 = pdfDoc.addPage([612, 792]);
  const form = pdfDoc.getForm();

  const dob = form.createTextField("Pt1Line3_DateOfBirth");
  dob.enableRequired();
  dob.addToPage(page1, { x: 50, y: 700, width: 100, height: 20 });

  const notes = form.createTextField("Pt1Line4_Notes");
  notes.enableMultiline();
  notes.addToPage(page1, { x: 50, y: 650, width: 200, height: 60 });

  const agree = form.createCheckBox("Part2_Agree");
  agree.addToPage(page1, { x: 50, y: 600, width: 12, height: 12 });

  const classification = form.createRadioGroup("Part2_Classification");
  classification.addOptionToPage("H-1B", page1, { x: 50, y: 560, width: 12, height: 12 });
  classification.addOptionToPage("L-1A", page2, { x: 50, y: 700, width: 12, height: 12 });

  const category = form.createDropdown("Part3_Category");
  category.addOptions(["Employer", "Beneficiary"]);
  category.addToPage(page2, { x: 50, y: 650, width: 120, height: 20 });

  return Buffer.from(await pdfDoc.save());
}

test("Phase 1 lock-in: scan() semanticType inference is preserved", async () => {
  const scanner = new PDFFieldScannerService();
  const result = await scanner.scan(await buildFixturePdf());
  const byName = new Map(result.fields.map((f) => [f.fieldName, f]));

  assert.equal(byName.get("Pt1Line3_DateOfBirth").semanticType, "date", "a field named with DateOfBirth must infer semanticType=date");
  assert.equal(byName.get("Pt1Line3_DateOfBirth").fieldType, "date");
  assert.equal(byName.get("Pt1Line4_Notes").semanticType, "textarea", "a multiline text field with no other semantic hint infers textarea");
  assert.equal(byName.get("Part2_Agree").semanticType, "checkbox");
  assert.equal(byName.get("Part2_Classification").semanticType, "radio");
  assert.equal(byName.get("Part3_Category").semanticType, "dropdown");
});

test("Phase 1 lock-in: scan() pdfFieldType (raw widget kind) is preserved and distinct from semanticType", async () => {
  const scanner = new PDFFieldScannerService();
  const result = await scanner.scan(await buildFixturePdf());
  const byName = new Map(result.fields.map((f) => [f.fieldName, f]));

  // pdfFieldType is the literal AcroForm widget kind - "text" even for the DOB field, whose
  // semanticType (asserted above) is "date". This distinction is exactly what Phase 2's semantic
  // reconciliation needs: the widget is a plain text box; only the SEMANTIC layer knows it's a date.
  assert.equal(byName.get("Pt1Line3_DateOfBirth").pdfFieldType, "text");
  assert.equal(byName.get("Part2_Agree").pdfFieldType, "checkbox");
  assert.equal(byName.get("Part2_Classification").pdfFieldType, "radio");
  assert.equal(byName.get("Part3_Category").pdfFieldType, "dropdown");
});

test("Phase 1 lock-in: scan() geometry (coordinates, boundingBox, coordinateSystem, per-widget widgets[]) is preserved", async () => {
  const scanner = new PDFFieldScannerService();
  const result = await scanner.scan(await buildFixturePdf());
  const byName = new Map(result.fields.map((f) => [f.fieldName, f]));

  const dob = byName.get("Pt1Line3_DateOfBirth");
  assert.equal(dob.pageNumber, 1);
  assert.equal(dob.coordinates.pageNumber, 1);
  // pdf-lib's own createTextField()/addToPage() applies a small default border/padding
  // adjustment to the requested {width:100} - not this scanner's concern, so assert a tolerance
  // around the requested geometry rather than pdf-lib's exact internal fixture-creation pixels.
  assert.ok(Math.abs(dob.coordinates.width - 100) <= 5, `expected width close to 100, got ${dob.coordinates.width}`);
  assert.ok(Math.abs(dob.coordinates.height - 20) <= 5, `expected height close to 20, got ${dob.coordinates.height}`);
  assert.equal(dob.coordinates.boundingBox.left, dob.coordinates.x);
  assert.equal(dob.coordinates.boundingBox.bottom, dob.coordinates.y);
  assert.equal(dob.coordinates.boundingBox.right, dob.coordinates.x + dob.coordinates.width);
  assert.equal(dob.coordinates.boundingBox.top, dob.coordinates.y + dob.coordinates.height);
  assert.deepEqual(dob.coordinates.coordinateSystem, { origin: "bottom-left", units: "pdf-points", pageWidth: 612, pageHeight: 792 });
  assert.equal(dob.widgets.length, 1);
  assert.equal(dob.widgets[0].pageNumber, 1);

  // A radio group has one widget per option, each independently positioned/paged - this is the
  // geometry a per-option UI overlay needs and it must survive scan() as a per-widget array, not
  // collapse to the field's single top-level `coordinates` (which only reflects widgets[0]).
  const classification = byName.get("Part2_Classification");
  assert.equal(classification.widgets.length, 2, "one widget per radio option");
  const pages = classification.widgets.map((w) => w.pageNumber).sort();
  assert.deepEqual(pages, [1, 2], "the two radio option widgets must resolve to the two distinct pages they were added to");
});

test("Phase 1 lock-in: scan() flags (pdfFlags + classified textFieldFlags/choiceFieldFlags/radioFieldFlags) are preserved", async () => {
  const scanner = new PDFFieldScannerService();
  const result = await scanner.scan(await buildFixturePdf());
  const byName = new Map(result.fields.map((f) => [f.fieldName, f]));

  const dob = byName.get("Pt1Line3_DateOfBirth");
  assert.equal(dob.required, true);
  assert.equal(typeof dob.pdfFlags, "number");
  assert.ok(dob.pdfFlags & 2, "the Required bit (AcroFieldFlags.Required = 2) must be set in the raw /Ff flags");
  assert.equal(dob.textFieldFlags.multiline, false);

  const notes = byName.get("Pt1Line4_Notes");
  assert.equal(notes.textFieldFlags.multiline, true);
  assert.deepEqual(byName.get("Part2_Agree").textFieldFlags, {}, "textFieldFlags only applies to PDFTextField");

  const classification = byName.get("Part2_Classification");
  assert.equal(typeof classification.radioFieldFlags.mutuallyExclusive, "boolean");
  assert.deepEqual(byName.get("Pt1Line3_DateOfBirth").radioFieldFlags, {}, "radioFieldFlags only applies to PDFRadioGroup");

  const category = byName.get("Part3_Category");
  assert.equal(typeof category.choiceFieldFlags.sorted, "boolean");
  assert.equal(typeof category.choiceFieldFlags.editable, "boolean");
  assert.deepEqual(byName.get("Part2_Agree").choiceFieldFlags, {}, "choiceFieldFlags only applies to PDFDropdown/PDFOptionList");
});

test("Phase 1 lock-in: scan() options are {label, value, exportValue} triples for radio/dropdown", async () => {
  const scanner = new PDFFieldScannerService();
  const result = await scanner.scan(await buildFixturePdf());
  const byName = new Map(result.fields.map((f) => [f.fieldName, f]));

  const classification = byName.get("Part2_Classification");
  assert.deepEqual(
    [...classification.options].sort((a, b) => a.value.localeCompare(b.value)),
    [
      { label: "H-1B", value: "H-1B", exportValue: "H-1B" },
      { label: "L-1A", value: "L-1A", exportValue: "L-1A" },
    ]
  );

  const category = byName.get("Part3_Category");
  assert.deepEqual(category.options, [
    { label: "Employer", value: "Employer", exportValue: "Employer" },
    { label: "Beneficiary", value: "Beneficiary", exportValue: "Beneficiary" },
  ]);

  assert.deepEqual(byName.get("Part2_Agree").options, [], "a checkbox has no options list");
});

// scan()'s return object carries exactly one wall-clock field - `scannedAt: new Date()`
// (PDFFieldScannerService.js:777) - a scan timestamp, not derived data; everything else
// (fields, fieldFingerprint, layout, structure, sections, validation, indexes, etc.) is computed
// purely from `fields`, which is itself deterministic. Confirmed empirically: an early version of
// this test asserted full-object deepEqual and failed solely on `scannedAt` differing by a few ms
// between the two calls - not a defect, so it's excluded here the same way Phase 0's golden
// harness strips volatile timestamps before comparing.
function withoutScannedAt(result) {
  const { scannedAt, ...rest } = result;
  return rest;
}

test("Phase 1 lock-in: scan() is fully deterministic across repeated runs on the same bytes (fixture PDF)", async () => {
  const buffer = await buildFixturePdf();
  const scanner = new PDFFieldScannerService();
  const first = await scanner.scan(buffer);
  const second = await scanner.scan(buffer);
  assert.deepEqual(withoutScannedAt(first), withoutScannedAt(second));
});

test("Phase 1 lock-in: scan() is fully deterministic on a real seeded template's stored PDF (I-129)", async (t) => {
  await connectTestDB();
  t.after(disconnectTestDB);
  const template = await USCISFormTemplate.findOne({ formCode: "I-129" }).select("pdfStorageKey formFields");
  assert.ok(template?.pdfStorageKey, "expected a seeded I-129 template with a stored PDF (npm run seed:i129)");

  const buffer = await storageService.readBuffer(template.pdfStorageKey);
  const scanner = new PDFFieldScannerService();
  const first = await scanner.scan(buffer);
  const second = await scanner.scan(buffer);
  assert.deepEqual(withoutScannedAt(first), withoutScannedAt(second), "re-scanning the exact same stored PDF bytes must produce byte-identical output (scannedAt excluded - see withoutScannedAt)");
  assert.ok(first.fieldCount >= 900, "sanity check against the known I-129 field count (crosswalk-coverage tests assert >=900)");
});

test("Phase 1 lock-in: the PERSISTED formFields on the real I-129 template still carries pageNumber/coordinates/pdfFlags/semanticType/options (what the renderer actually consumes)", async (t) => {
  await connectTestDB();
  t.after(disconnectTestDB);
  const template = await USCISFormTemplate.findOne({ formCode: "I-129" }).select("formFields").lean();
  assert.ok(template?.formFields?.length, "expected a seeded I-129 template with formFields");

  const sample = template.formFields.find((f) => f.fieldType === "text" && f.pageNumber) || template.formFields[0];
  assert.equal(typeof sample.pageNumber, "number");
  assert.ok(sample.coordinates && typeof sample.coordinates.width === "number", "coordinates.width must survive persistence");
  assert.equal(typeof sample.pdfFlags, "number", "pdfFlags must survive persistence, not just live in the in-memory scan() result");
  assert.ok(sample.semanticType, "semanticType must survive persistence");
  assert.ok(Array.isArray(sample.options), "options must survive persistence as an array (possibly empty)");

  const radioLike = template.formFields.find((f) => f.fieldType === "radio" || f.pdfFieldType === "radio");
  if (radioLike) {
    assert.ok(Array.isArray(radioLike.options) && radioLike.options.length > 0, "a real radio field's options must survive persistence");
    assert.ok(radioLike.options.every((o) => typeof o === "object" && "value" in o), "persisted options must keep the {label,value,exportValue} shape, not collapse to bare strings");
  }
});
