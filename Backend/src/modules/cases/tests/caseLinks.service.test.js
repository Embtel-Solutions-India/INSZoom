// One login, many cases (docs/MULTI_CASE_CLIENTS_PLAN.md, Phase 1): the link rules every creation path shares. DB-free.
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const links = require("../caseLinks.service");

const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const C = "cccccccccccccccccccccccc";
const C1 = "c1c1c1c1c1c1c1c1c1c1c1c1";

test("switch: on by default, MULTI_CASE_CLIENTS=false turns it off", () => {
  assert.equal(links.multiCaseClientsEnabled({}), true);
  assert.equal(links.multiCaseClientsEnabled({ MULTI_CASE_CLIENTS: "true" }), true);
  assert.equal(links.multiCaseClientsEnabled({ MULTI_CASE_CLIENTS: "false" }), false);
  assert.equal(links.multiCaseClientsEnabled({ MULTI_CASE_CLIENTS: " FALSE " }), false);
});

test("mergeCaseIds: earlier cases first, each once, nothing dropped", () => {
  assert.deepEqual(links.mergeCaseIds([A, B], [C]), [A, B, C]);
  assert.deepEqual(links.mergeCaseIds([A, B], [B, C, C]), [A, B, C], "a retried request never links twice");
  assert.deepEqual(links.mergeCaseIds([], [A]), [A]);
  assert.deepEqual(links.mergeCaseIds(undefined, [A]), [A]);
  assert.deepEqual(links.mergeCaseIds([{ _id: A }], [A]).length, 1, "a populated id and a bare id are the same case");
});

test("a person with NO case: exactly the old fields (the new case becomes everything)", () => {
  const plan = links.planExistingPersonLinks({ caseIds: [], primaryCaseId: null }, [A, C1], { caseRole: "principal", principalCaseId: null });
  assert.deepEqual(plan, { primaryCaseId: A, caseIds: [A, C1], caseRole: "principal", principalCaseId: null });
});

test("a person WITH cases: the new case is ADDED, the landing case and the person-level role stay as they were", () => {
  const user = { primaryCaseId: A, caseIds: [A, B], caseRole: "single", principalCaseId: null };
  const plan = links.planExistingPersonLinks(user, [C], { caseRole: "principal", principalCaseId: null });
  assert.deepEqual(plan, { primaryCaseId: A, caseIds: [A, B, C] });
  assert.equal("caseRole" in plan, false, "caseRole describes the first case and is not overwritten");
});

test("third, fourth, fifth case: every earlier case stays linked", () => {
  let user = { primaryCaseId: A, caseIds: [A] };
  for (const next of [B, C, "dddddddddddddddddddddddd", "eeeeeeeeeeeeeeeeeeeeeeee"]) user = { ...user, ...links.planExistingPersonLinks(user, [next]) };
  assert.equal(user.caseIds.length, 5);
  assert.equal(user.primaryCaseId, A);
});

test("a person whose landing case was deleted (pruned) but who still has another case gets the new case as landing case only if none is left", () => {
  const plan = links.planExistingPersonLinks({ primaryCaseId: null, caseIds: [B] }, [C]);
  assert.deepEqual(plan, { primaryCaseId: C, caseIds: [B, C] });
});

test("switch off: the old replace behaviour", () => {
  const plan = links.planExistingPersonLinks({ primaryCaseId: A, caseIds: [A] }, [C], { caseRole: "single", principalCaseId: null }, { enabled: false });
  assert.deepEqual(plan, { primaryCaseId: C, caseIds: [C], caseRole: "single", principalCaseId: null });
});

test("capacityOf: how the person is on a case", () => {
  assert.equal(links.capacityOf({ user: A }, A), "client");
  assert.equal(links.capacityOf({ user: A, employerUser: A }, A), "employer");
  assert.equal(links.capacityOf({ user: B, petitionerUser: A }, A), "petitioner");
  assert.equal(links.capacityOf({ user: B, employeeUser: A, parentCase: C }, A), "employee");
});

test("listPersonCases: own matters + a case where they are the employee; an employer's employee child cases are not listed separately; removed cases never", async () => {
  let query = null;
  const rows = [
    { _id: A, user: B, visaType: "H-1B", status: "active", createdAt: new Date("2026-01-01") }, // own case
    { _id: C, user: B, employerUser: B, visaType: "PERM", caseStructure: "employer_employee", createdAt: new Date("2026-02-01") }, // own employer matter
    { _id: C1, user: B, parentCase: C, visaType: "PERM", createdAt: new Date("2026-02-01") }, // child of their own matter -> hidden
    { _id: "ffffffffffffffffffffffff", user: "9".repeat(24), employeeUser: B, parentCase: "8".repeat(24), visaType: "H-1B", createdAt: new Date("2026-03-01") }, // employee elsewhere -> listed
  ];
  const CaseModel = { find: (filter) => { query = filter; return { select: () => ({ sort: () => ({ limit: () => ({ lean: async () => rows }) }) }) }; } };
  const result = await links.listPersonCases(B, { CaseModel });
  assert.deepEqual(result.map((row) => [row._id, row.capacity]), [[A, "client"], [C, "employer"], ["ffffffffffffffffffffffff", "employee"]]);
  assert.deepEqual(query.status, { $ne: "removed" });
  assert.equal(query.$or.length, links.PERSON_FIELDS.length);
  assert.deepEqual(await links.listPersonCases(null, { CaseModel }), []);
});

test("createCase is wired to the shared rules (append, switch, notice) and staff routes exist", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "case.controller.js"), "utf8");
  assert.match(source, /if \(!multiCase && existingHadCase\) \{\s*return res\.status\(409\)/, "the old refusal only when the switch is off");
  assert.match(source, /caseLinks\.planExistingPersonLinks\(/);
  assert.match(source, /clientUser\.caseIds = caseLinks\.mergeCaseIds\(/, "children are appended, earlier cases kept");
  assert.doesNotMatch(source, /clientUser\.caseIds = \[principalCase\._id\];/, "the old overwrite is gone");
  assert.match(source, /caseLinks\.needsSetPasswordInvite\(clientUser, \{ hadCase: multiCase && existingHadCase \}\)/, "a returning person never gets a new set-password link");
  assert.doesNotMatch(source, /A new case was added to your account/, "no second in-app notice: the case_created notification already covers in-app + browser + e-mail");
  const orchestrator = fs.readFileSync(path.join(__dirname, "..", "case-lifecycle-orchestrator.service.js"), "utf8");
  assert.match(orchestrator, /!caseLinks\.hasWorkingLogin\(clientUser\) && !hasOtherCase/, "the login e-mail goes to every returning person");
  const routes = fs.readFileSync(path.join(__dirname, "..", "case.routes.js"), "utf8");
  assert.ok(routes.indexOf('"/people/lookup"') < routes.indexOf('router.get("/:id", '), "lookup route is matched before /:id");
  assert.match(routes, /"\/:id\/person-cases", authenticate, authorizeRoles\(\.\.\.staffRoles\)/);
});

test("returning person: never a new set-password link; a working login (password or Google) is recognised", () => {
  const withPassword = { password: "hash", isActive: true };
  const google = { isActive: true, mustSetPassword: false }; // no password, no invite: signs in with Google
  const pendingInvite = { isActive: false, mustSetPassword: true, inviteTokenHash: "h" };
  const neverInvited = { isActive: false, mustSetPassword: true };
  assert.equal(links.hasWorkingLogin(withPassword), true);
  assert.equal(links.hasWorkingLogin(google), true);
  assert.equal(links.hasWorkingLogin(pendingInvite), false);
  assert.equal(links.hasWorkingLogin(neverInvited), false);
  // second (third ...) case: no set-password link for anyone, whatever their state
  for (const user of [withPassword, google, pendingInvite, neverInvited]) assert.equal(links.needsSetPasswordInvite(user, { hadCase: true }), false);
  // first case: only a person who cannot sign in and has no pending invitation gets a new one (unchanged behaviour)
  assert.equal(links.needsSetPasswordInvite(neverInvited, { hadCase: false }), true);
  assert.equal(links.needsSetPasswordInvite(pendingInvite, { hadCase: false }), false);
  assert.equal(links.needsSetPasswordInvite(withPassword, { hadCase: false }), false);
  assert.equal(links.needsSetPasswordInvite(google, { hadCase: false }), false, "a Google login is never turned into a set-password invitation");
});

test("single-party filings (H-4, EAD, I-765 EAD, change of status ...) belong to the CLIENT, with the same login flow as every other case", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "single-party-filings", "single-party-filing.controller.js"), "utf8");
  assert.doesNotMatch(source, /user: req\.user\._id/, "the staff member is no longer recorded as the case's client");
  assert.match(source, /clientAccount\.attachClientToCase\(\{ caseDoc: caseData, email: clientEmail/);
  assert.match(source, /assignedTo: client\.user\._id/, "the checklist is the client's");
  assert.match(source, /await client\.undo\(\)/, "a failed save puts the person's links back");
  assert.match(source, /setImmediate\(\(\) => clientAccount\.notifyClientOfNewCase\(/, "the client is told after the response");
  const service = fs.readFileSync(path.join(__dirname, "..", "clientAccount.service.js"), "utf8");
  assert.match(service, /caseLinks\.needsSetPasswordInvite\(existing, \{ hadCase: multiCase && hadCase \}\)/, "a returning person never gets a new set-password link");
  assert.match(service, /caseLinks\.planExistingPersonLinks\(/, "append, never replace");
  assert.match(service, /emailTemplate: "client-portal-invitation"/);
  assert.match(service, /emailTemplate: "case-created-client"/);
});

test("GHL second card / any unlinked single-person case: staff add it to the existing client's login with one confirmed click", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "case.controller.js"), "utf8");
  const start = source.indexOf("exports.attachCaseToLogin");
  const body = source.slice(start, start + 4000);
  assert.ok(start > 0);
  assert.match(body, /if \(caseData\.user \|\| caseData\.employerUser \|\| caseData\.petitionerUser\) return res\.status\(409\)/, "a case already on a login is never moved");
  assert.match(body, /CASE_NOT_ATTACHABLE/, "only single-person cases");
  assert.match(body, /attachClientToCase\(\{ caseDoc: caseData, email: caseData\.clientEmail/, "same login rules as every new case");
  assert.match(body, /reasons\.every\(\(reason\) => reason === "Client already has a case"\)/, "the GHL flag is cleared only when that was its only reason");
  assert.match(body, /await client\.undo\(\)/);
  const routes = fs.readFileSync(path.join(__dirname, "..", "case.routes.js"), "utf8");
  assert.match(routes, /"\/:id\/attach-to-login", authenticate, authorizeRoles\(\.\.\.staffRoles\), authorizePermissions\("cases:update"\)/);
  const ghl = fs.readFileSync(path.join(__dirname, "..", "..", "..", "integrations", "ghl", "ghlCaseFactory.js"), "utf8");
  assert.match(ghl, /return \{ action: "none", reason: "Client already has a case" \}/, "GHL itself still never links a second card automatically");
});

test("Phase 2A: the client portal's selected case is honoured only within the person's own cases, never an error", () => {
  assert.equal(links.requestedCaseId(A), A);
  assert.equal(links.requestedCaseId([A, B]), A);
  for (const bad of [undefined, "", "abc", "{$ne:1}", "x".repeat(24)]) assert.equal(links.requestedCaseId(bad), null);
  const cases = fs.readFileSync(path.join(__dirname, "..", "case.controller.js"), "utf8");
  assert.match(cases, /Case\.findOne\(\{ \$and: \[filter, \{ _id: requestedId \}\] \}\)/, "/cases/my: inside the person's own filter");
  assert.match(cases, /Case\.findOne\(\{ \$and: \[filter, \{ _id: requested \}\] \}\)\.select\("integrations\.ghl"\)/, "/cases/my/pipeline: inside the person's own filter");
  assert.match(cases, /if \(!caseData && req\.user\.primaryCaseId\)/, "falls back to the old default");
  const routes = fs.readFileSync(path.join(__dirname, "..", "case.routes.js"), "utf8");
  assert.ok(routes.indexOf('router.get("/mine"') > 0 && routes.indexOf('router.get("/mine"') < routes.indexOf('router.get("/:id", '), "/mine is matched before /:id");
  const intake = fs.readFileSync(path.join(__dirname, "..", "..", "client-intake", "client-intake.service.js"), "utf8");
  assert.match(intake, /assertCaseAccess\(requestedCaseId, user\)\.catch\(\(\) => null\)/, "intake: an inaccessible case falls back, never errors");
  const payments = fs.readFileSync(path.join(__dirname, "..", "..", "payments", "payment.controller.js"), "utf8");
  assert.match(payments, /Case\.findOne\(\{ _id: id, user: req\.user\._id \}\)/, "payments: only the person's own case");
});
