const test = require("node:test");
const assert = require("node:assert/strict");
const Case = require("../../../models/Case");
const { resolveRecipientIds } = require("../premiumProcessingNotice");

const principal = { user: "employer1", delegateEmployerUser: "delegate1" };
const stubPrincipal = (value) => { Case.findById = () => ({ select: () => ({ lean: async () => value }) }); };

test("employer case goes to the employer and the delegate employer", async () => {
  assert.deepEqual(await resolveRecipientIds({ caseRole: "principal", user: "employer1", delegateEmployerUser: "delegate1" }), ["employer1", "delegate1"]);
});

test("single-applicant case goes to its owner only", async () => {
  assert.deepEqual((await resolveRecipientIds({ caseRole: "single", user: "client1" })).filter(Boolean), ["client1"]);
});

test("an invited employee's case goes only to that employee", async () => {
  stubPrincipal(principal);
  assert.deepEqual(await resolveRecipientIds({ caseRole: "employee", user: "employee1", parentCase: "p1" }), ["employee1"]);
});

test("an employee case the employer still holds goes to the employer side", async () => {
  stubPrincipal(principal);
  assert.deepEqual(await resolveRecipientIds({ caseRole: "employee", user: "employer1", parentCase: "p1" }), ["employer1", "delegate1"]);
});
