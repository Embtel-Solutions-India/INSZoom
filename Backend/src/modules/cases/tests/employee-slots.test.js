const assert = require("node:assert/strict");
const test = require("node:test");
const { validateEmployeeSlots } = require("../employee-slots");

test("name and email are both optional; a given email is normalised", () => {
  const ok = validateEmployeeSlots([{ name: " Ana Souza ", email: "ANA@Example.com" }, { name: "Raj Rao", email: "raj@example.com" }], 2, ["boss@example.com"]);
  assert.deepEqual(ok.slots, [{ name: "Ana Souza", email: "ana@example.com" }, { name: "Raj Rao", email: "raj@example.com" }]);
});

test("a missing row or missing email is an empty slot; a bad email is refused with a message naming the employee", () => {
  assert.deepEqual(validateEmployeeSlots([{ name: "A", email: "a@x.com" }], 2).slots, [{ name: "A", email: "a@x.com" }, { name: "", email: "" }]); // a missing row is just an empty slot
  assert.match(validateEmployeeSlots([{ name: "A", email: "nope" }], 1).message, /valid email/);
  assert.deepEqual(validateEmployeeSlots(undefined, 1).slots, [{ name: "", email: "" }]); // the email is optional
  assert.deepEqual(validateEmployeeSlots([{ name: "Only Name" }, { email: "" }], 2).slots, [{ name: "Only Name", email: "" }, { name: "", email: "" }]);
  assert.equal(validateEmployeeSlots([{ email: "" }, { email: "  " }], 2).message, undefined); // blanks never collide as duplicates
  assert.deepEqual(validateEmployeeSlots([{ name: "", email: "a@x.com" }, { email: "b@x.com" }], 2).slots, [{ name: "", email: "a@x.com" }, { name: "", email: "b@x.com" }]);
});

test("the employer's own email and a repeated email are refused", () => {
  assert.match(validateEmployeeSlots([{ name: "A", email: "Boss@example.com" }], 1, ["boss@example.com"]).message, /employer's own address/);
  assert.match(validateEmployeeSlots([{ name: "A", email: "a@x.com" }, { name: "B", email: "A@x.com" }], 2).message, /already used/);
});
