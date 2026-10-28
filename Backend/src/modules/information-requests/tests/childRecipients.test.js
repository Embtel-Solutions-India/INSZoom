// DB-free: who a special request can be sent to. The matter's own case offers the employer AND each employee; an employee's own case offers only that employee;
// a withdrawn employee is never offered; an invited person is addressed by their login, an employer-filled slot by name only.
const assert = require("node:assert/strict");
const test = require("node:test");
const { buildChildRecipients } = require("../information-request.service");
const { VISA_CATEGORIES, getCaseStructure, hasCustomChecklist } = require("../../../config/visaCategories");

const principal = { _id: "p1", user: "employerUser", caseRole: "principal" };
const children = [
  { _id: "c2", caseNumber: "B1-B", caseRole: "employee", childIndex: "B", status: "assigned", user: "employerUser", pendingEmployee: { name: "Bea Two", email: "bea@x.com" } },
  { _id: "c1", caseNumber: "B1-A", caseRole: "employee", childIndex: "A", status: "assigned", user: "empUser1", clientName: "Al One", clientEmail: "al@x.com" },
  { _id: "c3", caseNumber: "B1-C", caseRole: "employee", childIndex: "C", status: "removed", user: "empUser3", clientName: "Gone Three" },
  { _id: "c4", caseNumber: "B1-D", caseRole: "employee", childIndex: "D", status: "assigned", user: "employerUser" },
];

test("every active employee is offered once, in slot order, on their own case", () => {
  const options = buildChildRecipients(principal, children);
  assert.deepEqual(options.map((option) => option.childCaseId), ["c1", "c2", "c4"]);
  assert.ok(options.every((option) => option.id === `c:${option.childCaseId}` && option.role === "employee"));
});

test("a withdrawn employee is not offered", () => {
  assert.equal(buildChildRecipients(principal, children).some((option) => option.childCaseId === "c3"), false);
});

test("an invited employee is addressed by their own login; an employer-filled slot has no login and shows its name or slot number", () => {
  const byId = Object.fromEntries(buildChildRecipients(principal, children).map((option) => [option.childCaseId, option]));
  assert.equal(byId.c1.userId, "empUser1");
  assert.equal(byId.c1.name, "Al One");
  assert.equal(byId.c2.userId, null);
  assert.equal(byId.c2.name, "Bea Two");
  assert.equal(byId.c4.name, "Slot B1-D");
  assert.match(byId.c1.label, /^Employee - Al One \(al@x\.com\)$/);
});

test("an employee's own case offers exactly that employee and nobody else", () => {
  const options = buildChildRecipients(principal, [children[1]]);
  assert.equal(options.length, 1);
  assert.equal(options[0].childCaseId, "c1");
});

test("a beneficiary child case is offered as a beneficiary", () => {
  const options = buildChildRecipients({ user: "pet" }, [{ _id: "b1", caseNumber: "F1-A", caseRole: "beneficiary", status: "assigned", user: "benUser", clientName: "Ben" }]);
  assert.equal(options[0].role, "beneficiary");
  assert.equal(options[0].roleLabel, "Beneficiary");
});

test("RFE, NOIR and NOID are single-party case types with no checklist assigned (the case manager builds it per case)", () => {
  for (const type of ["RFE", "NOIR", "NOID"]) {
    assert.equal(getCaseStructure(type), "single");
    assert.equal(hasCustomChecklist(type), true);
    assert.deepEqual(VISA_CATEGORIES[type].forms, []);
    assert.equal(VISA_CATEGORIES[type].checklists, undefined);
  }
  assert.equal(hasCustomChecklist("H-1B"), false);
});

const { buildRecipients } = require("../information-request.service");

test("one person is listed once: the case owner is not added again as a Client when the same login or e-mail is already listed as the beneficiary", () => {
  const caseData = {
    caseStructure: "family",
    user: "u1",
    clientName: "Ishaan",
    clientEmail: "Ritik@Embtel.com",
    participants: [{ _id: "pt1", role: "beneficiary", name: "Ishaan", email: "ritik@embtel.com", status: "active" }],
  };
  const options = buildRecipients(caseData, {});
  assert.equal(options.length, 1);
  assert.equal(options[0].role, "beneficiary");
});

test("a single-person case still lists its owner as the Client", () => {
  const options = buildRecipients({ caseStructure: "single", user: "u1", clientName: "Jo", clientEmail: "jo@x.com", participants: [] }, {});
  assert.equal(options.length, 1);
  assert.equal(options[0].roleLabel, "Client");
});
