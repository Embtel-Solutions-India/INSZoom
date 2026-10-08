const test = require("node:test");
const assert = require("node:assert/strict");

const { createClient, GHLApiError } = require("../ghlClient");
const { selectPipelines, buildStagePlan, detectDrift, resolveGhlStage, resolveUnifiedStage } = require("../ghlPipelineService");
const Case = require("../../../models/Case");

const stages = (names, prefix) => names.map((name, i) => ({ id: `${prefix}${i}`, name, position: i }));
const NAMES = ["Case Onboarded", "Docs checklist", "Docs received", "Draft ready"];
const pipelineA = { id: "pA", name: "Immigrant Documentation pipeline", stages: stages(NAMES, "A") };
const pipelineB = { id: "pB", name: "Non-Immigrant Documentation pipeline", stages: stages(NAMES, "B") };
const cfg = { immigrantPipelineName: pipelineA.name, nonImmigrantPipelineName: pipelineB.name };

// ---- stage plan ----------------------------------------------------------

test("identical stages build unified columns and per-pipeline mappings by ID", () => {
  const { selected, errors } = selectPipelines([pipelineA, pipelineB], cfg);
  assert.deepEqual(errors, []);
  const plan = buildStagePlan(selected);
  assert.equal(plan.ok, true);
  assert.equal(plan.unifiedStages.length, 4);
  assert.equal(plan.stageMappings.length, 8);
  // Same column, different GHL stage IDs per pipeline.
  assert.equal(resolveGhlStage(plan.stageMappings, "pA", "docs_received").ghlStageId, "A2");
  assert.equal(resolveGhlStage(plan.stageMappings, "pB", "docs_received").ghlStageId, "B2");
  assert.equal(resolveUnifiedStage(plan.stageMappings, "pB", "B2").unifiedStageKey, "docs_received");
});

test("a stage name difference stops the plan and reports it (no union, no guessing)", () => {
  const typo = { ...pipelineB, stages: stages(["Case Onboarded", "Docs checklist", "Docs recieved", "Draft ready"], "B") };
  const plan = buildStagePlan(selectPipelines([pipelineA, typo], cfg).selected);
  assert.equal(plan.ok, false);
  assert.match(plan.problems[0], /Stage 3 differs/);
  assert.deepEqual(plan.stageMappings, []);
});

test("different stage counts stop the plan", () => {
  const shorter = { ...pipelineB, stages: stages(NAMES.slice(0, 3), "B") };
  const plan = buildStagePlan(selectPipelines([pipelineA, shorter], cfg).selected);
  assert.equal(plan.ok, false);
  assert.ok(plan.problems.some((p) => /count differs/.test(p)));
});

test("missing or ambiguous pipelines are reported", () => {
  assert.equal(selectPipelines([pipelineA], cfg).errors.length, 1);
  assert.equal(selectPipelines([pipelineA, pipelineA, pipelineB], cfg).errors.length, 1);
});

test("renamed / removed / added stages are detected as drift by stage ID", () => {
  const plan = buildStagePlan(selectPipelines([pipelineA, pipelineB], cfg).selected);
  const renamed = { ...pipelineA, stages: pipelineA.stages.map((s) => (s.id === "A2" ? { ...s, name: "Document Collection" } : s)) };
  const drift = detectDrift(plan.stageMappings, [renamed, pipelineB]);
  assert.equal(drift.length, 1);
  assert.equal(drift[0].type, "stage_renamed");

  const removedAndAdded = { ...pipelineB, stages: [...pipelineB.stages.slice(0, 3), { id: "Bnew", name: "Extra", position: 9 }] };
  const types = detectDrift(plan.stageMappings, [pipelineA, removedAndAdded]).map((d) => d.type).sort();
  assert.deepEqual(types, ["stage_added", "stage_missing"]);
  assert.deepEqual(detectDrift(plan.stageMappings, [pipelineA, pipelineB]), []);
});

// ---- client --------------------------------------------------------------

const res = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  text: async () => (body === undefined ? "" : JSON.stringify(body)),
});
const client = (responses, extra = {}) => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, api: createClient({ token: "secret-token", baseUrl: "https://ghl.test", apiVersion: "2021-07-28", fetch, baseDelayMs: 1, ...extra }) };
};

test("client sends Bearer + Version and query params", async () => {
  const { api, calls } = client([res(200, { ok: true })]);
  assert.deepEqual(await api.get("/opportunities/pipelines", { locationId: "L1" }), { ok: true });
  assert.equal(calls[0].url, "https://ghl.test/opportunities/pipelines?locationId=L1");
  assert.equal(calls[0].init.headers.Authorization, "Bearer secret-token");
  assert.equal(calls[0].init.headers.Version, "2021-07-28");
});

test("client retries 429/5xx/network errors then succeeds", async () => {
  const { api, calls } = client([res(429, {}, { "retry-after": "0" }), res(503, {}), new Error("ECONNRESET"), res(200, { done: 1 })]);
  assert.deepEqual(await api.get("/x"), { done: 1 });
  assert.equal(calls.length, 4);
});

test("client does not retry 4xx and never leaks the token in the error", async () => {
  const { api, calls } = client([res(401, { message: "no scope" })]);
  await assert.rejects(api.get("/x"), (error) => {
    assert.ok(error instanceof GHLApiError);
    assert.equal(error.status, 401);
    assert.equal(error.retryable, false);
    assert.ok(!error.message.includes("secret-token"));
    return true;
  });
  assert.equal(calls.length, 1);
});

test("client gives up after max attempts on persistent 5xx", async () => {
  const { api, calls } = client([res(500, {}), res(500, {}), res(500, {})], { maxAttempts: 3 });
  await assert.rejects(api.get("/x"), (error) => error.status === 500 && error.retryable);
  assert.equal(calls.length, 3);
});

test("client refuses to run without a token", async () => {
  const api = createClient({ token: "", fetch: async () => res(200, {}) });
  await assert.rejects(api.get("/x"), /not configured/);
});

// ---- Case model: existing behaviour unchanged ---------------------------

const baseCase = () => ({ caseNumber: "T-1", clientName: "A", clientEmail: "a@b.co" });

test("Case still REQUIRES visaType when visaSelectionStatus is not set (existing paths unchanged)", () => {
  const error = new Case({ ...baseCase() }).validateSync();
  assert.ok(error?.errors?.visaType, "visaType must still be required for normal cases");
  assert.ok(!new Case({ ...baseCase(), visaType: "H-1B" }).validateSync()?.errors?.visaType);
  assert.ok(new Case({ ...baseCase(), visaSelectionStatus: "selected" }).validateSync()?.errors?.visaType);
});

test("Case allows null visaType ONLY while visaSelectionStatus is pending", () => {
  assert.ok(!new Case({ ...baseCase(), visaSelectionStatus: "pending" }).validateSync()?.errors?.visaType);
});

test("Case accepts creationSource ghl and rejects unknown sources", () => {
  assert.ok(!new Case({ ...baseCase(), visaType: "H-1B", creationSource: "ghl" }).validateSync()?.errors?.creationSource);
  assert.ok(new Case({ ...baseCase(), visaType: "H-1B", creationSource: "bogus" }).validateSync()?.errors?.creationSource);
});

test("non-GHL cases have no integrations.ghl identity", () => {
  const doc = new Case({ ...baseCase(), visaType: "H-1B" });
  assert.equal(doc.integrations?.ghl?.opportunityId, undefined);
});
