const assert = require("node:assert/strict");
const { test, mock, afterEach } = require("node:test");

const Case = require("../../../models/Case");
const caseService = require("../case.service");
const caseController = require("../case.controller");
const intakeController = require("../../client-intake/client-intake.controller");
const intakeService = require("../../client-intake/client-intake.service");

// The case page / Cases list read only what their screens use (over a remote database every byte costs time). Everything below is
// mock-based: no database connection is opened.
afterEach(() => { mock.restoreAll(); delete process.env.CASE_LIST_SLIM; });

function fakeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

test("Cases list: the slim stage trims the bulky fields and keeps exactly what summarizeCase reads", () => {
  const stage = caseService.caseListSlimStage();
  const set = stage.$set;
  ["canonicalHistory", "auditHistory", "knowledgePlan", "questionnaireData"].forEach((field) => assert.equal(set[field], "$$REMOVE", field));
  // canonicalProfile keeps only what summarizeCase reads, timeline keeps the last 5 (recentActivity = timeline.slice(-5))
  assert.deepEqual(Object.keys(set.canonicalProfile.$cond[1]).sort(), ["conflicts", "missingFields"]);
  assert.deepEqual(set.timeline.$cond[1], { $slice: ["$timeline", -5] });
  // nothing summarizeCase / the list screens use is touched
  ["documentChecklist", "checklistItems", "journeyProgress", "taskReferences", "plan", "stage", "status", "uscisFormReferences", "internalNotes"].forEach((field) => assert.ok(!(field in set), `${field} must stay`));
});

test("Cases list: CASE_LIST_SLIM=false restores the untrimmed list", () => {
  process.env.CASE_LIST_SLIM = "false";
  assert.equal(caseService.caseListSlimStage(), null);
  process.env.CASE_LIST_SLIM = "true";
  assert.ok(caseService.caseListSlimStage());
});

test("Cases list: summarizeCase gives the same summary for a trimmed document as for the full one", () => {
  const full = {
    _id: "c1", caseNumber: "B1", clientName: "Ana", visaType: "H-1B", stage: "intake", status: "active", updatedAt: new Date(0), createdAt: new Date(0),
    documentChecklist: [{ name: "Passport", status: "pending", required: true }], journeyProgress: { percent: 40, nextAction: "Upload" },
    canonicalProfile: { profile: { huge: "x".repeat(1000) }, missingFields: ["a.b"], conflicts: [{ resolved: false, path: "p" }] },
    canonicalHistory: [{ big: "x".repeat(1000) }], auditHistory: [{ a: 1 }], knowledgePlan: { rules: [1, 2] }, questionnaireData: { q: 1 },
    timeline: Array.from({ length: 12 }, (_, index) => ({ title: `e${index}` })),
  };
  const slim = { ...full, canonicalProfile: { missingFields: full.canonicalProfile.missingFields, conflicts: full.canonicalProfile.conflicts }, timeline: full.timeline.slice(-5) };
  delete slim.canonicalHistory; delete slim.auditHistory; delete slim.knowledgePlan; delete slim.questionnaireData;
  assert.deepEqual(caseService.summarizeCase(slim), caseService.summarizeCase(full));
});

// A chainable stand-in for Case.findOne(...).select(...).populate(...)
function stubFindOne(doc) {
  const calls = { select: [] };
  const query = { select(arg) { calls.select.push(arg); return query; }, populate() { return query; }, then(resolve, reject) { return Promise.resolve(doc).then(resolve, reject); } };
  mock.method(Case, "findOne", () => query);
  return calls;
}

test("getAccessibleCaseOrThrow: without `omit` nothing is excluded (every existing caller gets the same document)", async () => {
  const calls = stubFindOne({ _id: "c1", user: "u1" });
  await caseService.getAccessibleCaseOrThrow("c1", { _id: "u1", role: "admin" });
  assert.deepEqual(calls.select, []);
});

test("getAccessibleCaseOrThrow: `omit` excludes exactly the named fields and still enforces access", async () => {
  const calls = stubFindOne({ _id: "c1", user: "u1" });
  await caseService.getAccessibleCaseOrThrow("c1", { _id: "u1", role: "admin" }, { omit: caseService.CASE_OMIT_HISTORY });
  assert.deepEqual(calls.select, ["-canonicalHistory"]);
  stubFindOne({ _id: "c2", user: "someone-else" });
  mock.restoreAll();
  stubFindOne({ _id: "c2", user: "someone-else" });
  await assert.rejects(() => caseService.getAccessibleCaseOrThrow("c2", { _id: "u9", role: "client" }, { omit: caseService.CASE_OMIT_LOOKUP }), (error) => error.statusCode === 403);
  assert.ok(caseService.CASE_OMIT_LOOKUP.includes("canonicalProfile") && caseService.CASE_OMIT_HISTORY.length === 1);
});

test("GET /cases/:id/related?scope=children returns only the child links and never loads the other related records", async () => {
  const lookup = { _id: "p1" };
  const access = mock.method(caseService, "getAccessibleCaseOrThrow", async () => lookup);
  const links = mock.method(caseService, "getCaseLinks", async () => ({ parentCase: null, childCases: [{ _id: "k1", inviteStatus: "none" }] }));
  const related = mock.method(caseService, "getRelatedRecords", async () => { throw new Error("must not be called"); });
  const res = fakeRes();
  await caseController.getRelated({ params: { id: "p1" }, query: { scope: "children" }, user: { _id: "u1", role: "client" } }, res, (error) => { throw error; });
  assert.deepEqual(res.body, { success: true, parentCase: null, childCases: [{ _id: "k1", inviteStatus: "none" }] });
  assert.equal(related.mock.callCount(), 0);
  assert.deepEqual(access.mock.calls[0].arguments[2], { omit: caseService.CASE_OMIT_LOOKUP }, "the access check still runs, on a lean read");
  assert.equal(links.mock.callCount(), 1);
});

test("…children scope keeps the restricted-role rule: employees/beneficiaries see no child cases", async () => {
  mock.method(caseService, "getAccessibleCaseOrThrow", async () => ({ _id: "p1" }));
  mock.method(caseService, "getCaseLinks", async () => { throw new Error("must not be called"); });
  const res = fakeRes();
  await caseController.getRelated({ params: { id: "p1" }, query: { scope: "children" }, user: { _id: "e1", role: "employee" } }, res, (error) => { throw error; });
  assert.deepEqual(res.body, { success: true, parentCase: null, childCases: [] });
});

test("…without the scope the full related-records response is unchanged", async () => {
  mock.method(caseService, "getAccessibleCaseOrThrow", async () => ({ _id: "p1" }));
  const related = mock.method(caseService, "getRelatedRecords", async () => ({ documents: [1], childCases: [{ _id: "k1" }] }));
  const res = fakeRes();
  await caseController.getRelated({ params: { id: "p1" }, query: {}, user: { _id: "u1", role: "admin" } }, res, (error) => { throw error; });
  assert.equal(related.mock.callCount(), 1);
  assert.deepEqual(res.body.documents, [1]);
  assert.equal(res.body.success, true);
});

test("GET /client-intake/cases/:id?view=client returns only the client profile; without it the full bundle is unchanged", async () => {
  const lean = mock.method(intakeService, "getCaseIntakeClient", async () => ({ client: { fullName: "Ana" } }));
  const full = mock.method(intakeService, "getCaseIntake", async () => ({ client: { fullName: "Ana" }, case: {}, documents: [] }));
  const res1 = fakeRes();
  await intakeController.getCaseIntake({ params: { caseId: "c1" }, query: { view: "client" }, user: {} }, res1, (error) => { throw error; });
  assert.deepEqual(res1.body, { success: true, intake: { client: { fullName: "Ana" } } });
  assert.equal(full.mock.callCount(), 0);
  const res2 = fakeRes();
  await intakeController.getCaseIntake({ params: { caseId: "c1" }, query: {}, user: {} }, res2, (error) => { throw error; });
  assert.deepEqual(Object.keys(res2.body.intake).sort(), ["case", "client", "documents"]);
  assert.equal(lean.mock.callCount(), 1);
});
