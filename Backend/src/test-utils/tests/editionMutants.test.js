// Phase 7 (7.8): each synthetic mutant behaves as labeled and changes nothing else. No database, no network.
const test = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument } = require("pdf-lib");
const mutants = require("../editionMutants");

async function basePdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const page2 = doc.addPage([612, 792]);
  const form = doc.getForm();
  [["Pt2Line3a_FamilyName", 700], ["Pt2Line4a_GivenName", 660], ["Pt2Line5_Other", 620]].forEach(([name, y]) => {
    const field = form.createTextField(name);
    field.setText("x");
    field.addToPage(page, { x: 50, y, width: 200, height: 20 });
  });
  const radio = form.createRadioGroup("Pt1_Status");
  radio.addOptionToPage("Single", page, { x: 300, y: 700, width: 14, height: 14 });
  radio.addOptionToPage("Married", page, { x: 340, y: 700, width: 14, height: 14 });
  const check = form.createCheckBox("Pt1_Check");
  check.addToPage(page2, { x: 50, y: 700, width: 14, height: 14 });
  return Buffer.from(await doc.save());
}

const open = (bytes) => PDFDocument.load(bytes, { ignoreEncryption: true });
const describe = async (bytes) => {
  const doc = await open(bytes);
  return { pages: doc.getPageCount(), fields: doc.getForm().getFields().map((f) => ({ name: f.getName(), type: f.constructor.name })) };
};

test("every mutant is labeled synthetic and the catalog lists each generator", async () => {
  const base = await basePdf();
  const results = [
    await mutants.renameFields(base, { Pt2Line3a_FamilyName: "Pt2Line3b_FamilyName" }),
    await mutants.renumberFields(base, { prefix: "Pt2Line", shift: 1 }),
    await mutants.insertPage(base, { index: 1, headingText: "Supplement Z" }),
    await mutants.removeFields(base, ["Pt1_Check"]),
    await mutants.changeRadioOptions(base, { groupName: "Pt1_Status", options: ["A", "B", "C"] }),
    await mutants.xfaOnly(base),
    await mutants.passwordProtected(base),
    mutants.htmlResponse(),
    mutants.oversize(base, { extraBytes: 1000 }),
  ];
  for (const item of results) {
    assert.equal(item.synthetic, true);
    assert.ok(item.name && item.mutation?.kind && Buffer.isBuffer(item.buffer));
  }
  assert.deepEqual(results.map((item) => item.name).sort(), mutants.CATALOG.map((item) => item.name).sort());
});

test("rename changes the field name and nothing else", async () => {
  const base = await basePdf();
  const before = await describe(base);
  const out = await mutants.renameFields(base, { Pt2Line3a_FamilyName: "Pt2Line3b_FamilyName" });
  const after = await describe(out.buffer);
  assert.deepEqual(out.mutation.fields, { Pt2Line3a_FamilyName: "Pt2Line3b_FamilyName" });
  assert.equal(after.pages, before.pages);
  assert.deepEqual(after.fields.map((f) => f.type), before.fields.map((f) => f.type));
  assert.deepEqual(after.fields.map((f) => f.name), before.fields.map((f) => (f.name === "Pt2Line3a_FamilyName" ? "Pt2Line3b_FamilyName" : f.name)));
  const doc = await open(out.buffer);
  assert.equal(doc.getForm().getTextField("Pt2Line3b_FamilyName").getText(), "x", "the value moved with the field");
});

test("renumber shifts every matching line number and leaves other fields alone", async () => {
  const out = await mutants.renumberFields(await basePdf(), { prefix: "Pt2Line", shift: 1 });
  const names = (await describe(out.buffer)).fields.map((f) => f.name).sort();
  assert.deepEqual(names, ["Pt1_Check", "Pt1_Status", "Pt2Line4a_FamilyName", "Pt2Line5a_GivenName", "Pt2Line6_Other"].sort());
});

test("inserted page adds exactly one page (and the optional field) and keeps all existing fields", async () => {
  const base = await basePdf();
  const out = await mutants.insertPage(base, { index: 1, headingText: "Supplement Z", fieldName: "SupZ_Field1" });
  const before = await describe(base);
  const after = await describe(out.buffer);
  assert.equal(after.pages, before.pages + 1);
  assert.deepEqual(after.fields.map((f) => f.name).filter((n) => n !== "SupZ_Field1"), before.fields.map((f) => f.name));
  assert.ok(after.fields.some((f) => f.name === "SupZ_Field1"));
});

test("removed field removes exactly the named field", async () => {
  const base = await basePdf();
  const out = await mutants.removeFields(base, ["Pt1_Check", "does-not-exist"]);
  assert.deepEqual(out.mutation.fields, ["Pt1_Check"]);
  const after = (await describe(out.buffer)).fields.map((f) => f.name);
  assert.deepEqual(after, (await describe(base)).fields.map((f) => f.name).filter((n) => n !== "Pt1_Check"));
});

test("radio option change keeps the group name and replaces the option set", async () => {
  const out = await mutants.changeRadioOptions(await basePdf(), { groupName: "Pt1_Status", options: ["A", "B", "C"] });
  assert.deepEqual(out.mutation.before.sort(), ["Married", "Single"]);
  const doc = await open(out.buffer);
  assert.deepEqual(doc.getForm().getRadioGroup("Pt1_Status").getOptions().sort(), ["A", "B", "C"]);
  assert.equal(doc.getForm().getFields().length, 5);
  await assert.rejects(mutants.changeRadioOptions(await basePdf(), { groupName: "nope", options: ["A"] }), /not found/);
});

test("xfa-only has zero fields and an XFA entry", async () => {
  const out = await mutants.xfaOnly(await basePdf());
  // read the raw bytes: pdf-lib itself strips XFA the moment getForm() is called, which is exactly what the pipeline relies on
  assert.match(out.buffer.toString("latin1"), /\/XFA\s+\d+\s+\d+\s+R/, "the AcroForm names an XFA stream");
  assert.equal((await open(out.buffer)).getForm().getFields().length, 0);
  assert.ok(out.mutation.fieldsRemoved > 0);
});

test("password marker carries /Encrypt in the trailer (and says it is a marker)", async () => {
  const out = await mutants.passwordProtected(await basePdf());
  assert.match(out.buffer.toString("latin1"), /\/Encrypt\s+\d+\s+\d+\s+R/);
  assert.equal(out.mutation.marker, true);
  await assert.rejects(PDFDocument.load(out.buffer), /encrypt/i, "pdf-lib itself refuses it unless told to ignore encryption");
});

test("html response is HTML served as the document; oversize is a still-valid PDF longer by exactly the padding", async () => {
  const html = mutants.htmlResponse({ title: "Not Found" });
  assert.equal(html.contentType, "text/html");
  assert.ok(!html.buffer.subarray(0, 5).equals(Buffer.from("%PDF-")));
  const base = await basePdf();
  const big = mutants.oversize(base, { extraBytes: 5000 });
  assert.equal(big.buffer.length, base.length + 1 + 5000);
  assert.ok(big.buffer.subarray(0, 5).equals(Buffer.from("%PDF-")));
  assert.equal((await open(big.buffer)).getPageCount(), 2);
});
