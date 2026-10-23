// Phase 7.8 fix: a pure "Part 1 became Part 3" shift (same printed words, page, position, widget kind and options; only the part heading changed) is carried at high confidence,
// but never when it could be a DIFFERENT question that merely sits where the old one used to be. Plain field objects; no PDF, no database.
const test = require("node:test");
const assert = require("node:assert/strict");
const { match, acceptable } = require("../matching");

let n = 0;
// `core` is the renumbering-proof name core (Pt1Line1_FamilyName and Pt3Line1_FamilyName share `familyname`), the way a real part shift keeps it
const box = (id, { label, section, page = 1, x = 100, y = 600, type = "text", options, name, part = 1, core = id } = {}) => ({
  fieldId: id, fieldName: name || `form1[0].#subform[${n++}].Pt${part}_${core}[0]`, label, section, pageNumber: page, fieldType: type, pdfFieldType: type, options,
  boundingBox: { x, y, width: 180, height: 20 }, coordinateSystem: { pageWidth: 612, pageHeight: 792 },
});
const resultFor = (out, oldId) => out.results.find((item) => item.oldId === oldId);

test("a pure Part 1 -> Part 3 shift is carried, with the reason recorded", () => {
  const olds = [box("o1", { label: "Family Name (Last Name)", section: "part 1 information about you", core: "FamilyName" }), box("o2", { label: "Given Name (First Name)", section: "part 1 information about you", y: 560, core: "GivenName" })];
  const news = [box("n1", { label: "Family Name (Last Name)", section: "part 3 information about you", part: 3, core: "FamilyName" }), box("n2", { label: "Given Name (First Name)", section: "part 3 information about you", y: 560, part: 3, core: "GivenName" })];
  const out = match(olds, news);
  for (const [o, nw] of [["o1", "n1"], ["o2", "n2"]]) {
    const r = resultFor(out, o);
    assert.equal(r.newId, nw);
    assert.equal(r.confidence, "high");
    assert.ok(r.reasons.includes("section_heading_changed"));
    assert.equal(acceptable(r), true);
  }
});

test("not carried when another box of the new edition still has the old heading with the same words (the question did not merely move)", () => {
  const olds = [box("o1", { label: "Family Name (Last Name)", section: "part 1 information about you", y: 600 })];
  const news = [
    box("n1", { label: "Family Name (Last Name)", section: "part 3 information about the beneficiary", y: 600 }),
    box("n2", { label: "Family Name (Last Name)", section: "part 1 information about you", y: 300 }),
  ];
  const r = resultFor(match(olds, news), "o1");
  assert.notEqual(r.confidence, "high");
  assert.equal(acceptable(r), false);
});

test("not carried when the new box is the successor of a different old question under its own heading (a beneficiary box now where the applicant box was)", () => {
  const olds = [
    box("o1", { label: "Family Name (Last Name)", section: "part 1 information about you", y: 600 }),
    box("o2", { label: "Family Name (Last Name)", section: "part 3 information about the beneficiary", y: 300 }),
  ];
  const news = [
    box("n1", { label: "Family Name (Last Name)", section: "part 3 information about the beneficiary", y: 600 }),
    box("n2", { label: "Family Name (Last Name)", section: "part 1 information about you", y: 300 }),
  ];
  const out = match(olds, news);
  const first = resultFor(out, "o1");
  assert.notEqual(first.newId === "n1" && first.confidence === "high", true, "the applicant's box must never be carried into the beneficiary's box");
  assert.notEqual(first.newId === "n1" && acceptable(first), true);
});

test("a generic label (Yes, No, City) is never carried on a heading change", () => {
  for (const label of ["Yes", "No", "City"]) {
    const r = resultFor(match([box("o1", { label, section: "part 1 a", type: "checkbox" })], [box("n1", { label, section: "part 3 a", type: "checkbox" })]), "o1");
    assert.notEqual(r.confidence, "high", label);
  }
});

test("a heading change never overrides a different widget kind, a different option set, a different page or a different position", () => {
  const base = { label: "Marital Status", section: "part 1 info", page: 1, x: 100, y: 600 };
  const old = box("o1", { ...base, type: "radio", options: ["Single", "Married"] });
  const changes = [
    box("n1", { ...base, section: "part 3 info", type: "text" }),
    box("n1", { ...base, section: "part 3 info", type: "radio", options: ["Single", "Wed"] }),
    box("n1", { ...base, section: "part 3 info", type: "radio", options: ["Single", "Married"], page: 2 }),
    box("n1", { ...base, section: "part 3 info", type: "radio", options: ["Single", "Married"], y: 100 }),
  ];
  for (const nw of changes) assert.notEqual(resultFor(match([old], [nw]), "o1").confidence, "high");
});

test("unchanged heading still matches exactly as before (rule B)", () => {
  const r = resultFor(match([box("o1", { label: "Email Address", section: "part 1 info" })], [box("n1", { label: "Email Address", section: "part 1 info" })]), "o1");
  assert.equal(r.confidence, "high");
  assert.ok(!r.reasons.includes("section_heading_changed"));
});
