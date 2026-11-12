const test = require("node:test");
const assert = require("node:assert/strict");
const { employerContact, validateEmployerIdentityInput } = require("../employee-identity");

test("an employer matter reports what is missing; other cases have no employer contact", () => {
  const matter = { caseRole: "principal", caseStructure: "employer_employee" };
  assert.deepEqual(employerContact({ ...matter, clientName: "Acme", clientEmail: "" }), { name: "Acme", email: "", missingName: false, missingEmail: true, complete: false });
  assert.deepEqual(employerContact({ ...matter, clientName: "", clientEmail: "Hr@Acme.com" }), { name: "", email: "hr@acme.com", missingName: true, missingEmail: false, complete: false });
  assert.equal(employerContact({ ...matter, clientName: "Acme", clientEmail: "hr@acme.com" }).complete, true);
  assert.equal(employerContact({ caseRole: "employee", caseStructure: "employer_employee" }), null);
  assert.equal(employerContact({ caseRole: "single", caseStructure: "single" }), null);
});

test("employer identity input: valid email, not an employee's, something to save", () => {
  assert.deepEqual(validateEmployerIdentityInput({ name: "  Bhog   LLC ", email: "Nimma@Bhognj.com" }), { identity: { name: "Bhog LLC", email: "nimma@bhognj.com" } });
  assert.match(validateEmployerIdentityInput({ email: "nope" }).message, /valid email/);
  assert.match(validateEmployerIdentityInput({ email: "e@x.com" }, { employeeEmails: ["E@x.com"] }).message, /employee/);
  assert.match(validateEmployerIdentityInput({}).message, /name or email/);
});
