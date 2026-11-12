// Sync-health: what an admin sees for a card that is not simply "synced", the health summary, retry-all and the clean-up of stale "failed" marks. DB-free (stubs).
const test = require("node:test");
const assert = require("node:assert/strict");

const rec = { caseUpdateMany: [], jobUpdateMany: [] };
const state = { stuckCases: [], busyJobs: [], failedJobs: [], aliveCases: [], pendingDue: 2 };
const stub = (path, exports) => { const resolved = require.resolve(path); require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports }; };
const chain = (value) => ({ select: () => chain(value), sort: () => chain(value), limit: () => chain(value), lean: async () => value, then: (resolve) => resolve(value) });

stub("../../../models/Case", {
  find: (query) => {
    if (query["integrations.ghl.sync.state"] === "failed") return chain(state.stuckCases);
    if (query._id?.$in) return chain(state.aliveCases);
    return chain([]);
  },
  updateMany: async (filter, update) => { rec.caseUpdateMany.push({ filter, update }); return { modifiedCount: filter._id.$in.length }; },
});
stub("../../../models/GHLSyncJob", {
  find: (query) => chain(query.status === "failed" ? state.failedJobs : state.busyJobs),
  updateMany: async (filter, update) => { rec.jobUpdateMany.push({ filter, update }); return { modifiedCount: filter.status === "pending" ? state.pendingDue : 0 }; },
});
stub("../../../models/GHLIntegration", { findOne: () => chain(null) });
stub("../../../models/GHLWebhookEvent", { countDocuments: async () => 0 });
stub("../ghlOutboundService", { processDueJobs: async () => 0 });

const { describeSync } = require("../ghlSyncState");
const health = require("../ghlHealthService");

test.beforeEach(() => { rec.caseUpdateMany.length = 0; rec.jobUpdateMany.length = 0; Object.assign(state, { stuckCases: [], busyJobs: [], failedJobs: [], aliveCases: [], pendingDue: 2 }); });

test("describeSync: a card in sync says nothing; each stuck state has a clear, admin-readable reason", () => {
  assert.equal(describeSync({ sync: { state: "synced" } }), null);
  assert.equal(describeSync({ sync: { state: "pending" } }), null, "a change in flight with no error is not a problem");
  assert.equal(describeSync({ flags: { deletedInGhl: true } }).kind, "card_deleted");
  assert.equal(describeSync({ sync: { state: "pending", lastError: "The case has no email, so no GHL contact can be created for it" } }).kind, "waiting_email");
  const retrying = describeSync({ sync: { state: "pending" } }, { attempts: 3, lastError: "GHL PUT failed with 503" });
  assert.equal(retrying.kind, "retrying");
  assert.ok(retrying.text.includes("503") && retrying.text.includes("3"));
  assert.equal(describeSync({ sync: { state: "failed", lastError: "boom" } }, { attempts: 8 }).kind, "needs_attention");
  assert.equal(describeSync({ flags: { needsAttention: true }, sync: { state: "synced" } }), null, "needsAttention alone (an unmapped visa, say) is not a sync problem");
});

test("a card left red by an old failure goes back to synced when nothing is waiting for it; one with a waiting job stays", async () => {
  state.stuckCases = [{ _id: "a" }, { _id: "b" }];
  state.busyJobs = [{ caseId: "b" }];
  assert.equal(await health.healStaleFailures(), 1);
  assert.deepEqual(rec.caseUpdateMany[0].filter._id.$in, ["a"]);
  assert.equal(rec.caseUpdateMany[0].update.$set["integrations.ghl.sync.state"], "synced");
  assert.ok(!("integrations.ghl.flags.needsAttention" in rec.caseUpdateMany[0].update.$set), "the needs-attention flag is left alone (it also marks other things)");
  rec.caseUpdateMany.length = 0;
  state.stuckCases = [];
  assert.equal(await health.healStaleFailures(), 0);
  assert.equal(rec.caseUpdateMany.length, 0);
});

test("retry-all makes every waiting job due now and re-queues legacy failed jobs of cases that still exist (never a stage move, never a deleted case)", async () => {
  state.failedJobs = [{ _id: "j1", caseId: "c1", type: "rename" }, { _id: "j2", caseId: "gone", type: "rename" }, { _id: "j3", caseId: "c1", type: "stage" }];
  state.aliveCases = [{ _id: "c1" }];
  const result = await health.retryAll();
  assert.equal(result.moved, 2 + 1, "2 waiting jobs made due + 1 legacy failed job re-queued");
  const due = rec.jobUpdateMany[0];
  assert.deepEqual(due.filter, { status: "pending", attempts: { $gt: 0 } });
  assert.ok(due.update.$set.nextAttemptAt instanceof Date);
  const requeue = rec.jobUpdateMany[1];
  assert.deepEqual(requeue.filter._id.$in, ["j1"]);
  assert.equal(requeue.update.$set.status, "pending");
});
