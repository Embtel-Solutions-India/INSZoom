// A stage added in GoHighLevel (e.g. "On Hold") joins the confirmed mapping as a new column without re-mapping anything. DB-free: pure planning + the sync service with a stubbed model.
const test = require("node:test");
const assert = require("node:assert/strict");
const pipelineService = require("../ghlPipelineService");

const stage = (id, name, position) => ({ id, name, position });
const baseStages = [stage("s0", "Case Onboarded", 0), stage("s1", "Submitted (FedEx)", 1), stage("s2", "Feedback", 2)];
const mapping = (pipelineId, s, key) => ({ ghlPipelineId: pipelineId, ghlStageId: s.id, ghlStageName: s.name, unifiedStageKey: key, unifiedStageName: s.name });
const keys = ["case_onboarded", "submitted_fedex", "feedback"];

function storedConfig() {
  return {
    pipelines: [{ ghlPipelineId: "p1", ghlPipelineName: "Immigrant", category: "immigrant", stages: keys.map((key, order) => ({ key, name: baseStages[order].name, order })) }],
    stageMappings: baseStages.map((s, i) => mapping("p1", s, keys[i])),
  };
}

test("only a new stage: it is planned as a new column, existing columns keep their keys", () => {
  const config = storedConfig();
  const pipelines = [{ id: "p1", name: "Immigrant", stages: [...baseStages, stage("s3", "On Hold", 3)] }];
  const plan = pipelineService.planAddedStages(config, pipelines);
  assert.equal(plan.ok, true);
  assert.equal(plan.additions.length, 1);
  assert.deepEqual(plan.additions[0].stage, { key: "on_hold", name: "On Hold" });
  assert.deepEqual(plan.additions[0].mapping, { ghlPipelineId: "p1", ghlStageId: "s3", ghlStageName: "On Hold", unifiedStageKey: "on_hold", unifiedStageName: "On Hold" });
  assert.equal(plan.orders.get("p1:s3"), 3);
  assert.equal(plan.orders.get("p1:s1"), 1, "an existing stage keeps its place");
});

test("a new stage in the middle shifts the order of the stages after it, never their keys", () => {
  const config = storedConfig();
  const pipelines = [{ id: "p1", name: "Immigrant", stages: [baseStages[0], stage("sx", "Review", 1), baseStages[1], baseStages[2]].map((s, i) => ({ ...s, position: i })) }];
  const plan = pipelineService.planAddedStages(config, pipelines);
  assert.equal(plan.ok, true);
  assert.equal(plan.orders.get("p1:sx"), 1);
  assert.equal(plan.orders.get("p1:s1"), 2);
  assert.equal(config.stageMappings.find((m) => m.ghlStageId === "s1").unifiedStageKey, "submitted_fedex");
});

test("refused (changing nothing) when a stage was also renamed or removed, or when nothing was added", () => {
  const config = storedConfig();
  const renamed = [{ id: "p1", name: "Immigrant", stages: [stage("s0", "Onboarded", 0), baseStages[1], baseStages[2], stage("s3", "On Hold", 3)] }];
  assert.equal(pipelineService.planAddedStages(config, renamed).ok, false);
  const removed = [{ id: "p1", name: "Immigrant", stages: [baseStages[0], baseStages[1], stage("s3", "On Hold", 3)] }];
  assert.equal(pipelineService.planAddedStages(config, removed).ok, false);
  const same = [{ id: "p1", name: "Immigrant", stages: baseStages }];
  assert.equal(pipelineService.planAddedStages(config, same).ok, false);
});

test("a new stage whose column key already exists in that pipeline is refused", () => {
  const config = storedConfig();
  const pipelines = [{ id: "p1", name: "Immigrant", stages: [...baseStages, stage("s9", "Feedback", 3)] }];
  const plan = pipelineService.planAddedStages(config, pipelines);
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /already exists/);
});

test("the adopt step appends the stage and mapping, keeps the confirmation, and leaves the status healthy", async () => {
  const GHLIntegration = require("../../../models/GHLIntegration");
  const env = require("../../../config/env");
  const sync = require("../ghlSyncService");
  const config = { ...storedConfig(), mappingsConfirmedAt: new Date("2026-01-01"), status: "config_mismatch", statusDetail: "x", saved: 0, async save() { this.saved += 1; } };
  const original = GHLIntegration.findOne;
  GHLIntegration.findOne = async () => config;
  const client = { async get() { return { pipelines: [{ id: "p1", name: "Immigrant", stages: [...baseStages, stage("s3", "On Hold", 3)] }] }; } };
  try {
    const result = await sync.adoptAddedStages({ client });
    assert.deepEqual(result.added, [{ pipelineId: "p1", key: "on_hold", name: "On Hold" }]);
    assert.equal(config.status, "healthy");
    assert.equal(config.saved, 1);
    assert.equal(config.stageMappings.length, 4);
    assert.deepEqual(config.pipelines[0].stages.map((s) => s.key), [...keys, "on_hold"]);
    assert.deepEqual(config.stageMappings.slice(0, 3).map((m) => m.unifiedStageKey), keys, "existing mappings untouched");
    assert.ok(config.mappingsConfirmedAt, "still confirmed");
  } finally {
    GHLIntegration.findOne = original;
  }
});

test("the client's progress bar shows On Hold only while the case is on hold", async () => {
  const GHLIntegration = require("../../../models/GHLIntegration");
  const { clientPipelineForCase } = require("../ghlCaseOutbound");
  const config = { mappingsConfirmedAt: new Date(), pipelines: [{ enabled: true, ghlPipelineId: "p1", ghlPipelineName: "Immigrant", stages: [{ key: "case_onboarded", name: "Case Onboarded", order: 0 }, { key: "feedback", name: "Feedback", order: 1 }, { key: "on_hold", name: "On Hold", order: 2 }] }] };
  const original = GHLIntegration.findOne;
  GHLIntegration.findOne = () => ({ lean: async () => config });
  try {
    const normal = await clientPipelineForCase({ integrations: { ghl: { pipelineId: "p1", unifiedStageKey: "feedback" } } });
    assert.deepEqual(normal.stages.map((s) => s.key), ["case_onboarded", "feedback"]);
    const held = await clientPipelineForCase({ integrations: { ghl: { pipelineId: "p1", unifiedStageKey: "on_hold" } } });
    assert.deepEqual(held.stages.map((s) => s.key), ["case_onboarded", "feedback", "on_hold"]);
    assert.equal(held.currentKey, "on_hold");
  } finally {
    GHLIntegration.findOne = original;
  }
});
