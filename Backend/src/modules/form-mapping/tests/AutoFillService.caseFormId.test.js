// Phase 7.1: generate() can be told exactly which case form to use (migration must never regenerate another participant's form of the same code). DB-free: the
// CaseForm model is stubbed. Without the option the lookup is the one it always was.
const assert = require("node:assert/strict");
const test = require("node:test");
const CaseForm = require("../../../models/CaseForm");
const AutoFillService = require("../services/AutoFillService");

const stop = new Error("stop here");
const form = (overrides = {}) => ({ _id: "cf1", caseId: "case1", formCode: "I-129", ...overrides });

test("findCaseFormById returns the form when it belongs to the case and the form code", async (t) => {
  t.mock.method(CaseForm, "findById", async () => form());
  const found = await AutoFillService.findCaseFormById("case1", "i-129", "cf1");
  assert.equal(found._id, "cf1");
});

test("a missing case form is a 404, another case's form or another form code is a 409", async (t) => {
  const stub = t.mock.method(CaseForm, "findById", async () => null);
  await assert.rejects(() => AutoFillService.findCaseFormById("case1", "I-129", "nope"), { status: 404, code: "CASE_FORM_NOT_FOUND" });
  stub.mock.mockImplementation(async () => form({ caseId: "case2" }));
  await assert.rejects(() => AutoFillService.findCaseFormById("case1", "I-129", "cf1"), { status: 409, code: "CASE_FORM_MISMATCH" });
  stub.mock.mockImplementation(async () => form({ formCode: "I-907" }));
  await assert.rejects(() => AutoFillService.findCaseFormById("case1", "I-129", "cf1"), { status: 409, code: "CASE_FORM_MISMATCH" });
});

test("generate() with caseFormId loads that exact form and never the newest one", async (t) => {
  const byId = t.mock.method(AutoFillService, "findCaseFormById", async () => { throw stop; });
  const newest = t.mock.method(AutoFillService, "findCaseForm", async () => { throw new Error("must not be used"); });
  await assert.rejects(() => AutoFillService.generate("case1", "I-129", {}, {}, { caseFormId: "cf1" }), (error) => error === stop);
  assert.equal(byId.mock.callCount(), 1);
  assert.deepEqual(byId.mock.calls[0].arguments, ["case1", "I-129", "cf1"]);
  assert.equal(newest.mock.callCount(), 0);
});

test("generate() without caseFormId keeps the original lookup (newest form of the case and code)", async (t) => {
  const byId = t.mock.method(AutoFillService, "findCaseFormById", async () => { throw new Error("must not be used"); });
  const newest = t.mock.method(AutoFillService, "findCaseForm", async () => { throw stop; });
  await assert.rejects(() => AutoFillService.generate("case1", "I-129", {}, {}, {}), (error) => error === stop);
  assert.equal(newest.mock.callCount(), 1);
  assert.equal(byId.mock.callCount(), 0);
});
