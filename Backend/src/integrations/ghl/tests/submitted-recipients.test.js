// Who gets the "case submitted" e-mail when the team chooses to send it (2026-11-13). DB-free: every model and the mail service are stubbed.
//   single / family case                                  -> the client (unchanged)
//   employee case, EMPLOYER-FILLED                         -> the employer only
//   employee invited, ACTIVE login (password set)          -> the employee AND the employer
//   employee invited, login NOT active yet                 -> the employer is e-mailed now; only the employee's copy waits in the queue
const test = require("node:test");
const assert = require("node:assert/strict");

const calls = { emails: [], queued: [], waitingUpdates: [] };
const state = { cases: {}, users: {}, submittedLog: null, numberLog: null, waitingModified: 0 };
const stub = (path, exports) => { const resolved = require.resolve(path); require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports }; };
const chain = (valueFn) => ({ select: () => chain(valueFn), lean: async () => valueFn(), then: (resolve) => resolve(valueFn()) });

stub("../../../models/Case", { findById: (id) => chain(() => (state.cases[String(id)] ? { ...state.cases[String(id)], save: async () => {} } : null)), updateOne: async () => ({}) });
stub("../../../models/User", { findById: (id) => chain(() => state.users[String(id)] || null) });
stub("../../../models/EmailLog", { findOne: (query) => chain(() => (query.templateKey === "case-fedex-number-client" || query.templateKey === "case-uscis-receipt-number-client" ? state.numberLog : state.submittedLog)) });
stub("../../../models/DeferredEmail", { updateMany: async (filter, update) => { calls.waitingUpdates.push({ filter, update }); return { modifiedCount: state.waitingModified }; } });
stub("../../../modules/email/email.service", { sendTemplateEmail: async (template, payload) => { calls.emails.push({ template, payload }); return { sent: true }; } });
stub("../../../modules/email/deferredEmail.service", { enqueue: async (args) => { calls.queued.push(args); return { queued: true }; } });
stub("../../../modules/cases/case.service", { addTimelineEvent: () => {} });

const { sendOnTeamChoice, sendFedexNumberNotice, recipientsFor } = require("../ghlSubmittedNotice");

const user = (id, name, extra = {}) => ({ _id: id, name, email: `${id}@acmeclients.com`, role: "client", isActive: true, password: "hash", ...extra });
const employeeCase = (extra = {}) => ({ _id: "c1", caseNumber: "B9-A", clientName: "Ravi Kumar", caseRole: "employee", parentCase: "p1", user: "employer1", integrations: { ghl: { unifiedStageKey: "submitted_fedex", role: "employee" } }, timeline: [], ...extra });

test.beforeEach(() => {
  calls.emails.length = 0; calls.queued.length = 0; calls.waitingUpdates.length = 0;
  Object.assign(state, { submittedLog: null, numberLog: null, waitingModified: 0 });
  state.cases = { p1: { _id: "p1", user: "employer1", clientName: "Acme Inc", caseStructure: "employer_employee", caseRole: "principal" }, c1: employeeCase() };
  state.users = { employer1: user("employer1", "Acme Inc"), employee1: user("employee1", "Ravi Kumar", { role: "employee" }) };
});

const send = (method) => sendOnTeamChoice({ caseId: "c1", send: true, user: { _id: "m1" }, method });
const recipientsOf = () => calls.emails.map((email) => email.payload.to).sort();

test("an EMPLOYER-FILLED employee case (nobody invited) goes to the employer only, naming the employee", async () => {
  const result = await send();
  assert.equal(result.sent, true);
  assert.deepEqual(recipientsOf(), ["employer1@acmeclients.com"]);
  const data = calls.emails[0].payload.data;
  assert.equal(data.clientName, "Acme Inc", "the greeting names the employer");
  assert.equal(data.beneficiaryName, "Ravi Kumar", "and the e-mail says whose case it is");
  const template = require("../../../modules/email/templates/case-submitted-client");
  assert.ok(template.bodyLines(data).join(" ").includes("The case for <strong>Ravi Kumar</strong> has been submitted"));
});

test("an invited employee WITH an active login: the employee AND the employer both get it; the employee's copy is the original wording", async () => {
  state.cases.c1 = employeeCase({ employeeUser: "employee1" });
  const result = await send("online");
  assert.equal(result.sent, true);
  assert.deepEqual(recipientsOf(), ["employee1@acmeclients.com", "employer1@acmeclients.com"]);
  assert.ok(calls.emails.every((email) => email.template === "case-submitted-online-client"));
  const employee = calls.emails.find((email) => email.payload.to.startsWith("employee1")).payload.data;
  const employer = calls.emails.find((email) => email.payload.to.startsWith("employer1")).payload.data;
  assert.equal(employee.beneficiaryName, undefined);
  assert.equal(employer.beneficiaryName, "Ravi Kumar");
  assert.equal(employee.clientName, "Ravi Kumar");
  assert.equal(employer.clientName, "Acme Inc");
});

test("an invited employee whose login is NOT active yet: the employer is e-mailed now; only the employee's copy waits in the queue", async () => {
  state.cases.c1 = employeeCase({ employeeUser: "employee1" });
  state.users.employee1 = user("employee1", "Ravi Kumar", { role: "employee", password: undefined });
  const result = await send();
  assert.deepEqual([result.sent, result.queued, result.reason], [true, true, "employee_queued_until_activation"]);
  assert.deepEqual(recipientsOf(), ["employer1@acmeclients.com"]);
  assert.equal(calls.queued.length, 1);
  assert.equal(String(calls.queued[0].user._id), "employee1", "released by the EMPLOYEE's activation");
  assert.equal(calls.queued[0].to, "employee1@acmeclients.com");
  assert.equal(calls.queued[0].templateKey, "case-submitted-client");
});

test("an employee case taken over by the employee's own account (its user is not the employer's) behaves as invited + active", async () => {
  state.cases.c1 = employeeCase({ user: "employee1" });
  await send();
  assert.deepEqual(recipientsOf(), ["employee1@acmeclients.com", "employer1@acmeclients.com"]);
});

test("a single or family case is unchanged (the client only); an employer matter sends nothing; a deactivated employer is skipped", async () => {
  state.cases.c1 = { _id: "c1", caseNumber: "B1", clientName: "Asha", caseRole: "single", user: "client1", integrations: { ghl: { unifiedStageKey: "submitted_fedex" } }, timeline: [] };
  state.users.client1 = user("client1", "Asha");
  await send();
  assert.deepEqual(recipientsOf(), ["client1@acmeclients.com"]);
  assert.equal(calls.emails[0].payload.data.beneficiaryName, undefined);

  calls.emails.length = 0;
  state.cases.c1 = { ...state.cases.p1, _id: "c1", integrations: { ghl: { unifiedStageKey: "submitted_fedex" } }, timeline: [] };
  assert.equal((await send()).reason, "employer_matter");

  state.cases.c1 = employeeCase();
  state.users.employer1 = user("employer1", "Acme Inc", { isActive: false });
  assert.equal((await send()).reason, "no_client_login", "nobody to send to");
  assert.equal(calls.emails.length, 0);
});

test("the FedEx number added later goes to the employer and the ACTIVE employee; an inactive employee is skipped; a number added while the e-mail is still waiting goes into the waiting e-mail", async () => {
  state.cases.c1 = employeeCase({ employeeUser: "employee1" });
  state.submittedLog = { _id: "log1" }; // the submitted e-mail was sent
  await sendFedexNumberNotice({ caseId: "c1", trackingNumber: "794644790138", previous: "", user: { _id: "m1" } });
  assert.deepEqual(recipientsOf(), ["employee1@acmeclients.com", "employer1@acmeclients.com"]);

  calls.emails.length = 0;
  state.users.employee1 = user("employee1", "Ravi Kumar", { role: "employee", password: undefined });
  await sendFedexNumberNotice({ caseId: "c1", trackingNumber: "794644790999", previous: "", user: { _id: "m1" } });
  assert.deepEqual(recipientsOf(), ["employer1@acmeclients.com"], "the inactive employee waits for their own copy");

  calls.emails.length = 0;
  state.submittedLog = null; // still in the queue, not sent
  state.waitingModified = 2;
  const result = await sendFedexNumberNotice({ caseId: "c1", trackingNumber: "794644790555", previous: "", user: { _id: "m1" } });
  assert.equal(result.reason, "queued_email_updated");
  assert.equal(calls.emails.length, 0);
  assert.equal(calls.waitingUpdates.at(-1).update.$set["data.trackingNumber"], "794644790555");
});

test("recipientsFor: employer-filled -> employer; invited active -> both, not waiting; invited inactive -> both listed, waiting on the employee", async () => {
  assert.deepEqual((await recipientsFor(employeeCase())).recipients.map((r) => r.kind), ["employer"]);
  const active = await recipientsFor(employeeCase({ employeeUser: "employee1" }));
  assert.deepEqual([active.recipients.map((r) => r.kind), active.waitingOn], [["employee", "employer"], null]);
  state.users.employee1 = user("employee1", "Ravi Kumar", { role: "employee", password: undefined });
  const waiting = await recipientsFor(employeeCase({ employeeUser: "employee1" }));
  assert.equal(String(waiting.waitingOn._id), "employee1");
});
