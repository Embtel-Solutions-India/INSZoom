// I-485 edition 2026-09-18 (Public Charge revision). USCIS renamed every A-Number widget in this edition, which silently
// broke 25 of the 41 reviewed mapping edges. DB-free: asserts the crosswalk covers BOTH editions' widget names, so the
// graph built for the new edition keeps autofilling A-Number everywhere the old one did, and nothing else drifted.
const test = require("node:test");
const assert = require("node:assert/strict");
const crosswalk = require("../config/i485-perm-crosswalk");

const names = crosswalk.MAPPED_EDGES.map((edge) => edge.fieldName);

test("every authored edge targets a unique widget", () => {
  assert.equal(new Set(names).size, names.length);
});

test("new edition: Item 4 A-Number (page 2) and all 24 page-header repeats are mapped from person.alienNumber", () => {
  const newEdition = crosswalk.MAPPED_EDGES.filter((edge) => /Pt1Line4_AlienNumber\[\d+\]$/.test(edge.fieldName) && /#subform\[(?!1\]\.Pt1Line4_AlienNumber\[0\])/.test(edge.fieldName));
  assert.ok(newEdition.length >= 25, `expected >= 25 new-edition A-Number edges, got ${newEdition.length}`);
  const item4 = crosswalk.MAPPED_EDGES.find((edge) => edge.fieldName === "form1[0].#subform[1].Pt1Line4_AlienNumber[2]");
  assert.ok(item4, "page-2 'Enter 9 digit number' widget must be the Item 4 input");
  assert.equal(item4.source, "person.alienNumber");
  assert.deepEqual(item4.transform, { type: "digits" });
  assert.equal(item4.formItem, "Item 4 A-Number");
});

test("the previous edition's widget names are still mapped (older templates stay valid)", () => {
  assert.ok(names.includes("form1[0].#subform[1].Pt1Line4_AlienNumber[0]"));
  assert.ok(names.includes("form1[0].#subform[0].AlienNumber[0]"));
});

test("name, DOB, country and address edges are unchanged between editions", () => {
  ["Pt1Line1_FamilyName[0]", "Pt1Line1_GivenName[0]", "Pt1Line3_DOB[0]", "Pt1Line7_CountryOfBirth[0]", "Pt1Line18_StreetNumberName[0]"]
    .forEach((suffix) => assert.ok(names.some((name) => name.endsWith(suffix)), `${suffix} must stay mapped`));
});

test("no Yes/No box is ever defaulted by the crosswalk", () => {
  assert.equal(crosswalk.MAPPED_EDGES.filter((edge) => /YesNo|YN|Checkbox|CB_/.test(edge.fieldName)).length, 0);
});
