const assert = require("node:assert/strict");
const test = require("node:test");
const { isPendingInvite } = require("../employeeInvite.service");

test("isPendingInvite is true only for a passwordless invited employee", () => {
  assert.equal(isPendingInvite({ role: "employee", password: undefined }), true);
  assert.equal(isPendingInvite({ role: "employee", password: "" }), true);
});

test("isPendingInvite is false once the employee has set a password", () => {
  assert.equal(isPendingInvite({ role: "employee", password: "$2b$hashed" }), false);
});

test("isPendingInvite is false for a normal (non-employee) account, password set or not", () => {
  assert.equal(isPendingInvite({ role: "client", password: undefined }), false);
  assert.equal(isPendingInvite({ role: "employer", password: "$2b$hashed" }), false);
});

test("isPendingInvite is false for a missing user", () => {
  assert.equal(isPendingInvite(null), false);
  assert.equal(isPendingInvite(undefined), false);
});
