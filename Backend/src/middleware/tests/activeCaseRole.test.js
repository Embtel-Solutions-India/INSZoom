// One login, many cases - Phase 2B: an employee / beneficiary login acts as a client ONLY on a case of its own, checked per request. DB-free.
const assert = require("node:assert/strict");
const test = require("node:test");
const User = require("../../models/User");
const { applyActiveCaseRole, ownsAsClient } = require("../activeCaseRole");

const ME = "aaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "bbbbbbbbbbbbbbbbbbbbbbbb";
const OWN_CASE = "cccccccccccccccccccccccc";
const fakeModel = (row) => ({ findById: () => ({ select: () => ({ lean: async () => row }) }) });
// a LOADED user, as authenticate() has it (findById or the cache's User.hydrate) - not a new, unsaved document
const employee = () => User.hydrate({ _id: ME, email: "eli@x.test", role: "employee", principalCaseId: OTHER, isActive: true });
const req = (caseId) => ({ headers: caseId ? { "x-active-case": caseId } : {} });

test("ownsAsClient: their own case as client / petitioner / employer - never a case where they are the employee / beneficiary, never a removed case", () => {
  assert.equal(ownsAsClient({ user: ME }, ME), true);
  assert.equal(ownsAsClient({ petitionerUser: ME, user: OTHER }, ME), true);
  assert.equal(ownsAsClient({ employerUser: ME }, ME), true);
  assert.equal(ownsAsClient({ user: ME, employeeUser: ME }, ME), false, "their invited (employee) case keeps the restricted role");
  assert.equal(ownsAsClient({ user: OTHER, beneficiaryUser: ME }, ME), false);
  assert.equal(ownsAsClient({ user: OTHER }, ME), false, "someone else's case");
  assert.equal(ownsAsClient({ user: ME, status: "removed" }, ME), false);
  assert.equal(ownsAsClient(null, ME), false);
});

test("on their own case the request acts as a client; the STORED user is untouched (a save cannot write the switch)", async () => {
  const user = employee();
  const switched = await applyActiveCaseRole(req(OWN_CASE), user, { CaseModel: fakeModel({ _id: OWN_CASE, user: ME }) });
  assert.equal(switched, true);
  assert.equal(user.role, "client");
  assert.equal(user.principalCaseId, undefined, "the employee restriction does not apply on their own case");
  assert.equal(user.toObject().role, "employee", "the stored data still says employee");
  assert.equal(user.isModified("role"), false, "nothing is marked to be saved");
  assert.equal(user.isModified("principalCaseId"), false);
  assert.deepEqual(user.modifiedPaths(), [], "a save() would write nothing");
});

test("everything else keeps the stored role exactly as today", async () => {
  for (const [label, request, row] of [
    ["no header", req(null), { user: ME }],
    ["malformed header", req("not-an-id"), { user: ME }],
    ["someone else's case", req(OWN_CASE), { user: OTHER }],
    ["their employee case", req(OWN_CASE), { user: OTHER, employeeUser: ME }],
    ["removed case", req(OWN_CASE), { user: ME, status: "removed" }],
    ["unknown case", req(OWN_CASE), null],
  ]) {
    const user = employee();
    assert.equal(await applyActiveCaseRole(request, user, { CaseModel: fakeModel(row) }), false, label);
    assert.equal(user.role, "employee", label);
  }
  const client = new User({ _id: ME, email: "sam@x.test", role: "client" });
  assert.equal(await applyActiveCaseRole(req(OWN_CASE), client, { CaseModel: fakeModel({ user: ME }) }), false, "a client login is never touched");
  const failing = { findById: () => { throw new Error("db down"); } };
  const user = employee();
  assert.equal(await applyActiveCaseRole(req(OWN_CASE), user, { CaseModel: failing }), false, "a database error never blocks the request");
  assert.equal(user.role, "employee");
});

test("wiring: authenticate applies it, CORS allows the header, case creation lets an employee / beneficiary login hold its own case", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (...p) => fs.readFileSync(path.join(__dirname, "..", "..", ...p), "utf8");
  assert.match(read("middleware", "authenticate.js"), /applyActiveCaseRole\(req, user\);\s*req\.user = user;/);
  assert.match(read("app.js"), /"X-Active-Case"\]/);
  assert.match(read("modules", "cases", "case.controller.js"), /ownCaseForInvitedPerson = existingUser && \["employee", "beneficiary"\]\.includes/);
  assert.match(read("modules", "cases", "clientAccount.service.js"), /invitedPerson = existing && \["employee", "beneficiary"\]\.includes/);
});
