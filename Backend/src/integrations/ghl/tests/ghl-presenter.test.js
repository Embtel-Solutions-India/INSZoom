const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { publicSyncStatus, presentCard } = require("../ghlPresenter");

const ghl = (state, extra = {}) => ({ unifiedStageKey: "docs_received", pipelineId: "pA", sync: { state, operationId: "op-1", attempts: 5, lastError: "HTTP 503 from GHL", version: 9 }, ...extra });

test("SYNCED / PENDING for everyone; FAILED only for admin and super_admin", () => {
  assert.equal(publicSyncStatus(ghl("synced"), { role: "case_manager" }), "SYNCED");
  assert.equal(publicSyncStatus(ghl("pending"), { role: "case_manager" }), "PENDING");
  assert.equal(publicSyncStatus(ghl("failed"), { role: "admin" }), "FAILED");
  assert.equal(publicSyncStatus(ghl("failed"), { role: "super_admin" }), "FAILED");
  assert.equal(publicSyncStatus(ghl("failed"), { role: "team_lead" }), "PENDING");
  assert.equal(publicSyncStatus(ghl("failed"), { role: "case_manager" }), "PENDING");
  assert.equal(publicSyncStatus(undefined, { role: "admin" }), "SYNCED");
});

test("a card never carries operation ids, retry counts or error text", () => {
  const card = presentCard({ _id: "c1", caseNumber: "N1", clientName: "A", visaSelectionStatus: "pending", integrations: { ghl: ghl("failed") } }, { role: "team_lead" });
  const text = JSON.stringify(card);
  assert.ok(!/op-1|attempt|503|lastError|version/i.test(text), text);
  assert.equal(card.visaSelectionRequired, true);
  assert.equal(card.visaType, null);
  assert.equal(card.sourcePipelineId, "pA");
});

test("the move and retry routes require authentication", async () => {
  const app = require("../../../app");
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/integrations/ghl`;
  try {
    const move = await fetch(`${base}/cases/64b000000000000000000000/pipeline-stage`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ unifiedStageKey: "x" }) });
    assert.equal(move.status, 401);
    const retry = await fetch(`${base}/jobs/64b000000000000000000000/retry`, { method: "POST" });
    assert.equal(retry.status, 401);
    const sync = await fetch(`${base}/sync`, { method: "POST" });
    assert.equal(sync.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
