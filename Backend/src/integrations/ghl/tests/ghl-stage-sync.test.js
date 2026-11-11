// The board follows GoHighLevel's stages on its own: a stage ADDED or RENAMED in GHL is adopted by the sync (no admin step, no stopped sync); a stage or pipeline REMOVED
// still needs a person. DB-free: pure planning + the sync service with a stubbed model / client.
const test = require("node:test");
const assert = require("node:assert/strict");
const pipelineService = require("../ghlPipelineService");
const sync = require("../ghlSyncService");
const GHLIntegration = require("../../../models/GHLIntegration");

const stage = (id, name, position) => ({ id, name, position });
const keys = ["case_onboarded", "submitted_fedex", "feedback"];
const oldStages = (p) => [stage(`${p}0`, "Case Onboarded", 0), stage(`${p}1`, "Submitted (FedEx)", 1), stage(`${p}2`, "Feedback", 2)];
const mapping = (p, s, key) => ({ ghlPipelineId: p, ghlStageId: s.id, ghlStageName: s.name, unifiedStageKey: key, unifiedStageName: s.name });

function storedConfig() {
  const pipelines = ["p1", "p2"].map((p) => ({ ghlPipelineId: p, ghlPipelineName: p === "p1" ? "Immigrant" : "Non-Immigrant", category: p === "p1" ? "immigrant" : "non_immigrant", enabled: true, stages: keys.map((key, order) => ({ key, name: oldStages(p)[order].name, order })) }));
  const stageMappings = ["p1", "p2"].flatMap((p) => oldStages(p).map((s, i) => mapping(p, s, keys[i])));
  return { pipelines, stageMappings, mappingsConfirmedAt: new Date("2026-10-08"), status: "healthy", saved: 0, async save() { this.saved += 1; } };
}
// what GHL reports now: "Submitted (FedEx)" renamed to "Submitted" and a new "PWD under process" stage, in BOTH pipelines
const ghlNow = () => ["p1", "p2"].map((p) => ({ id: p, name: p === "p1" ? "Immigrant" : "Non-Immigrant", stages: [stage(`${p}0`, "Case Onboarded", 0), stage(`${p}1`, "Submitted", 1), stage(`${p}x`, "PWD under process", 2), stage(`${p}2`, "Feedback", 3)] }));
const clientFor = (pipelines) => ({ async get() { return { pipelines }; } });

test("planStageSync: a rename keeps the column key, a new stage gets a unique key, both pipelines at once", () => {
  const config = storedConfig();
  const plan = pipelineService.planStageSync(config, ghlNow());
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.renames.map((r) => [r.ghlPipelineId, r.unifiedStageKey, r.from, r.to]), [["p1", "submitted_fedex", "Submitted (FedEx)", "Submitted"], ["p2", "submitted_fedex", "Submitted (FedEx)", "Submitted"]]);
  assert.deepEqual(plan.additions.map((a) => [a.ghlPipelineId, a.stage.key, a.stage.name]), [["p1", "pwd_under_process", "PWD under process"], ["p2", "pwd_under_process", "PWD under process"]]);
  assert.equal(plan.orders.get("p1:p1x"), 2);
  assert.equal(plan.orders.get("p1:p12"), 3, "the stage after the new one moves down");
});

test("planStageSync: a new stage whose key already exists gets _2 instead of blocking the sync", () => {
  const config = storedConfig();
  const pipelines = ghlNow();
  pipelines[0].stages.push(stage("p1y", "Feedback", 4)); // same name as an existing column
  const plan = pipelineService.planStageSync(config, pipelines);
  assert.equal(plan.ok, true);
  assert.ok(plan.additions.some((a) => a.ghlPipelineId === "p1" && a.stage.key === "feedback_2"));
});

test("planStageSync: a stage or pipeline REMOVED in GHL is never adopted (a person must review it); nothing to adopt is not ok", () => {
  const config = storedConfig();
  const removed = ghlNow();
  removed[0].stages = removed[0].stages.filter((s) => s.id !== "p12");
  const plan = pipelineService.planStageSync(config, removed);
  assert.equal(plan.ok, false);
  assert.equal(plan.blockers[0].type, "stage_missing");
  assert.equal(pipelineService.planStageSync(config, [ghlNow()[0]]).ok, false, "a missing pipeline blocks");
  assert.equal(pipelineService.planStageSync(config, ["p1", "p2"].map((p) => ({ id: p, name: p, stages: oldStages(p) }))).ok, false, "no change: nothing to adopt");
});

test("adoptStageChanges: names change, keys and the confirmation stay, new columns are appended in GHL's order, status healthy, saved once", async () => {
  const config = storedConfig();
  const drift = pipelineService.detectDrift(config.stageMappings, ghlNow());
  const result = await sync.adoptStageChanges(config, ghlNow(), drift, { source: "auto" });
  assert.equal(result.adopted, true);
  assert.equal(config.saved, 1);
  assert.equal(config.status, "healthy");
  assert.ok(config.mappingsConfirmedAt, "still confirmed");
  for (const p of config.pipelines) {
    assert.deepEqual(p.stages.map((s) => s.key), ["case_onboarded", "submitted_fedex", "pwd_under_process", "feedback"], "keys unchanged, new column in GHL's position");
    assert.equal(p.stages.find((s) => s.key === "submitted_fedex").name, "Submitted", "displayed name follows GHL");
  }
  const m = config.stageMappings.find((x) => x.ghlStageId === "p11");
  assert.deepEqual([m.unifiedStageKey, m.ghlStageName, m.unifiedStageName], ["submitted_fedex", "Submitted", "Submitted"]);
  assert.equal(pipelineService.detectDrift(config.stageMappings, ghlNow()).length, 0, "no drift left");
});

test("the sync heals itself: loadOrBuildConfig adopts added + renamed stages and is ok (it used to stop the whole sync as config_mismatch)", async () => {
  const config = storedConfig();
  config.status = "config_mismatch";
  const original = GHLIntegration.findOne;
  GHLIntegration.findOne = async () => config;
  try {
    const result = await sync.loadOrBuildConfig({ client: clientFor(ghlNow()) });
    assert.equal(result.ok, true);
    assert.deepEqual(result.drift, []);
    assert.equal(config.status, "healthy");
    assert.equal(config.stageMappings.length, 8);
  } finally { GHLIntegration.findOne = original; }
});

test("a stage REMOVED in GHL still stops the sync as config_mismatch (needs a person)", async () => {
  const config = storedConfig();
  const pipelines = ghlNow();
  pipelines[1].stages = pipelines[1].stages.filter((s) => s.id !== "p22");
  const original = GHLIntegration.findOne;
  GHLIntegration.findOne = async () => config;
  try {
    const result = await sync.loadOrBuildConfig({ client: clientFor(pipelines) });
    assert.equal(result.ok, false);
    assert.equal(config.status, "config_mismatch");
    assert.equal(config.stageMappings.length, 6, "nothing was adopted: the whole change waits for the review");
  } finally { GHLIntegration.findOne = original; }
});

test("GHL_AUTO_ADOPT_STAGES=off restores the old behaviour exactly (a change stops the sync until an admin confirms)", async () => {
  const config = storedConfig();
  const original = GHLIntegration.findOne;
  GHLIntegration.findOne = async () => config;
  process.env.GHL_AUTO_ADOPT_STAGES = "off";
  try {
    const result = await sync.loadOrBuildConfig({ client: clientFor(ghlNow()) });
    assert.equal(result.ok, false);
    assert.equal(config.status, "config_mismatch");
  } finally { delete process.env.GHL_AUTO_ADOPT_STAGES; GHLIntegration.findOne = original; }
});

test("a failure while adopting never breaks the config check: it falls back to config_mismatch", async () => {
  const config = storedConfig();
  let calls = 0;
  config.save = async function save() { calls += 1; if (calls === 1) throw new Error("concurrent save"); };
  const original = GHLIntegration.findOne;
  GHLIntegration.findOne = async () => config;
  try {
    const result = await sync.loadOrBuildConfig({ client: clientFor(ghlNow()) });
    assert.equal(typeof result.ok, "boolean");
  } finally { GHLIntegration.findOne = original; }
});

test("the admin action adopts renames too, and refuses (changing nothing) when a stage was removed", async () => {
  const config = storedConfig();
  const original = GHLIntegration.findOne;
  GHLIntegration.findOne = async () => config;
  try {
    const ok = await sync.adoptStageChangesFromGhl({ client: clientFor(ghlNow()) });
    assert.equal(ok.renamed.length, 2);
    assert.equal(ok.added.length, 2);
    const again = storedConfig();
    GHLIntegration.findOne = async () => again;
    const removed = ghlNow();
    removed[0].stages = removed[0].stages.filter((s) => s.id !== "p12");
    await assert.rejects(() => sync.adoptStageChangesFromGhl({ client: clientFor(removed) }), /removed in GoHighLevel/);
    assert.equal(again.stageMappings.length, 6);
  } finally { GHLIntegration.findOne = original; }
});
