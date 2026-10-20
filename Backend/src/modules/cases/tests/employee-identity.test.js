const assert = require("node:assert/strict");
const test = require("node:test");
const { employeeContact, validateIdentityInput, isUninvitedEmployee } = require("../employee-identity");

test("an employee case's contact comes from the typed identity, then the creation mirror, then the invitation; other roles have none", () => {
  assert.deepEqual(employeeContact({ caseRole: "employee", employeeIdentity: { name: " Ana  Souza ", email: "ANA@x.com" } }), { name: "Ana Souza", email: "ana@x.com", missingName: false, missingEmail: false, complete: true });
  assert.equal(employeeContact({ caseRole: "employee", pendingEmployee: { name: "Raj", email: "raj@x.com" } }).email, "raj@x.com");
  assert.equal(employeeContact({ caseRole: "employee", clientName: "Invited", clientEmail: "i@x.com" }).name, "Invited");
  assert.equal(employeeContact({ caseRole: "principal", clientName: "Acme" }), null);
});

test("what is missing is reported so both portals can keep asking for it", () => {
  assert.deepEqual(employeeContact({ caseRole: "employee" }), { name: "", email: "", missingName: true, missingEmail: true, complete: false });
  assert.deepEqual(employeeContact({ caseRole: "employee", employeeIdentity: { email: "a@x.com" } }), { name: "", email: "a@x.com", missingName: true, missingEmail: false, complete: false });
});

test("typed identity: a valid email that is not the employer's or another employee's; name optional; at least one field", () => {
  assert.deepEqual(validateIdentityInput({ name: " Ana ", email: "A@X.com" }).identity, { name: "Ana", email: "a@x.com" });
  assert.deepEqual(validateIdentityInput({ name: "Ana" }).identity, { name: "Ana" });
  assert.match(validateIdentityInput({ email: "nope" }).message, /valid email/);
  assert.match(validateIdentityInput({ email: "boss@x.com" }, { blockedEmails: ["Boss@x.com"] }).message, /employer's own/);
  assert.match(validateIdentityInput({ email: "b@x.com" }, { siblingEmails: ["B@x.com"] }).message, /already used/);
  assert.match(validateIdentityInput({}).message, /name or email/);
  assert.match(validateIdentityInput({ name: "" , email: "" }).message, /name or email/);
});

test("an employee who has not been invited (the file is held by the employer) is never a delivery address", () => {
  assert.equal(isUninvitedEmployee({ caseRole: "employee" }, { role: "client" }), true);
  assert.equal(isUninvitedEmployee({ caseRole: "employee" }, null), true);
  assert.equal(isUninvitedEmployee({ caseRole: "employee" }, { role: "employee" }), false); // invited: their own login
  assert.equal(isUninvitedEmployee({ caseRole: "principal" }, { role: "client" }), false);
});
