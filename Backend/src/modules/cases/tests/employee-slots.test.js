const assert = require("node:assert/strict");
const test = require("node:test");
const { validateEmployeeSlots } = require("../employee-slots");

test("every employee case needs a valid email (the name is optional); emails are normalised", () => {
  const ok = validateEmployeeSlots([{ name: " Ana Souza ", email: "ANA@Example.com" }, { name: "Raj Rao", email: "raj@example.com" }], 2, ["boss@example.com"]);
  assert.deepEqual(ok.slots, [{ name: "Ana Souza", email: "ana@example.com" }, { name: "Raj Rao", email: "raj@example.com" }]);
});

test("a missing row or a missing / bad email is refused with a message naming the employee; a missing name is fine", () => {
  assert.match(validateEmployeeSlots([{ name: "A", email: "a@x.com" }], 2).message, /^Employee 2: enter a valid email/);
  assert.match(validateEmployeeSlots([{ name: "A", email: "nope" }], 1).message, /valid email/);
  assert.match(validateEmployeeSlots(undefined, 1).message, /valid email/);
  assert.deepEqual(validateEmployeeSlots([{ name: "", email: "a@x.com" }, { email: "b@x.com" }], 2).slots, [{ name: "", email: "a@x.com" }, { name: "", email: "b@x.com" }]);
});

test("the employer's own email and a repeated email are refused", () => {
  assert.match(validateEmployeeSlots([{ name: "A", email: "Boss@example.com" }], 1, ["boss@example.com"]).message, /employer's own address/);
  assert.match(validateEmployeeSlots([{ name: "A", email: "a@x.com" }, { name: "B", email: "A@x.com" }], 2).message, /already used/);
});
