// DB-free: the Cases page "visa category" filter (?visaTypes=a,b,c) builds a whole-name, separator-tolerant match on the stored visa type.
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCaseFilter } = require("../case.service");

const conditionOf = (filter) => (filter.$and || []).find((item) => item.visaType)?.visaType;
const admin = { _id: "000000000000000000000001", role: "super_admin" };

test("a category list becomes one anchored regex that matches exactly its visa types", () => {
  const filter = buildCaseFilter({ visaTypes: "H-1B,L-1A,O-1A,TN" }, admin);
  const { $regex, $options } = conditionOf(filter);
  const re = new RegExp($regex, $options);
  for (const name of ["H-1B", "H1B", "L-1A", "o-1a", "TN"]) assert.equal(re.test(name), true, name);
  for (const name of ["L-1A Extension", "EB-1A", "STAMPING", "Green Card Renewal", ""]) assert.equal(re.test(name), false, name);
});

test("no list, an empty list or junk adds no visa condition (the page behaves as before)", () => {
  for (const visaTypes of [undefined, "", " , ,", []]) assert.equal(conditionOf(buildCaseFilter({ visaTypes }, admin)), undefined);
});

test("regex characters in a name cannot break the filter, and a repeated visaTypes param works", () => {
  const filter = buildCaseFilter({ visaTypes: ["A.B(", "TN"] }, admin);
  assert.doesNotThrow(() => new RegExp(conditionOf(filter).$regex, "i"));
});
