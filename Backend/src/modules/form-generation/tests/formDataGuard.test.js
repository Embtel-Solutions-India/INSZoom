// No saved value is ever lost on download (FormDataGuard + the PDFRenderer self-heal routes). DB-free: templates are tiny in-memory PDFs.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const PDFRenderer = require("../services/GuardedPDFRenderer");
const FormDataGuard = require("../services/FormDataGuard");
const { prepareOfficialDownload } = require("../services/OfficialFormDownloadService");
const { useLocalTemplateStorage, storedTemplate } = require("./fixtures/localTemplateStorage");

useLocalTemplateStorage(test);

async function templateWith(build, mappings, extra = {}) {
  const { PDFDocument } = require("pdf-lib");
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 400]);
  build(pdf.getForm(), page);
  const file = path.join(os.tmpdir(), `guard-template-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  await fs.writeFile(file, Buffer.from(await pdf.save()));
  return { file, template: { formCode: "T-1", pdfTemplatePath: file, ...storedTemplate(file), pdfFieldMappings: mappings, ...extra } };
}
const box = (form, page, name, y) => form.createTextField(name).addToPage(page, { x: 20, y, width: 200, height: 20 });

test("orphan values (saved, no mapping) are numbered orphan1, orphan2 in a stable order and never include unchecked/empty answers", () => {
  const template = { pdfFieldMappings: [{ caseField: "a.name", pdfField: "N", type: "text" }] };
  const orphans = FormDataGuard.findOrphans({ a: { name: "x", extra: "kept" }, zeta: "z", alpha: ["p", "q"], blank: "", off: false, nested: { deep: { v: 7 } } }, template);
  assert.deepEqual(orphans.map((o) => [o.label, o.caseField]), [["orphan1", "a.extra"], ["orphan2", "alpha"], ["orphan3", "nested.deep.v"], ["orphan4", "zeta"]]);
  assert.equal(orphans[2].value, 7);
});

test("a value read by a mapping (also through a parent path or array index) is not an orphan", () => {
  const template = { pdfFieldMappings: [{ caseField: "people[0].name", pdfField: "A", type: "text" }, { caseField: "addr", pdfField: "B", type: "text" }] };
  assert.deepEqual(FormDataGuard.findOrphans({ people: [{ name: "n" }], addr: { street: "s", city: "c" } }, template), []);
});

test("a download is the FORM ONLY (strict owner rule): orphans are numbered orphan1, orphan2, kept in the entries / log, and never added to the file", async () => {
  const { PDFDocument } = require("pdf-lib");
  const { file, template } = await templateWith((form, page) => box(form, page, "N", 300), [{ caseField: "a.name", pdfField: "N", type: "text" }]);
  const caseForm = { caseId: "c1", formCode: "T-1", filledData: { a: { name: "Doe" }, mystery: "Value 1", other: { note: "Value 2" } } };
  const rendered = await PDFRenderer.render({ caseForm, template, flatten: false });
  const outcome = await FormDataGuard.recover({ caseForm, template, result: rendered, mode: "pdf-lib" });
  assert.deepEqual(outcome.entries.map((e) => [e.label, e.value]), [["orphan1", "Value 1"], ["orphan2", "Value 2"]]);
  assert.equal(outcome.buffer, rendered.buffer, "the file is returned untouched");
  const pdf = await PDFDocument.load(outcome.buffer);
  assert.equal(pdf.getPageCount(), 1);
  assert.equal(pdf.getForm().getTextField("N").getText(), "Doe");
  assert.ok(outcome.warnings[0].includes("2 saved value(s)") && outcome.warnings[0].includes("not added to the file"));
  await fs.unlink(file).catch(() => {});
});

test("opt-in only (FORM_DOWNLOAD_RECOVERY_PAGE=on): the recovery page + attachment can be appended; default is off", async () => {
  const { PDFDocument, PDFName } = require("pdf-lib");
  const { file, template } = await templateWith((form, page) => box(form, page, "N", 300), [{ caseField: "a.name", pdfField: "N", type: "text" }]);
  const caseForm = { caseId: "c1", formCode: "T-1", filledData: { a: { name: "Doe" }, mystery: "Value 1" } };
  const rendered = await PDFRenderer.render({ caseForm, template, flatten: false });
  process.env.FORM_DOWNLOAD_RECOVERY_PAGE = "on";
  try {
    const outcome = await FormDataGuard.recover({ caseForm, template, result: rendered, mode: "pdf-lib" });
    const pdf = await PDFDocument.load(outcome.buffer);
    assert.equal(pdf.getPageCount(), 2);
    assert.ok(pdf.catalog.lookup(PDFName.of("Names")));
  } finally { delete process.env.FORM_DOWNLOAD_RECOVERY_PAGE; }
  await fs.unlink(file).catch(() => {});
});

test("nothing to add -> the file is returned unchanged (same bytes)", async () => {
  const { file, template } = await templateWith((form, page) => box(form, page, "N", 300), [{ caseField: "a.name", pdfField: "N", type: "text" }]);
  const caseForm = { caseId: "c1", formCode: "T-1", filledData: { a: { name: "Doe" } } };
  const rendered = await PDFRenderer.render({ caseForm, template, flatten: false });
  const outcome = await FormDataGuard.recover({ caseForm, template, result: rendered, mode: "pdf-lib" });
  assert.equal(outcome.buffer, rendered.buffer);
  assert.deepEqual(outcome.entries, []);
  await fs.unlink(file).catch(() => {});
});

test("ROOT CAUSE: a name a PDF font cannot encode no longer fails the render (it used to end in the blank form)", async () => {
  const { PDFDocument } = require("pdf-lib");
  const { file, template } = await templateWith((form, page) => { box(form, page, "N", 300); box(form, page, "M", 260); }, [
    { caseField: "a.name", pdfField: "N", type: "text" }, { caseField: "a.other", pdfField: "M", type: "text" },
  ]);
  const caseForm = { filledData: { a: { name: "张伟 Ṛāma", other: "plain" } } };
  const rendered = await PDFRenderer.render({ caseForm, template, flatten: false });
  assert.equal(rendered.renderReport.appearanceFallback, true);
  const pdf = await PDFDocument.load(rendered.buffer);
  assert.equal(pdf.getForm().getTextField("N").getText(), "张伟 Ṛāma"); // the typed value is stored exactly
  assert.equal(pdf.getForm().getTextField("M").getText(), "plain");
  assert.deepEqual(rendered.renderReport.notDisplayableFields, ["N"], "the exact text is stored in the box; only drawing its look is skipped");
  assert.deepEqual(rendered.renderReport.unplacedWrites, [], "nothing is lost, so nothing is reported as unplaced");
  await fs.unlink(file).catch(() => {});
});

test("self-heal: a box name that differs only by case/spaces is still filled", async () => {
  const { PDFDocument } = require("pdf-lib");
  const { file, template } = await templateWith((form, page) => box(form, page, "Pt1Line1FamilyName", 300), [{ caseField: "a.name", pdfField: "pt1line1 familyname", type: "text" }]);
  const rendered = await PDFRenderer.render({ caseForm: { filledData: { a: { name: "Doe" } } }, template, flatten: false });
  assert.equal((await PDFDocument.load(rendered.buffer)).getForm().getTextField("Pt1Line1FamilyName").getText(), "Doe");
  assert.deepEqual(rendered.renderReport.unplacedWrites, []);
  await fs.unlink(file).catch(() => {});
});

test("a box that is not in the PDF is reported as pdf_field_missing with its value (not silently dropped)", async () => {
  const { file, template } = await templateWith((form, page) => box(form, page, "N", 300), [{ caseField: "a.name", pdfField: "Gone", type: "text" }]);
  const rendered = await PDFRenderer.render({ caseForm: { filledData: { a: { name: "Doe" } } }, template, flatten: false });
  assert.deepEqual(rendered.renderReport.unplacedWrites.map((w) => [w.reason, w.caseField, w.value]), [["pdf_field_missing", "a.name", "Doe"]]);
  await fs.unlink(file).catch(() => {});
});

test("dropdown value not in the printed list is kept (added); a radio value not in the group is reported", async () => {
  const { PDFDocument } = require("pdf-lib");
  const { file, template } = await templateWith((form, page) => {
    const dd = form.createDropdown("Country"); dd.addOptions(["USA", "Canada"]); dd.addToPage(page, { x: 20, y: 300, width: 120, height: 20 });
    const rg = form.createRadioGroup("Sex"); rg.addOptionToPage("M", page, { x: 20, y: 250, width: 12, height: 12 }); rg.addOptionToPage("F", page, { x: 60, y: 250, width: 12, height: 12 });
  }, [{ caseField: "c", pdfField: "Country", type: "dropdown" }, { caseField: "s", pdfField: "Sex", type: "radio" }]);
  const rendered = await PDFRenderer.render({ caseForm: { filledData: { c: "Mexico", s: "X" } }, template, flatten: false });
  assert.deepEqual((await PDFDocument.load(rendered.buffer)).getForm().getDropdown("Country").getSelected(), ["Mexico"]);
  assert.deepEqual(rendered.renderReport.unplacedWrites.map((w) => [w.reason, w.caseField]), [["choice_not_available", "s"]]);
  await fs.unlink(file).catch(() => {});
});

test("checkboxes, radios, numbers and text all reach the file", async () => {
  const { PDFDocument } = require("pdf-lib");
  const { file, template } = await templateWith((form, page) => {
    box(form, page, "T", 340); box(form, page, "Num", 310); form.createCheckBox("Chk").addToPage(page, { x: 20, y: 280, width: 12, height: 12 });
    const rg = form.createRadioGroup("YN"); rg.addOptionToPage("Yes", page, { x: 20, y: 250, width: 12, height: 12 }); rg.addOptionToPage("No", page, { x: 60, y: 250, width: 12, height: 12 });
  }, [{ caseField: "t", pdfField: "T", type: "text" }, { caseField: "n", pdfField: "Num", type: "text" }, { caseField: "c", pdfField: "Chk", type: "checkbox" }, { caseField: "y", pdfField: "YN", type: "radio" }]);
  const rendered = await PDFRenderer.render({ caseForm: { filledData: { t: "text", n: 12345, c: true, y: "No" } }, template, flatten: false });
  const form = (await PDFDocument.load(rendered.buffer)).getForm();
  assert.equal(form.getTextField("T").getText(), "text");
  assert.equal(form.getTextField("Num").getText(), "12345");
  assert.equal(form.getCheckBox("Chk").isChecked(), true);
  assert.equal(form.getRadioGroup("YN").getSelected(), "No");
  assert.deepEqual(rendered.renderReport.unplacedWrites, []);
  await fs.unlink(file).catch(() => {});
});

test("two answers mapped to one box: the later still wins (unchanged) and the replaced one is listed as overwritten", async () => {
  const PDFFieldMapper = require("../services/PDFFieldMapper");
  const template = { pdfFieldMappings: [{ caseField: "a", pdfField: "X", type: "text" }, { caseField: "b", pdfField: "X", type: "text" }] };
  const mapped = PDFFieldMapper.mapFields({ filledData: { a: "first", b: "second" } }, template);
  assert.equal(mapped.mappedFields.X.value, "second");
  assert.deepEqual(mapped.collisions.map((c) => [c.lostCaseField, c.lostValue]), [["a", "first"]]);
});

test("a value held back by the form's own condition is listed, not hidden", async () => {
  const { file, template } = await templateWith((form, page) => box(form, page, "S", 300), [{ caseField: "spouse", pdfField: "S", type: "text", condition: { field: "filledData.married", operator: "equals", value: "yes" } }]);
  const caseForm = { caseId: "c", formCode: "T-1", filledData: { married: "no", spouse: "Jane" } };
  const entries = await FormDataGuard.collectUnplaced({ caseForm, template, renderReport: { unplacedWrites: [] }, mode: "pdf-lib" });
  assert.deepEqual(entries.filter((e) => e.caseField === "spouse").map((e) => [e.reason, e.value]), [["held_back_by_rule", "Jane"]]);
  await fs.unlink(file).catch(() => {});
});

test("last resort: when the form cannot be filled at all, the blank form is served (nothing added to it) and every saved value is named in the log / warning", async () => {
  const { PDFDocument } = require("pdf-lib");
  const { file, template } = await templateWith((form, page) => box(form, page, "N", 300), [{ caseField: "a.name", pdfField: "N", type: "text" }]);
  const caseForm = { _id: "f1", caseId: "c1", formCode: "T-1", status: "draft", isLocked: false, filledData: { a: { name: "Doe" }, k: "v" }, formTemplateId: { toObject: () => template }, syncState: { lastSyncedAt: new Date() }, versionNumber: 0 };
  const blankTemplate = await PDFRenderer.loadTemplateBuffer(template);
  const out = await prepareOfficialDownload({ caseFormId: "f1", user: { _id: "u" }, req: {} }, {
    adobeEnabled: false,
    PDFGenerationService: { loadCaseForm: async () => caseForm, createGeneratedDocument: async () => ({ _id: "d" }), audit: async () => {} },
    PDFRenderer: { renderFiling: async () => { throw new Error("boom"); }, render: async () => { throw new Error("boom"); }, loadTemplateBuffer: async () => blankTemplate },
    filingPolicy: { assessDownload: () => ({}), enforce: () => {} },
  });
  assert.equal(out.mode, "blank-template");
  const pdf = await PDFDocument.load(out.buffer);
  assert.equal(pdf.getPageCount(), 1, "the file is the form alone");
  assert.ok(out.warnings.some((w) => w.includes("saved value(s)") && w.includes("download log")));
  await fs.unlink(file).catch(() => {});
});

test("any failure inside the guard serves the original file and a warning - it can never fail a download", async () => {
  const buffer = Buffer.from("%PDF-not-really");
  const outcome = await FormDataGuard.recover({ caseForm: { filledData: { x: "1" } }, template: { pdfFieldMappings: [] }, result: { buffer, renderReport: null }, mode: "pdf-lib" });
  assert.equal(outcome.buffer, buffer);
  assert.equal(outcome.entries.length, 1);
  assert.ok(outcome.warnings.length >= 1);
});

test("a value staff typed is written even when the box's own condition is not met; an auto-filled one still follows the rule", () => {
  const PDFFieldMapper = require("../services/PDFFieldMapper");
  const template = { pdfFieldMappings: [
    { caseField: "spouse.typed", pdfField: "A", type: "text", condition: { field: "filledData.married", operator: "equals", value: "yes" } },
    { caseField: "spouse.auto", pdfField: "B", type: "text", condition: { field: "filledData.married", operator: "equals", value: "yes" } },
  ] };
  const caseForm = { filledData: { married: "no", spouse: { typed: "Jane", auto: "John" } }, manualOverrides: { "spouse.typed": { value: "Jane", reason: "Native PDF field edit" } } };
  const mapped = PDFFieldMapper.mapFields(caseForm, template);
  assert.deepEqual(Object.keys(mapped.mappedFields), ["A"]);
  assert.deepEqual(mapped.skippedFields.map((s) => s.caseField), ["spouse.auto"]);
  assert.equal(PDFFieldMapper.hasStaffValue({ manualOverrides: { x: { value: "" } } }, "x"), false);
});

test("a value saved for a protected box (barcode / signature / USCIS-use-only) is never silently dropped - it is listed", async () => {
  const template = { formCode: "T-1", pdfFieldMappings: [{ caseField: "sig", pdfField: "form1[0].#subform[0].PDF417BarCode1[0]", type: "text" }, { caseField: "ok", pdfField: "N", type: "text" }] };
  const entries = await FormDataGuard.collectUnplaced({ caseForm: { caseId: "c", filledData: { sig: "BARCODE-DATA", ok: "x" } }, template, renderReport: { unplacedWrites: [] }, mode: "pdf-lib" });
  assert.deepEqual(entries.filter((e) => e.reason === "protected_box"), [], "the form's own barcode text is not case data and must never put a page in the download");
  const typed = await FormDataGuard.collectUnplaced({ caseForm: { caseId: "c", filledData: { sig: "typed text" }, manualOverrides: { sig: { value: "typed text" } } }, template, renderReport: { unplacedWrites: [] }, mode: "pdf-lib" });
  assert.deepEqual(typed.filter((e) => e.reason === "protected_box").map((e) => e.value), ["typed text"]);
});

test("a box on a supplement page the core download cuts is expected (the value lives in the supplement's own form): never reported; a duplicate value elsewhere is not a loss either", async () => {
  const template = { pdfFieldMappings: [{ caseField: "a", pdfField: "A", type: "text" }] };
  const report = { unplacedWrites: [{ pdfField: "Gone", caseField: "dup", value: "Hanqi Zhang", reason: "pdf_field_missing" }, { pdfField: "Gone3", caseField: "real", value: "Only Here", reason: "pdf_field_missing" }, { pdfField: "Cut", caseField: "supp", value: "Supplement value", reason: "removed_with_page" }] };
  const entries = await FormDataGuard.collectUnplaced({ caseForm: { caseId: "c", filledData: { a: "Hanqi Zhang" } }, template, renderReport: report, mode: "pdf-lib" });
  assert.deepEqual(entries.map((e) => e.caseField), ["real"]);
});
