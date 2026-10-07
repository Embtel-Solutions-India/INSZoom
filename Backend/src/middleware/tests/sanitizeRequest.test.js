// The request sanitizer must keep blocking injection keys, but must NOT silently empty a form's field-value map just
// because PDF field names / field ids contain dots (the cause of "saved" forms downloading blank).
const assert = require("node:assert/strict");
const test = require("node:test");
const { sanitizeValue } = require("../sanitizeRequest");

test("dotted keys inside fieldValues / filledData survive (form field names)", () => {
  const body = sanitizeValue({
    sectionKey: "part1",
    fieldValues: { "form1[0].#subform[0].Pt1Line1_FamilyName[0]": "Smith", "part1.form10Subform0Part1Line1GivenName0": "Jane" },
  });
  assert.equal(body.fieldValues["form1[0].#subform[0].Pt1Line1_FamilyName[0]"], "Smith");
  assert.equal(body.fieldValues["part1.form10Subform0Part1Line1GivenName0"], "Jane");
});

test("dotted keys anywhere else are still dropped", () => {
  const body = sanitizeValue({ "a.b": 1, nested: { "profile.role": "admin", ok: 2 } });
  assert.deepEqual(body, { nested: { ok: 2 } });
});

test("operator and prototype keys are blocked everywhere, including inside fieldValues", () => {
  const body = sanitizeValue({ $where: "x", fieldValues: { $set: { a: 1 }, "form1[0].x": "keep", __proto__: { polluted: true }, constructor: 1 } });
  assert.deepEqual(Object.keys(body), ["fieldValues"]);
  assert.deepEqual(Object.keys(body.fieldValues), ["form1[0].x"]);
  assert.equal({}.polluted, undefined);
});

test("a $-operator nested under fieldValues is removed at any depth", () => {
  const body = sanitizeValue({ fieldValues: { "a.b": { $gt: "" } } });
  assert.deepEqual(body.fieldValues["a.b"], {});
});
