const test = require("node:test");
const assert = require("node:assert/strict");

const Case = require("../../../models/Case");
const opportunityService = require("../ghlOpportunityService");
const { GHLApiError } = require("../ghlClient");
const deletion = require("../../../modules/cases/case-deletion.service");
const outbound = require("../ghlCaseOutbound");
const deleted = require("../ghlDeletedInGhl");

// ---- stubs (restored after every test) -------------------------------------------------------------------------------------------------
const saved = { find: Case.find, updateOne: Case.updateOne, findById: Case.findById, count: Case.countDocuments, getOpportunity: opportunityService.getOpportunity, request: deletion.requestCaseDeletion };
function stub({ flagged = [], opportunity = async () => ({ id: "O1" }), caseDoc = { _id: "c1", parentCase: null } } = {}) {
  const calls = { updates: [], deletions: [] };
  Case.find = () => ({ select: () => ({ lean: async () => flagged }) });
  Case.updateOne = async (filter, update) => { calls.updates.push({ filter, update }); return {}; };
  Case.findById = async () => caseDoc;
  Case.countDocuments = async () => 1;
  opportunityService.getOpportunity = opportunity;
  deletion.requestCaseDeletion = async (doc, actor, options) => { calls.deletions.push({ doc, options }); return {}; };
  return calls;
}
test.beforeEach(() => { process.env.GHL_DELETE_CASES_REMOVED_IN_GHL = "true"; }); // the deleting is opt-in; these tests exercise it when on
test.afterEach(() => {
  Case.find = saved.find; Case.updateOne = saved.updateOne; Case.findById = saved.findById; Case.countDocuments = saved.count;
  opportunityService.getOpportunity = saved.getOpportunity; deletion.requestCaseDeletion = saved.request;
  delete process.env.GHL_DELETE_CASES_REMOVED_IN_GHL; delete process.env.GHL_DELETE_TOMBSTONE_MS;
});

const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);
const item = (minutesAgo, extra = {}) => ({ _id: "c1", caseNumber: "B1-A", parentCase: extra.parentCase || null, integrations: { ghl: { opportunityId: "O1", flags: { deletedInGhlAt: new Date(NOW - minutesAgo * 60000) } } } });
const gone = async () => { throw new GHLApiError("not found", { status: 404, retryable: false }); };

test("a case is deleted only after its opportunity stays gone for the confirmation delay, through the normal deletion path and WITHOUT queueing a second GHL delete", async () => {
  const calls = stub({ flagged: [item(5)], opportunity: gone });
  const result = await deleted.deleteCasesRemovedInGhl({ now: NOW });
  assert.deepEqual({ checked: result.checked, deleted: result.deleted }, { checked: 1, deleted: 1 });
  assert.equal(calls.deletions.length, 1);
  assert.equal(calls.deletions[0].options.skipGhl, true, "the card is already gone in GHL");
});

test("a case flagged moments ago is NOT checked or deleted yet", async () => {
  const calls = stub({ flagged: [item(0.5)], opportunity: gone });
  const result = await deleted.deleteCasesRemovedInGhl({ now: NOW });
  assert.equal(result.checked, 0);
  assert.equal(calls.deletions.length, 0);
});

test("an opportunity that exists after all clears the flag and the case is kept", async () => {
  const calls = stub({ flagged: [item(10)] });
  const result = await deleted.deleteCasesRemovedInGhl({ now: NOW });
  assert.equal(result.restored, 1);
  assert.equal(calls.deletions.length, 0);
  assert.ok(calls.updates.some((u) => u.update.$set?.["integrations.ghl.flags.deletedInGhl"] === false));
});

test("a GHL error that is not a 404 is never proof of deletion", async () => {
  const calls = stub({ flagged: [item(10)], opportunity: async () => { throw new GHLApiError("server error", { status: 500, retryable: true }); } });
  const result = await deleted.deleteCasesRemovedInGhl({ now: NOW });
  assert.deepEqual({ deleted: result.deleted, errors: result.errors }, { deleted: 0, errors: 1 });
  assert.equal(calls.deletions.length, 0);
});

test("a case flagged by an older version (no timestamp) starts its confirmation delay instead of being deleted at once", async () => {
  const legacy = { _id: "c1", caseNumber: "B1-A", integrations: { ghl: { opportunityId: "O1", flags: {} } } };
  const calls = stub({ flagged: [legacy], opportunity: gone });
  const result = await deleted.deleteCasesRemovedInGhl({ now: NOW });
  assert.equal(result.deleted, 0);
  assert.equal(calls.deletions.length, 0);
  assert.ok(calls.updates.some((u) => u.update.$set?.["integrations.ghl.flags.deletedInGhlAt"]));
});

test("an employee deleted in GHL updates the employer matter's employee count; deleting can be switched off", async () => {
  const calls = stub({ flagged: [item(5, { parentCase: "p1" })], opportunity: gone, caseDoc: { _id: "c1", parentCase: "p1" } });
  await deleted.deleteCasesRemovedInGhl({ now: NOW });
  assert.ok(calls.updates.some((u) => u.filter._id === "p1" && u.update.$set?.childCaseCount === 1));

  process.env.GHL_DELETE_CASES_REMOVED_IN_GHL = "false";
  const off = stub({ flagged: [item(5)], opportunity: gone });
  const result = await deleted.deleteCasesRemovedInGhl({ now: NOW });
  assert.equal(result.deleted, 0);
  assert.equal(off.deletions.length, 0);
});

test("DEFAULT: with the switch unset no case is ever deleted automatically - a real case must never be removed", async () => {
  delete process.env.GHL_DELETE_CASES_REMOVED_IN_GHL;
  assert.equal(deleted.isEnabled(), false);
  const calls = stub({ flagged: [item(60)], opportunity: gone });
  const result = await deleted.deleteCasesRemovedInGhl({ now: NOW });
  assert.deepEqual({ checked: result.checked, deleted: result.deleted }, { checked: 0, deleted: 0 });
  assert.equal(calls.deletions.length, 0);
});

test("the GHL lookup is called with the client itself (or nothing), never an options object - that mistake made every lookup throw and no deletion was ever seen", async () => {
  const seen = [];
  stub({ flagged: [item(5)], opportunity: async (...args) => { seen.push(args); return gone(); } });
  await deleted.deleteCasesRemovedInGhl({ now: NOW });
  assert.deepEqual(seen[0], ["O1"]);
  const fakeClient = { get() {} };
  const seenWithClient = [];
  stub({ flagged: [item(5)], opportunity: async (...args) => { seenWithClient.push(args); return gone(); } });
  await deleted.deleteCasesRemovedInGhl({ now: NOW, client: fakeClient });
  assert.equal(seenWithClient[0][1], fakeClient);
});

test("isReadyToConfirm: needs a timestamp and the delay", () => {
  assert.equal(deleted.isReadyToConfirm(null, NOW), false);
  assert.equal(deleted.isReadyToConfirm(new Date(NOW - 30 * 1000), NOW), false);
  assert.equal(deleted.isReadyToConfirm(new Date(NOW - 3 * 60 * 1000), NOW), true);
});

test("a card deleted in GHL moments ago still counts as 'being deleted' (GHL's list lags), so it cannot be re-imported as a new case", () => {
  const filter = outbound.deletionPendingFilter("O1", NOW);
  assert.equal(filter.opportunityId, "O1");
  const doneBranch = filter.$or.find((branch) => branch.status === "done");
  assert.ok(doneBranch, "a finished delete job still protects the opportunity");
  assert.equal(doneBranch.completedAt.$gte.getTime(), NOW - 30 * 60 * 1000);
  assert.deepEqual(filter.$or.find((branch) => branch.status.$in).status.$in, ["pending", "processing", "failed"]);
});
