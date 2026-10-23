// Phase 7.3 proof (a): the FieldMatcher on synthetic edition pairs built with pdf-lib and the Phase 7.8 edition mutants. Every pair is SCANNED with the real
// PDFFieldScannerService, so the matcher sees exactly the field shape production sees. No database, no network.
// The bar: ZERO wrong high-confidence matches and ZERO wrong medium matches in every scenario; a field the matcher cannot prove is left unmatched.
const test = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument, PDFName, PDFString } = require("pdf-lib");
const PDFFieldScannerService = require("../../uscis-form-import/services/PDFFieldScannerService");
const mutants = require("../../../test-utils/editionMutants");
const { match, exactMatchConflicts } = require("../matching");

const scan = async (buffer) => (await new PDFFieldScannerService().scan(buffer)).fields;

// flat partial names that contain the container path, exactly like the names the editions mutants and the real USCIS forms use
const setName = (field, name) => field.acroField.setPartialName(name);
const tooltip = (field, text) => field.acroField.dict.set(PDFName.of("TU"), PDFString.of(text));
let counter = 0;
const tmp = () => `t${++counter}`;

const TEXT = [
  // page, subform, name, tooltip, x, y, w, h
  [0, 0, "Pt1Line1a_FamilyName[0]", "Family Name (Last Name)", 50, 700, 180, 20],
  [0, 0, "Pt1Line1b_GivenName[0]", "Given Name (First Name)", 50, 660, 180, 20],
  [0, 0, "Pt1Line2_DOB[0]", "Date of Birth (mm/dd/yyyy)", 50, 620, 100, 20],
  [0, 0, "Pt1Line3_Email[0]", "Email Address", 50, 580, 220, 20],
  [0, 0, "Pt1Line4_AlienNumber[0]", "Enter 9 digit number", 350, 700, 130, 18],
  [1, 1, "Pt2Line1_Street[0]", "Street Number and Name", 50, 700, 220, 20],
  [1, 1, "Pt2Line2_City[0]", "City or Town", 50, 660, 150, 20],
  [1, 1, "Pt2Line3_Zip[0]", "ZIP Code", 50, 620, 80, 20],
  [1, 1, "Pt2Line4_Phone[0]", "Daytime Telephone Number", 50, 580, 120, 20],
  [1, 1, "Pt1Line4_AlienNumber[1]", "This field pre-populates from page 1", 453, 738, 122, 18],
  [2, 2, "Pt3Line1_EmployerName[0]", "Name of Employer", 50, 700, 220, 20],
  [2, 2, "Pt3Line2_JobTitle[0]", "Job Title", 50, 660, 180, 20],
  [2, 2, "Pt1Line4_AlienNumber[2]", "This field pre-populates from page 1", 453, 738, 122, 18],
];

/** The base edition: 3 pages, text boxes with help text, a check box, a gender radio group, a state drop-down and per-page A-Number repeats. */
async function baseEdition() {
  const doc = await PDFDocument.create();
  const pages = [doc.addPage([612, 792]), doc.addPage([612, 792]), doc.addPage([612, 792])];
  const form = doc.getForm();
  for (const [page, sub, name, tip, x, y, width, height] of TEXT) {
    const field = form.createTextField(tmp());
    field.addToPage(pages[page], { x, y, width, height });
    setName(field, `form1[0].#subform[${sub}].${name}`);
    tooltip(field, tip);
  }
  const married = form.createCheckBox(tmp());
  married.addToPage(pages[0], { x: 50, y: 540, width: 12, height: 12 });
  setName(married, "form1[0].#subform[0].Pt1Line5_Married[0]");
  tooltip(married, "Married");
  const gender = form.createRadioGroup(tmp());
  gender.addOptionToPage("Male", pages[0], { x: 50, y: 500, width: 12, height: 12 });
  gender.addOptionToPage("Female", pages[0], { x: 120, y: 500, width: 12, height: 12 });
  setName(gender, "form1[0].#subform[0].Pt1Line6_Gender[0]");
  tooltip(gender, "Gender");
  const state = form.createDropdown(tmp());
  state.addOptions(["CA", "NY", "TX"]);
  state.addToPage(pages[1], { x: 300, y: 660, width: 70, height: 20 });
  setName(state, "form1[0].#subform[1].Pt2Line2b_State[0]");
  tooltip(state, "State");
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

const full = (sub, name) => `form1[0].#subform[${sub}].${name}`;

/** Scores one scenario. truth: { oldName: newName | null } by PDF field name (null = removed / not matchable by design). */
async function score(label, oldBytes, newBytes, truth) {
  const oldFields = await scan(oldBytes);
  const newFields = await scan(newBytes);
  const idByNewName = new Map(newFields.map((field) => [field.fieldName, field.fieldId]));
  const nameByOldId = new Map(oldFields.map((field) => [field.fieldId, field.fieldName]));
  const { results, conflicts } = match(oldFields, newFields);
  const row = { scenario: label, expected: 0, high: 0, medium: 0, wrongHigh: 0, wrongMedium: 0, missed: 0, falsePositive: 0 };
  for (const result of results) {
    const oldName = nameByOldId.get(result.oldId);
    const expectedName = truth[oldName];
    const hasTruth = expectedName !== undefined && expectedName !== null;
    if (hasTruth) row.expected += 1;
    if (result.confidence === "high" || result.confidence === "medium") {
      const correct = hasTruth && idByNewName.get(expectedName) === result.newId;
      if (correct) row[result.confidence] += 1;
      else if (hasTruth) row[result.confidence === "high" ? "wrongHigh" : "wrongMedium"] += 1;
      else row.falsePositive += 1;
    } else if (hasTruth) row.missed += 1;
  }
  return { row, results, conflicts, oldFields, newFields };
}

const table = [];
const allNames = (sub) => TEXT.filter((entry) => entry[1] === sub).map((entry) => full(entry[1], entry[2]));
const identity = () => Object.fromEntries(TEXT.map((entry) => [full(entry[1], entry[2]), full(entry[1], entry[2])]).concat([
  [full(0, "Pt1Line5_Married[0]"), full(0, "Pt1Line5_Married[0]")], [full(0, "Pt1Line6_Gender[0]"), full(0, "Pt1Line6_Gender[0]")], [full(1, "Pt2Line2b_State[0]"), full(1, "Pt2Line2b_State[0]")],
]));

test.after(() => {
  console.log("\nFieldMatcher on synthetic edition pairs (zero wrong matches required)");
  console.table(table);
});

test("an unchanged edition matches every field with high confidence", async () => {
  const base = await baseEdition();
  const { row, results } = await score("unchanged", base, base, identity());
  table.push(row);
  assert.equal(row.high, row.expected);
  assert.equal(row.wrongHigh + row.wrongMedium + row.falsePositive + row.missed, 0);
  assert.ok(results.every((result) => result.confidence === "high"));
});

test("renamed fields (same help text, same place) are recovered and never mismatched", async () => {
  const base = await baseEdition();
  const renamed = (await mutants.renameFields(base, { [full(0, "Pt1Line1a_FamilyName[0]")]: full(0, "Pt1Line1a_LastName[0]"), [full(1, "Pt2Line2_City[0]")]: full(1, "Pt2Line2_Town[0]") })).buffer;
  const truth = { ...identity(), [full(0, "Pt1Line1a_FamilyName[0]")]: full(0, "Pt1Line1a_LastName[0]"), [full(1, "Pt2Line2_City[0]")]: full(1, "Pt2Line2_Town[0]") };
  const { row, results } = await score("renamed x2", base, renamed, truth);
  table.push(row);
  assert.equal(row.wrongHigh + row.wrongMedium + row.falsePositive, 0);
  assert.ok(row.high + row.medium >= row.expected - 1, `recall ${row.high + row.medium}/${row.expected}`);
  const family = results.find((result) => result.oldId.includes("FamilyName"));
  assert.ok(["high", "medium"].includes(family.confidence), "a rename that keeps its help text, page and position is provably the same box");
});

test("renumbered lines (Pt2Line1..4 shifted by one) keep their identity", async () => {
  const base = await baseEdition();
  const shifted = (await mutants.renumberFields(base, { prefix: "Pt2Line", shift: 1, fromNumber: 1 })).buffer;
  const truth = identity();
  for (const [, sub, name] of TEXT) {
    const match1 = name.match(/^Pt2Line(\d+)(.*)$/);
    if (match1) truth[full(sub, name)] = full(sub, `Pt2Line${Number(match1[1]) + 1}${match1[2]}`);
  }
  truth[full(1, "Pt2Line2b_State[0]")] = full(1, "Pt2Line3b_State[0]");
  const { row } = await score("renumbered Pt2", base, shifted, truth);
  table.push(row);
  assert.equal(row.wrongHigh + row.wrongMedium + row.falsePositive, 0);
  assert.ok(row.high + row.medium >= row.expected - 1, `recall ${row.high + row.medium}/${row.expected}`);
});

test("an inserted page that renumbers the containers (#subform[1] -> [2]) changes nothing about identity", async () => {
  const base = await baseEdition();
  const withPage = (await mutants.insertPage(base, { index: 1, headingText: "New Part", fieldName: "form1[0].#subform[9].PtNew_Extra[0]" })).buffer;
  const renames = {};
  const truth = identity();
  for (const [, sub, name] of TEXT.filter((entry) => entry[1] >= 1)) { renames[full(sub, name)] = full(sub + 1, name); truth[full(sub, name)] = full(sub + 1, name); }
  renames[full(1, "Pt2Line2b_State[0]")] = full(2, "Pt2Line2b_State[0]");
  truth[full(1, "Pt2Line2b_State[0]")] = full(2, "Pt2Line2b_State[0]");
  const shifted = (await mutants.renameFields(withPage, renames)).buffer;
  const { row, results } = await score("inserted page + container shift", base, shifted, truth);
  table.push(row);
  assert.equal(row.wrongHigh + row.wrongMedium + row.falsePositive, 0);
  assert.equal(row.high, row.expected, "the container path is not part of a field's identity: every field is an exact (high) match");
  assert.ok(results.every((result) => result.confidence === "high"));
});

test("removed fields stay unmatched (nothing is guessed to replace them)", async () => {
  const base = await baseEdition();
  const gone = [full(0, "Pt1Line3_Email[0]"), full(2, "Pt3Line2_JobTitle[0]")];
  const stripped = (await mutants.removeFields(base, gone)).buffer;
  const truth = identity();
  gone.forEach((name) => { truth[name] = null; });
  const { row, results } = await score("removed x2", base, stripped, truth);
  table.push(row);
  assert.equal(row.wrongHigh + row.wrongMedium + row.falsePositive, 0);
  assert.equal(row.high, row.expected);
  const removed = results.filter((result) => /Email|JobTitle/.test(result.oldId));
  assert.ok(removed.every((result) => result.confidence === "none" && result.newId === null));
});

test("a radio group whose export values changed is NOT matched, and the conflict is reported", async () => {
  const base = await baseEdition();
  const changed = (await mutants.changeRadioOptions(base, { groupName: full(0, "Pt1Line6_Gender[0]"), options: ["M", "F", "X"] })).buffer;
  const truth = identity();
  truth[full(0, "Pt1Line6_Gender[0]")] = null;
  const { row, results, conflicts } = await score("radio options changed", base, changed, truth);
  table.push(row);
  assert.equal(row.wrongHigh + row.wrongMedium + row.falsePositive, 0);
  const gender = results.find((result) => /Gender/.test(result.oldId));
  assert.equal(gender.confidence, "none");
  assert.ok(conflicts.some((conflict) => /Gender/.test(conflict.oldId) && conflict.reasons.includes("options_differ")));
});

test("a field whose widget kind changed (text -> check box) is never matched, and the exact-name conflict is reported", async () => {
  const base = await baseEdition();
  const doc = await PDFDocument.load(base, { ignoreEncryption: true, updateMetadata: false });
  const form = doc.getForm();
  const email = form.getFields().find((field) => field.getName() === full(0, "Pt1Line3_Email[0]"));
  form.removeField(email);
  const box = form.createCheckBox(tmp());
  box.addToPage(doc.getPages()[0], { x: 50, y: 580, width: 12, height: 12 });
  setName(box, full(0, "Pt1Line3_Email[0]"));
  tooltip(box, "Email Address");
  const changed = Buffer.from(await doc.save({ useObjectStreams: false }));
  const truth = identity();
  truth[full(0, "Pt1Line3_Email[0]")] = null;
  const { row, results, oldFields, newFields } = await score("text -> checkbox", base, changed, truth);
  table.push(row);
  assert.equal(row.wrongHigh + row.wrongMedium + row.falsePositive, 0);
  assert.equal(results.find((result) => /Email/.test(result.oldId)).confidence, "none");
  const hard = exactMatchConflicts(oldFields, newFields).filter((conflict) => conflict.severity === "hard");
  assert.ok(hard.some((conflict) => /Email/.test(conflict.oldId) && conflict.reasons.includes("kind_differs")));
});

test("the per-page A-Number repeats (same help text, same position) are told apart by page, never swapped", async () => {
  const base = await baseEdition();
  const renamed = (await mutants.renameFields(base, { [full(1, "Pt1Line4_AlienNumber[1]")]: full(1, "AlienNumber[7]"), [full(2, "Pt1Line4_AlienNumber[2]")]: full(2, "AlienNumber[8]") })).buffer;
  const truth = { ...identity(), [full(1, "Pt1Line4_AlienNumber[1]")]: full(1, "AlienNumber[7]"), [full(2, "Pt1Line4_AlienNumber[2]")]: full(2, "AlienNumber[8]") };
  const { row } = await score("A-Number repeats renamed", base, renamed, truth);
  table.push(row);
  assert.equal(row.wrongHigh + row.wrongMedium + row.falsePositive, 0, "a swapped repeat would carry page 2's value to page 3");
  assert.ok(row.high + row.medium >= row.expected - 1);
});

test("ambiguous candidates are left unmatched: two new fields equally like one old field", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  const make = (name, x) => { const field = form.createTextField(tmp()); field.addToPage(page, { x, y: 700, width: 100, height: 20 }); setName(field, full(0, name)); tooltip(field, "Date"); };
  make("Pt1Line1_A[0]", 50);
  const oldBytes = Buffer.from(await doc.save({ useObjectStreams: false }));
  const doc2 = await PDFDocument.create();
  const page2 = doc2.addPage([612, 792]);
  const form2 = doc2.getForm();
  [["Pt1Line9_X[0]", 50], ["Pt1Line9_Y[0]", 50]].forEach(([name, x]) => { const field = form2.createTextField(tmp()); field.addToPage(page2, { x, y: 700, width: 100, height: 20 }); setName(field, full(0, name)); tooltip(field, "Date"); });
  const newBytes = Buffer.from(await doc2.save({ useObjectStreams: false }));
  const { results } = match(await scan(oldBytes), await scan(newBytes));
  assert.equal(results[0].confidence, "none");
  assert.deepEqual(results[0].reasons, ["ambiguous"]);
});
