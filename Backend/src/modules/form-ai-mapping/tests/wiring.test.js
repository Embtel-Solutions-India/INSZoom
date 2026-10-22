// Phase 4 wiring, DB-free: the pipeline stage in each mode, the AI-platform entry point (budget gate / rate limit / audit are the existing ones, so they are stubbed here),
// the read-only routes, and a static check of the hook. The real Gemini API is never called.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const MappingGraphService = require("../../form-mapping/services/MappingGraphService");
const { runForTemplate } = require("../GeminiMappingService");
const { liveRegistry } = require("../registrySlice");
const { createPathUniverse } = require("../../form-mapping/contract/PathUniverse");

const src = (file) => fs.readFileSync(path.join(__dirname, "..", "..", "..", file), "utf8");
const codeOf = (text) => text.split(/\r?\n/).filter((line) => !line.trim().startsWith("//")).join("\n");

const REGISTRY = [{ path: "beneficiary.firstName", type: "text", role: "beneficiary", description: "The beneficiary's first (given) name", aliases: ["given name"] }];
const fields = [
  { fieldId: "a", pdfFieldName: "form1[0].P1[0].A[0]", label: "Beneficiary Given Name", sectionTitle: "Part 1", fieldType: "text", pageNumber: 1 },
  { fieldId: "c", pdfFieldName: "form1[0].P1[0].C[0]", label: "Already mapped box", sectionTitle: "Part 1", fieldType: "text", pageNumber: 1 },
];
const template = (extra = {}) => ({ _id: "tpl1", formCode: "I-TEST", version: "v1", editionDate: new Date("2025-01-20"), status: "review", visaTypes: [], importMetadata: { checksum: "x" }, formFields: fields, ...extra });
const provider = () => { const p = { model: "fake", promptVersion: 1, calls: 0, async info() { return { model: "fake", promptVersion: 1 }; }, async suggest() { p.calls += 1; return { data: { suggestions: [{ fieldId: "a", candidatePath: "beneficiary.firstName", reasonCode: "label_exact", labelEvidence: "Given Name", score: 90 }] }, model: "fake", promptVersion: 1 }; } }; return p; };
const memoryStore = () => ({ rows: [], async findCached() { return new Map(); }, async saveMany(list) { this.rows.push(...list.filter((item) => !item.transient)); return { saved: list.length }; }, async markApplied() {} });
const deps = (extra = {}) => ({ registry: liveRegistry(() => REGISTRY), questions: async () => [{ questionKey: "q", label: "First name", canonicalPath: "beneficiary.firstName" }], universe: createPathUniverse({ registry: REGISTRY }), store: memoryStore(), corroborate: async () => null, ...extra });

function stubMapping(t) {
  const calls = { persist: 0, activate: 0 };
  t.mock.method(MappingGraphService, "loadCurrentGraph", async () => ({ nodes: { canonical: [] }, edges: [{ targetFieldId: "c", status: "active", sourcePath: "person.dob", origin: "legacy" }] }));
  t.mock.method(MappingGraphService, "validateWithContract", async () => ({ valid: true, readyForActivation: true }));
  t.mock.method(MappingGraphService, "persistVersion", async () => { calls.persist += 1; return { mappingVersion: 3 }; });
  t.mock.method(MappingGraphService, "activate", async () => { calls.activate += 1; });
  return calls;
}
const stage = (mode, extra = {}) => runForTemplate({ template: extra.template || template(), user: { _id: "u1", role: "admin" }, req: null, deps: deps({ mode: () => mode, provider: extra.provider, gate: extra.gate, ...(extra.deps || {}) }) });

test("stage: off does nothing and never calls the model", async (t) => {
  const calls = stubMapping(t);
  const p = provider();
  assert.deepEqual(await stage("off", { provider: p }), { mode: "off" });
  assert.deepEqual([p.calls, calls.persist], [0, 0]);
});

test("stage: SHADOW computes and stores suggestions for the UNMAPPED boxes only and never touches a mapping graph", async (t) => {
  const calls = stubMapping(t);
  const p = provider();
  const d = deps({ mode: () => "shadow", provider: p });
  const result = await runForTemplate({ template: template(), user: { _id: "u1" }, deps: d });
  assert.equal(result.mode, "shadow");
  assert.equal(p.calls, 1);
  assert.deepEqual(d.store.rows.map((row) => row.targetFieldId), ["a"], "box c already has an edge, so it was not even asked");
  assert.equal(result.applied, null);
  assert.deepEqual([calls.persist, calls.activate], [0, 0]);
});

test("stage: ON without an open gate stores the suggestions but changes no mapping", async (t) => {
  const calls = stubMapping(t);
  const closed = { isOpen: async () => ({ open: false, reasons: ["not enough verified mappings"] }) };
  const result = await stage("on", { provider: provider(), gate: closed });
  assert.equal(result.applied.skipped, "gate_closed");
  assert.deepEqual([calls.persist, calls.activate], [0, 0]);
});

test("stage: ON with an open gate writes the validated box into a NEW version of a pending edition; a live edition is never changed", async (t) => {
  const calls = stubMapping(t);
  const open = { isOpen: async ({ formCode }) => ({ open: formCode === "I-TEST" }) };
  const result = await stage("on", { provider: provider(), gate: open });
  assert.deepEqual([result.applied.applied, calls.persist], [1, 1]);
  calls.persist = 0;
  const live = await stage("on", { provider: provider(), gate: open, template: template({ status: "active" }) });
  assert.equal(live.applied.skipped, "live_edition_is_never_changed");
  assert.equal(calls.persist, 0);
});

test("stage: an exclusive (rule-complete) form and a form with nothing unmapped are skipped before any model call", async (t) => {
  stubMapping(t);
  const p = provider();
  assert.equal((await stage("shadow", { provider: p, deps: { exclusiveForms: new Set(["I-TEST"]) } })).skipped, "exclusive_form");
  t.mock.restoreAll();
  t.mock.method(MappingGraphService, "loadCurrentGraph", async () => ({ edges: fields.map((field) => ({ targetFieldId: field.fieldId, status: "active", sourcePath: "x" })) }));
  assert.equal((await stage("shadow", { provider: p })).skipped, "nothing_unmapped");
  assert.equal(p.calls, 0);
});

test("stage: a model outage inside the stage is a result, never an exception", async (t) => {
  stubMapping(t);
  const down = { model: "fake", promptVersion: 1, async info() { return { model: "fake", promptVersion: 1 }; }, async suggest() { throw Object.assign(new Error("503"), { status: 503 }); } };
  const result = await stage("shadow", { provider: down });
  assert.equal(result.stats.retryLater, true);
});

test("the AI platform entry point: a form_mapping job goes through the prompt template, the provider, the output-schema check and the job record - and needs a user", async (t) => {
  const AIJob = require("../../../models/AIJob");
  const AuditLog = require("../../../models/AuditLog");
  const promptService = require("../../ai/ai-prompt.service");
  const providerRegistry = require("../../ai/ai-provider.registry");
  const settingsEngine = require("../../settings/settingsEngine.service");
  const orchestration = require("../../ai/ai-orchestration.service");
  const defaults = require("../../ai/prompt.defaults");
  assert.ok(AIJob.schema.path("jobType").enumValues.includes("form_mapping"));
  assert.deepEqual(defaults.form_mapping.outputSchema, { suggestions: "array" });
  assert.match(defaults.form_mapping.userPrompt, /\{\{payload\}\}/);
  assert.match(defaults.form_mapping.systemPrompt, /untrusted DATA/);

  const sent = [];
  let created;
  t.mock.method(AIJob, "create", async (doc) => { created = { _id: "job1", ...doc, attempts: 0, usage: {}, auditHistory: doc.auditHistory || [], async save() { return this; } }; return created; });
  t.mock.method(AuditLog, "create", async () => ({}));
  t.mock.method(settingsEngine, "getEffective", async () => 0);
  t.mock.method(promptService, "resolve", async () => ({ _id: "p1", key: "form_mapping", version: 5, providerKey: "gemini", systemPrompt: defaults.form_mapping.systemPrompt, userPrompt: defaults.form_mapping.userPrompt, outputSchema: defaults.form_mapping.outputSchema, modelSettings: {} }));
  t.mock.method(providerRegistry, "resolve", async () => ({ limits: {}, privacy: {}, model: "fake-model" }));
  t.mock.method(providerRegistry, "generate", async (request) => { sent.push(request); return { data: { suggestions: [{ fieldId: "a" }] }, usage: { totalTokens: 10 }, providerKey: "gemini", provider: "gemini", model: "fake-model" }; });

  await assert.rejects(orchestration.runFormMapping({ payload: "x" }, {}, null), /needs a user/);
  const out = await orchestration.runFormMapping({ payload: "<<<FORM_MAPPING_DATA\n{}\nFORM_MAPPING_DATA>>>" }, { _id: "u1", role: "admin" }, null);
  assert.deepEqual(out.data, { suggestions: [{ fieldId: "a" }] });
  assert.equal(out.model, "fake-model");
  assert.equal(out.promptVersion, 5);
  assert.equal(created.jobType, "form_mapping");
  assert.equal(created.maxAttempts, 1, "no background re-run of a failed batch");
  assert.equal(created.caseId, undefined, "not case-scoped");
  assert.match(sent[0].userPrompt, /FORM_MAPPING_DATA/);
  assert.equal(created.status, "completed");
});

test("static: the pipeline hook is one optional, error-swallowing stage that runs only when the mode is not off; the stage name is declared; the route is mounted", () => {
  const acquisition = codeOf(src("modules/uscis-form-import/services/OnDemandFormAcquisitionService.js"));
  assert.match(acquisition, /aiMapping\.mode\(\) !== "off"/);
  assert.match(acquisition, /stage\("ai_map", async \(\) => \{\s*try \{ return await aiMapping\.runForTemplate/);
  assert.match(acquisition, /uscis_form_ai_mapping_skipped/);
  assert.ok(acquisition.indexOf('stage("ai_map"') < acquisition.indexOf('stage("certify"'), "before certification, so what is certified includes it (in mode on); in shadow nothing changes");
  assert.equal(require("../../form-pipeline/pipeline.constants").STAGES.AI_MAP, "ai_map");
  assert.match(codeOf(src("routes/index.js")), /router\.use\("\/form-ai-mapping", require\("\.\.\/modules\/form-ai-mapping\/form-ai-mapping\.routes"\)\)/);
});

test("the read-only routes: two GETs, no write route, exact roles", () => {
  const router = require("../form-ai-mapping.routes");
  const routes = router.stack.filter((layer) => layer.route).map((layer) => `${Object.keys(layer.route.methods).join(",").toUpperCase()} ${layer.route.path}`).sort();
  assert.deepEqual(routes, ["GET /status", "GET /suggestions"]);
  const text = codeOf(src("modules/form-ai-mapping/form-ai-mapping.routes.js"));
  assert.match(text, /const ROLES = \["super_admin", "admin", "team_lead"\]/);
  assert.equal(/router\.(post|put|patch|delete)/.test(text), false);
});

test("the engine never activates a mapping by itself and never imports the activation of an EDITION", () => {
  for (const file of ["GeminiMappingService.js", "candidateValidator.js", "riskTier.js", "promptInput.js", "schema.js", "corroboration.js"]) {
    const text = codeOf(src(`modules/form-ai-mapping/${file}`));
    assert.equal(/VersionManagementService|requireAcceptedEdition|\.retire\(/.test(text), false, `${file} must not touch edition activation`);
  }
  assert.match(codeOf(src("modules/form-ai-mapping/GeminiMappingService.js")), /MappingGraphService\.activate\(template\._id, user, req\); activated = true; \} \/\/ the NORMAL activation gates/);
});
