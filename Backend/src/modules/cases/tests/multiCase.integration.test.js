// One login, many cases - Phase 4: the REAL creation / switching / copying / deletion code for ONE person with several cases, against the dedicated LOCAL test
// database (test-utils/db.js: immigrationcrm_test). Never the application's own database: the first test refuses to run anywhere else. Nothing external is
// reachable (GoHighLevel off, e-mail suppressed, local file storage, no malware scanner command). Everything it creates is removed at the end.
//
//   node src/scripts/runSafeTests.js --include-local-db multiCase.integration
process.env.STORAGE_PROVIDER = "local";
process.env.GHL_ENABLED = "false";
process.env.EMAIL_SUPPRESS_ALL = "true";
process.env.NOTIFICATIONS_SUPPRESS_ALL = "true";
delete process.env.MALWARE_SCANNER_COMMAND;
// no outbound request leaves this machine (the form-download step of case setup uses the global fetch); localhost only
const realFetch = global.fetch;
global.fetch = async (url, ...rest) => {
  const target = String((url && url.url) || url);
  if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(target)) return realFetch(url, ...rest);
  throw new Error(`outbound request blocked in this test: ${target}`);
};

const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const Case = require("../../../models/Case");
const User = require("../../../models/User");
const Answer = require("../../../models/Answer");
const caseCtrl = require("../case.controller");
const filingCtrl = require("../../single-party-filings/single-party-filing.controller");
const caseLinks = require("../caseLinks.service");
const qs = require("../../questionnaires/questionnaire.service");
const storage = require("../../uploads/storage.service");
const { applyActiveCaseRole } = require("../../../middleware/activeCaseRole");
const { hasPermission } = require("../../authorization/rbac.service");

const STAMP = Date.now();
const email = (name) => `${name}-${STAMP}@example.com`; // example.com: the e-mail policy never delivers to it
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mockRes = () => { const res = { statusCode: 200, body: undefined, headers: {} }; res.status = (code) => { res.statusCode = code; return res; }; res.json = (body) => { res.body = body; return res; }; res.setHeader = () => res; return res; };
async function call(handler, req) {
  const res = mockRes();
  let error = null;
  await handler({ ip: "127.0.0.1", headers: {}, query: {}, params: {}, body: {}, requestId: "t", ...req }, res, (e) => { error = e; });
  if (error) throw error;
  return res;
}
async function waitFor(check, { timeoutMs = 90000, everyMs = 500 } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > timeoutMs) return null;
    await sleep(everyMs);
  }
}

const created = { users: [], cases: [] };
let staff; let client; let caseA; let caseB; let caseC;
const personEmail = email("maria");

test.before(async () => {
  await connectTestDB();
  staff = await User.create({ email: email("lead"), name: "Test Lead", role: "team_lead", isActive: true });
  created.users.push(staff._id);
});

test("safety: this test only ever runs on the local test database", () => {
  assert.equal(mongoose.connection.name, "immigrationcrm_test");
  assert.match(String(mongoose.connection.host), /^(localhost|127\.0\.0\.1)$/);
});

test("CASE A (H-4 EAD, single-party filing): a new person gets a login with a set-password invitation, and the case is the CLIENT's", async () => {
  const res = await call(filingCtrl.createFiling, { user: staff, body: { filingTypeKey: "H4_EAD", clientName: "Maria Silva", clientEmail: personEmail, legacySource: "Admin" } });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body).slice(0, 300));
  caseA = res.body.case;
  created.cases.push(caseA._id);
  client = await User.findOne({ email: personEmail }).select("+inviteTokenHash");
  assert.ok(client, "the client login was created");
  created.users.push(client._id);
  assert.equal(String(caseA.user), String(client._id), "the case belongs to the client, not the staff member");
  assert.equal(client.isActive, false);
  assert.equal(client.mustSetPassword, true);
  assert.ok(client.inviteTokenHash, "a new person gets the set-password invitation");
  assert.equal(String(client.primaryCaseId), String(caseA._id));
  assert.equal(client.caseIds.length, 1);
});

test("the person activates (password set) and fills case A: typed answers and one document", async () => {
  await User.updateOne({ _id: client._id }, { $set: { password: "$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234", isActive: true, mustSetPassword: false, isEmailVerified: true }, $unset: { inviteTokenHash: "", inviteTokenExpiresAt: "" } });
  client = await User.findById(client._id);
  const bundle = await qs.getQuestionnaireForCase(caseA._id, staff, "client");
  assert.ok(bundle?.questionnaire, "case A has its checklist");
  const keys = new Set([...(bundle.questions || []), ...(bundle.hiddenQuestions || [])].map((question) => question.key));
  const answers = [
    ["client_familyName", "Silva"], ["client_givenName", "Maria"], ["client_dateOfBirth", "1990-03-25"], ["client_aNumber", "A123456789"],
    ["client_passportNumber", "P7654321"], ["client_countryOfPassportIssuance", "Brazil"], ["client_usMailingAddress", "12 Main St"], ["client_gender", "Female"],
  ].filter(([key]) => keys.has(key)).map(([questionKey, value]) => ({ questionKey, value }));
  assert.ok(answers.length >= 6, `the checklist has the expected questions (found ${answers.length})`);
  await qs.saveAnswers({ caseId: caseA._id, questionnaireId: bundle.questionnaire._id, targetRole: "client", responseId: bundle.responseId, answers }, staff, null);
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  await qs.saveFileAnswer({ caseId: caseA._id, questionnaireId: bundle.questionnaire._id, targetRole: "client", responseId: bundle.responseId, questionKey: "h4ead_doc_driversLicenseOrStateId" }, [{ originalname: "license.pdf", buffer: pdf, size: pdf.length, mimetype: "application/pdf" }], staff, null);
  const stored = await Answer.find({ responseId: bundle.responseId }).lean();
  assert.ok(stored.find((answer) => answer.questionKey === "client_dateOfBirth"));
  assert.equal(stored.find((answer) => answer.questionKey === "h4ead_doc_driversLicenseOrStateId")?.files?.length, 1);
});

test("CASE B (I-765 EAD, same person): added to the SAME login - no set-password link, earlier case untouched, answers + document pre-filled with the case's OWN copy", async () => {
  const before = await User.findById(client._id).select("+password +inviteTokenHash");
  const res = await call(filingCtrl.createFiling, { user: staff, body: { filingTypeKey: "I765_EAD", clientName: "Maria Silva", clientEmail: personEmail, legacySource: "Admin" } });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body).slice(0, 300));
  caseB = res.body.case;
  created.cases.push(caseB._id);
  assert.equal(await User.countDocuments({ email: personEmail }), 1, "still ONE login for this e-mail");
  const after = await User.findById(client._id).select("+password +inviteTokenHash");
  assert.equal(after.inviteTokenHash, undefined, "NO new set-password link for a returning person");
  assert.equal(after.mustSetPassword, false);
  assert.equal(after.isActive, true, "never made inactive");
  assert.equal(after.password, before.password, "the password is untouched");
  assert.equal(String(after.primaryCaseId), String(caseA._id), "the landing case stays case A");
  assert.deepEqual(after.caseIds.map(String), [String(caseA._id), String(caseB._id)], "earlier case first, new case appended");
  assert.equal(String(caseB.user), String(client._id));

  // the background pre-fill (answers + documents) is done when case B carries the audit marker
  const bundleB = await qs.getQuestionnaireForCase(caseB._id, staff, "client");
  const copied = await waitFor(async () => {
    const rows = await Answer.find({ responseId: bundleB.responseId, "auditHistory.action": "prefilled_from_earlier_case" }).lean();
    return rows.length >= 6 ? rows : null;
  });
  assert.ok(copied, "case B was pre-filled from case A");
  const byKey = new Map((await Answer.find({ responseId: bundleB.responseId }).lean()).map((answer) => [answer.questionKey, answer]));
  assert.equal(byKey.get("client_familyName")?.value, "Silva");
  assert.equal(byKey.get("client_givenName")?.value, "Maria");
  assert.equal(byKey.get("client_dateOfBirth")?.value, "1990-03-25", "date normalized");
  assert.equal(byKey.get("client_aNumber")?.value, "A123456789");
  const last = byKey.get("client_familyName").auditHistory.at(-1);
  assert.equal(last.action, "prefilled_from_earlier_case");
  assert.equal(String(last.changes.sourceCaseId), String(caseA._id), "marked with its source case");

  // the document: B has its OWN copy (different stored object, same bytes); A's file is untouched
  const doc = await waitFor(async () => {
    const answer = await Answer.findOne({ responseId: bundleB.responseId, questionKey: "h4ead_doc_driversLicenseOrStateId" }).lean();
    return answer?.files?.length ? answer : null;
  });
  assert.ok(doc, "the driver's license was copied into case B");
  const bundleA = await qs.getQuestionnaireForCase(caseA._id, staff, "client");
  const docA = await Answer.findOne({ responseId: bundleA.responseId, questionKey: "h4ead_doc_driversLicenseOrStateId" }).lean();
  assert.notEqual(doc.files[0].storageKey, docA.files[0].storageKey, "its own stored copy, never the other case's object");
  assert.deepEqual(await storage.readBuffer(doc.files[0].storageKey), await storage.readBuffer(docA.files[0].storageKey), "same content");
  await sleep(1500); // let the background canonical sync of the saves settle
});

test("typed answers already given in the NEW case are never overwritten by a later copy", async () => {
  const bundleB = await qs.getQuestionnaireForCase(caseB._id, staff, "client");
  await qs.saveAnswers({ caseId: caseB._id, questionnaireId: bundleB.questionnaire._id, targetRole: "client", responseId: bundleB.responseId, answers: [{ questionKey: "client_givenName", value: "Mariana" }] }, staff, null);
  const prefill = require("../personPrefill.service");
  const again = await prefill.prefillPersonFromEarlierCases(caseB._id, client._id, { targetRole: "client" });
  assert.ok(again.answers.status === "nothing_to_fill" || again.answers.status === "nothing_to_copy" || again.answers.status === "prefilled");
  const given = await Answer.findOne({ responseId: bundleB.responseId, questionKey: "client_givenName" }).lean();
  assert.equal(given.value, "Mariana", "the person's own edit in case B survives");
  const a = await Answer.findOne({ responseId: (await qs.getQuestionnaireForCase(caseA._id, staff, "client")).responseId, questionKey: "client_givenName" }).lean();
  assert.equal(a.value, "Maria", "case A is never written by case B");
});

test("CASE C (staff New case, createCase): the old 'already linked to a case' refusal is gone; same login, no set-password link", async () => {
  const res = await call(caseCtrl.createCase, { user: staff, body: { clientName: "Maria Silva", clientEmail: personEmail, visaType: "Naturalization", creationSource: "admin_direct", childCaseCount: 0 } });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body).slice(0, 400));
  caseC = res.body.case;
  created.cases.push(caseC._id);
  const after = await User.findById(client._id).select("+inviteTokenHash");
  assert.equal(after.inviteTokenHash, undefined);
  assert.equal(after.isActive, true);
  assert.equal(String(after.primaryCaseId), String(caseA._id));
  assert.deepEqual(after.caseIds.map(String), [caseA._id, caseB._id, caseC._id].map(String));
  assert.equal(await User.countDocuments({ email: personEmail }), 1);
  await sleep(4000); // the background case setup of case C (checklists, forms) settles
});

test("the client portal's list and switching: /cases/mine, /cases/my?caseId=, a foreign or stale id falls back, never another person's case", async () => {
  const fresh = await User.findById(client._id);
  const mine = await call(caseCtrl.getMyCases, { user: fresh });
  assert.deepEqual(mine.body.data.cases.map((row) => row._id).sort(), [caseA._id, caseB._id, caseC._id].map(String).sort());
  assert.equal(mine.body.data.defaultCaseId, String(caseA._id));
  for (const [row, label] of [[caseA, "A"], [caseB, "B"], [caseC, "C"]]) {
    const res = await call(caseCtrl.getMyCase, { user: fresh, query: { caseId: String(row._id) } });
    assert.equal(String(res.body._id), String(row._id), `case ${label} opens when selected`);
  }
  const noParam = await call(caseCtrl.getMyCase, { user: fresh });
  assert.equal(String(noParam.body._id), String(caseA._id), "no selection: the landing case, exactly as before");
  const stranger = await User.create({ email: email("stranger"), name: "Stranger", role: "client", isActive: true });
  created.users.push(stranger._id);
  const [other] = await Case.create([{ caseId: `ZZ-${STAMP}`, caseNumber: `ZZ-${STAMP}`, clientName: "Stranger", clientEmail: stranger.email, visaType: "H-4", caseType: "immigration", status: "active", user: stranger._id, caseStructure: "single", caseRole: "single" }]);
  created.cases.push(other._id);
  const foreign = await call(caseCtrl.getMyCase, { user: fresh, query: { caseId: String(other._id) } });
  assert.equal(String(foreign.body._id), String(caseA._id), "someone else's case id never opens - it falls back to the landing case");
  const garbage = await call(caseCtrl.getMyCase, { user: fresh, query: { caseId: "not-an-id" } });
  assert.equal(String(garbage.body._id), String(caseA._id));
});

test("staff screens: the person's other cases and the e-mail lookup", async () => {
  const lookup = await call(caseCtrl.lookupPersonByEmail, { user: staff, query: { email: personEmail } });
  assert.equal(lookup.body.data.cases.length, 3);
  assert.equal(lookup.body.data.person.email, personEmail);
  const others = await call(caseCtrl.getPersonCases, { user: staff, params: { id: String(caseB._id) } });
  assert.equal(others.body.data.length, 1);
  assert.deepEqual(others.body.data[0].cases.map((row) => row._id).sort(), [caseA._id, caseC._id].map(String).sort(), "case B's page lists A and C, not itself");
});

test("'Add to this person's login': an unlinked single case (e.g. a second GHL card) joins the login on request; a case already on a login is refused", async () => {
  const [unlinked] = await Case.create([{ caseId: `GH-${STAMP}`, caseNumber: `GH-${STAMP}`, clientName: "Maria Silva", clientEmail: personEmail, visaType: "H-4", caseType: "immigration", status: "pending_assignment", caseStructure: "single", caseRole: "single", integrations: { ghl: { flags: { needsAttention: true } } } }]);
  created.cases.push(unlinked._id);
  const ok = await call(caseCtrl.attachCaseToLogin, { user: staff, params: { id: String(unlinked._id) } });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  const linked = await Case.findById(unlinked._id).lean();
  assert.equal(String(linked.user), String(client._id));
  const person = await User.findById(client._id).select("+inviteTokenHash");
  assert.ok(person.caseIds.map(String).includes(String(unlinked._id)));
  assert.equal(person.inviteTokenHash, undefined, "no set-password link");
  assert.equal(String(person.primaryCaseId), String(caseA._id));
  const again = await call(caseCtrl.attachCaseToLogin, { user: staff, params: { id: String(unlinked._id) } });
  assert.equal(again.statusCode, 409, "a case already on a login is never moved");
});

test("an employee login with a case of its OWN: acts as a client there (permissions follow), stays an employee on the invited case; the stored role never changes", async () => {
  const eli = await User.create({ email: email("eli"), name: "Eli Employee", role: "employee", isActive: true });
  created.users.push(eli._id);
  const [invited, own] = await Case.create([
    { caseId: `EI-${STAMP}`, caseNumber: `EI-${STAMP}`, clientName: "Eli", clientEmail: eli.email, visaType: "H-1B", caseType: "immigration", status: "active", user: eli._id, employeeUser: eli._id, caseStructure: "employer_employee", caseRole: "employee" },
    { caseId: `EO-${STAMP}`, caseNumber: `EO-${STAMP}`, clientName: "Eli", clientEmail: eli.email, visaType: "H-4", caseType: "immigration", status: "active", user: eli._id, caseStructure: "single", caseRole: "single" },
  ]);
  created.cases.push(invited._id, own._id);
  const asEmployee = await User.findById(eli._id);
  assert.equal(hasPermission(asEmployee, "cases:create"), false, "an employee cannot start cases");
  const onOwn = await User.findById(eli._id);
  assert.equal(await applyActiveCaseRole({ headers: { "x-active-case": String(own._id) } }, onOwn), true);
  assert.equal(onOwn.role, "client");
  assert.equal(hasPermission(onOwn, "cases:create"), true, "on their own case: every client feature");
  const onInvited = await User.findById(eli._id);
  assert.equal(await applyActiveCaseRole({ headers: { "x-active-case": String(invited._id) } }, onInvited), false);
  assert.equal(onInvited.role, "employee", "on the invited case: the employee view");
  assert.equal((await User.findById(eli._id)).role, "employee", "the stored role is never changed");
});

test("deleting cases: the person's login survives while any case remains (incl. as petitioner); the landing case moves to the newest remaining", async () => {
  const deletion = require("../case-deletion.service");
  const fresh = await User.findById(client._id);
  // delete C (not the landing case): login + A + B stay
  await deletion.requestCaseDeletion(await Case.findById(caseC._id), staff, { skipGhl: true, skipRecycleBin: true });
  await waitFor(async () => !(await Case.exists({ _id: caseC._id })), { timeoutMs: 30000 });
  let person = await User.findById(client._id);
  assert.ok(person, "login still exists");
  assert.ok(!person.caseIds.map(String).includes(String(caseC._id)));
  assert.equal(String(person.primaryCaseId), String(caseA._id));
  // delete A (the landing case): the login stays and lands on the newest remaining TOP-LEVEL case
  await deletion.requestCaseDeletion(await Case.findById(caseA._id), staff, { skipGhl: true, skipRecycleBin: true });
  await waitFor(async () => !(await Case.exists({ _id: caseA._id })), { timeoutMs: 30000 });
  person = await User.findById(client._id);
  assert.ok(person, "login still exists after its landing case was deleted");
  assert.ok(person.primaryCaseId, "a landing case was chosen");
  const landing = await Case.findById(person.primaryCaseId).lean();
  assert.ok(landing && !landing.parentCase && landing.status !== "removed", "it is a real remaining case");
  assert.ok([String(caseB._id)].concat((await Case.find({ clientEmail: personEmail }).select("_id").lean()).map((row) => String(row._id))).includes(String(landing._id)));
  const res = await call(caseCtrl.getMyCase, { user: person });
  assert.equal(String(res.body._id), String(person.primaryCaseId));

  // a person who is only the PETITIONER on another case keeps the login when their own single case is deleted
  const petitioner = await User.create({ email: email("pat"), name: "Pat Petitioner", role: "client", isActive: true });
  created.users.push(petitioner._id);
  const beneficiary = await User.create({ email: email("ben"), name: "Ben", role: "client", isActive: true });
  created.users.push(beneficiary._id);
  const [own, family] = await Case.create([
    { caseId: `PS-${STAMP}`, caseNumber: `PS-${STAMP}`, clientName: "Pat", clientEmail: petitioner.email, visaType: "H-4", caseType: "immigration", status: "active", user: petitioner._id, caseStructure: "single", caseRole: "single" },
    { caseId: `PF-${STAMP}`, caseNumber: `PF-${STAMP}`, clientName: "Ben", clientEmail: beneficiary.email, visaType: "F1", caseType: "immigration", status: "active", user: beneficiary._id, petitionerUser: petitioner._id, caseStructure: "family", caseRole: "principal" },
  ]);
  created.cases.push(own._id, family._id);
  await User.updateOne({ _id: petitioner._id }, { $set: { primaryCaseId: own._id, caseIds: [own._id, family._id] } });
  await deletion.requestCaseDeletion(await Case.findById(own._id), staff, { skipGhl: true, skipRecycleBin: true });
  await waitFor(async () => !(await Case.exists({ _id: own._id })), { timeoutMs: 30000 });
  assert.ok(await User.findById(petitioner._id), "the petitioner's login is NOT deleted: they are still the petitioner on another case");
  assert.equal(String((await User.findById(petitioner._id)).primaryCaseId), String(family._id), "and lands on that case");
});

test("EMPLOYER with TWO matters (PERM): the second matter joins the same login; the switcher lists the 2 matters (never their employee cases); the landing case stays a matter, also after the first is deleted", async () => {
  const deletion = require("../case-deletion.service");
  const acme = email("acme");
  const body = (n) => ({ clientName: "Acme Corp", clientEmail: acme, visaType: "PERM", creationSource: "admin_direct", childCaseCount: 1, employees: [{ name: `Worker ${n}`, email: email(`worker${n}`) }] });
  const first = await call(caseCtrl.createCase, { user: staff, body: body(1) });
  assert.equal(first.statusCode, 201, JSON.stringify(first.body).slice(0, 400));
  const matter1 = first.body.principalCase._id;
  created.cases.push(matter1, ...first.body.childCases.map((row) => row._id));
  await User.updateOne({ email: acme }, { $set: { password: "$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234", isActive: true, mustSetPassword: false, isEmailVerified: true }, $unset: { inviteTokenHash: "", inviteTokenExpiresAt: "" } });
  const second = await call(caseCtrl.createCase, { user: staff, body: body(2) });
  assert.equal(second.statusCode, 201, JSON.stringify(second.body).slice(0, 400));
  const matter2 = second.body.principalCase._id;
  const child2 = second.body.childCases.map((row) => row._id);
  created.cases.push(matter2, ...child2);
  assert.equal(await User.countDocuments({ email: acme }), 1);
  let employer = await User.findOne({ email: acme }).select("+inviteTokenHash");
  assert.equal(employer.inviteTokenHash, undefined, "no set-password link for the second matter");
  assert.equal(String(employer.primaryCaseId), String(matter1), "landing case = the first matter");
  assert.ok([matter1, matter2, ...child2].every((id) => employer.caseIds.map(String).includes(String(id))), "both matters and their employee cases are linked");
  const mine = await call(caseCtrl.getMyCases, { user: employer });
  assert.deepEqual(mine.body.data.cases.map((row) => row._id).sort(), [matter1, matter2].map(String).sort(), "two matters in the switcher - the employee cases stay inside their matter");
  assert.ok(mine.body.data.cases.every((row) => row.capacity === "employer"));
  const open2 = await call(caseCtrl.getMyCase, { user: employer, query: { caseId: String(matter2) } });
  assert.equal(String(open2.body._id), String(matter2));
  // delete the first (landing) matter: the login stays and lands on the other MATTER, never on an employee case of it
  await deletion.requestCaseDeletion(await Case.findById(matter1), staff, { skipGhl: true, skipRecycleBin: true });
  await waitFor(async () => !(await Case.exists({ _id: matter1 })), { timeoutMs: 30000 });
  employer = await User.findOne({ email: acme });
  assert.ok(employer, "the employer login survives");
  assert.equal(String(employer.primaryCaseId), String(matter2), "landing case moved to the remaining matter");
  // a login with no landing case at all still opens a MATTER, not the newer employee case
  await User.updateOne({ _id: employer._id }, { $unset: { primaryCaseId: "" } });
  const fallback = await call(caseCtrl.getMyCase, { user: await User.findById(employer._id) });
  assert.equal(String(fallback.body._id), String(matter2), "the fallback prefers the top-level matter over its (newer) employee case");
});

test("FAMILY case for a RETURNING person (petitioner, K-1): joins the same login; the petitioner checklist is pre-filled from the person's earlier case (person.* -> petitioner.*), nothing else", async () => {
  const familyCtrl = require("../../family-workflow/family-workflow.controller");
  const before = await User.findById(client._id);
  const res = await call(familyCtrl.createFamilyCase, { user: staff, body: { visaType: "K-1", pipelineCategory: "immigrant", petitionerName: "Maria Silva", petitionerEmail: personEmail, beneficiaryName: "Joao Souza", beneficiaryEmail: email("joao"), familyCompletionMode: "petitioner_completes" } });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body).slice(0, 500));
  const familyCase = res.body.case || res.body.principalCase;
  const familyId = familyCase._id || familyCase.id;
  created.cases.push(familyId);
  assert.equal(await User.countDocuments({ email: personEmail }), 1, "still one login");
  const after = await User.findById(client._id).select("+inviteTokenHash");
  assert.equal(after.inviteTokenHash, undefined);
  assert.ok(after.caseIds.map(String).includes(String(familyId)));
  assert.equal(String(after.primaryCaseId), String(before.primaryCaseId), "landing case unchanged");
  const bundle = await qs.getQuestionnaireForCase(familyId, staff, "petitioner");
  const copied = await waitFor(async () => {
    const rows = await Answer.find({ responseId: bundle.responseId, "auditHistory.action": "prefilled_from_earlier_case" }).lean();
    return rows.length >= 3 ? rows : null;
  }, { timeoutMs: 120000 });
  assert.ok(copied, "the petitioner checklist was pre-filled from the person's earlier case");
  const questions = new Map([...(bundle.questions || []), ...(bundle.hiddenQuestions || []), ...(bundle.completedQuestions || [])].map((q) => [q.key, q]));
  const filled = (await Answer.find({ responseId: bundle.responseId }).lean()).filter((a) => a.value !== undefined && a.value !== "");
  const paths = filled.map((a) => questions.get(a.questionKey)?.mapping?.canonicalPath || "");
  assert.ok(paths.some((path) => /^(petitioner\.(firstName|lastName|dateOfBirth)|person\.(firstName|lastName|dob))$/.test(path)), `identity facts copied (paths: ${paths.slice(0, 8).join(", ")})`);
  assert.ok(paths.some((path) => /^(person\.(alienNumber|gender)|contact\.address\.line1)$/.test(path)), "A-number / gender / address copied too");
  assert.ok(paths.every((path) => !/^(beneficiary|principalImmigrant)\./.test(path)), "nothing is copied into the beneficiary's side");
  await sleep(1500);
});

test.after(async () => {
  try {
    await sleep(1500); // background work started by the creations
    const people = await User.find({ $or: [{ _id: { $in: created.users } }, { email: { $regex: `-${STAMP}@example\.com$` } }] }).select("_id").lean();
    const personIds = people.map((row) => row._id);
    const byPerson = ["user", "employerUser", "petitionerUser", "beneficiaryUser", "employeeUser", "delegateEmployerUser"].map((field) => ({ [field]: { $in: personIds } }));
    const direct = await Case.find({ $or: [{ _id: { $in: created.cases } }, { clientEmail: { $regex: `-${STAMP}@example\.com$` } }, ...byPerson] }).select("_id").lean();
    const children = await Case.find({ parentCase: { $in: direct.map((row) => row._id) } }).select("_id").lean();
    const allCases = [...direct, ...children];
    const caseIds = [...new Set([...created.cases, ...allCases.map((row) => row._id)].map(String))].map((id) => new mongoose.Types.ObjectId(id));
    const db = mongoose.connection.db;
    // stored files (answers) are deleted from the local storage first
    const answers = await Answer.find({ caseId: { $in: caseIds } }).select("files").lean();
    for (const answer of answers) for (const file of answer.files || []) await storage.deleteObject(file.storageKey).catch(() => false);
    for (const collection of ["answers", "caseforms", "documents", "notifications", "emaillogs", "auditlogs", "conversations", "casedeletionjobs", "employeeprofiles", "employerprofiles", "tasks", "timelineevents"]) {
      await db.collection(collection).deleteMany({ $or: [{ caseId: { $in: caseIds } }, { case: { $in: caseIds } }, { caseIds: { $in: caseIds } }] }).catch(() => null);
    }
    await db.collection("notifications").deleteMany({ userId: { $in: created.users } }).catch(() => null);
    // profiles, beneficiary records and audit entries made along the way (keyed by case / person, not by "caseId")
    await db.collection("employerprofiles").deleteMany({ principalCaseId: { $in: caseIds } }).catch(() => null);
    await db.collection("employeeprofiles").deleteMany({ $or: [{ caseId: { $in: caseIds } }, { principalCaseId: { $in: caseIds } }] }).catch(() => null);
    await db.collection("beneficiaries").deleteMany({ $or: [{ caseIds: { $in: caseIds } }, { user: { $in: personIds } }, { email: { $regex: `-${STAMP}@example\.com$` } }] }).catch(() => null);
    await db.collection("auditlogs").deleteMany({ $or: [{ entityId: { $in: caseIds } }, { userId: { $in: personIds } }] }).catch(() => null);
    await Case.deleteMany({ _id: { $in: caseIds } });
    await User.deleteMany({ $or: [{ _id: { $in: created.users } }, { email: { $regex: `-${STAMP}@example\\.com$` } }] });
  } finally {
    await disconnectTestDB();
  }
});
