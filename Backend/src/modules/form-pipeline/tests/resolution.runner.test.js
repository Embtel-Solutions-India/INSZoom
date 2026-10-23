// Phase 7.E: the runner with the resolution engine behind FORM_PIPELINE_AUTONOMY (off | shadow | on). DB-free: a fake job service and a fake resolver.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRunner } = require("../FormPipelineRunner");
const { classifyError } = require("../errorClassifier");
const { diagnose } = require("../resolution/Diagnoser");
const { ERROR_CLASSES } = require("../pipeline.constants");

const quiet = { info() {}, warn() {}, error() {} };
const qpdfError = () => Object.assign(new Error('qpdf binary not found (looked for "C:\\Program Files\\qpdf 12.3.2\\bin\\qpdf.exe")'), { code: "QPDF_NOT_FOUND" });

function harness({ mode, outcomes, executor, job = { _id: "j1", formCode: "I-212", attempts: 1, maxAttempts: 5 }, alerter = {} }) {
  const calls = { fail: [], exhaust: [], resolutions: [], complete: [], plan: 0, resolve: 0, stuck: 0 };
  const jobService = {
    heartbeat: async () => {}, stageStart: async () => {}, stageFinish: async () => {}, stageFail: async () => {}, assertLease: async () => {}, setEdition: async () => {}, recordRepair: async () => {},
    get: async () => ({ ...job, repairsTried: [] }),
    fail: async (id, lease, args) => { calls.fail.push(args); return { state: "pending", classification: classifyError(args.error, args.diagnosis), signature: "s", nextAttemptAt: new Date() }; },
    exhaust: async (id, lease, args) => { calls.exhaust.push(args); return { state: "held", classification: { class: ERROR_CLASSES.HELD }, signature: args.signature }; },
    recordResolutions: async (id, lease, attempts) => { calls.resolutions.push(attempts); },
    complete: async (id, lease, outcome) => { calls.complete.push(outcome); },
  };
  const queue = [...outcomes];
  const resolver = {
    plan: async ({ error, stage }) => { calls.plan += 1; return { diagnosis: diagnose({ error, stage }), planned: ["reprobe"] }; },
    resolve: async ({ error, stage }) => { calls.resolve += 1; const next = queue.shift() || { outcome: "exhausted", attempts: [] }; return { retry: false, attempts: [], ...next, diagnosis: next.diagnosis || diagnose({ error, stage }) }; },
  };
  const runner = createRunner({ jobService, alerter: { announce: async () => {}, announceStuck: async () => { calls.stuck += 1; }, ...alerter }, executor, resolver, autonomyMode: () => mode, logger: quiet, heartbeatMs: 1e9 });
  return { runner, calls, job };
}
const lease = { token: "t", fence: 1 };
const once = (fn) => { let n = 0; return async (...args) => fn(n++, ...args); };

test("off: the engine is not consulted at all; the failure is handled exactly as before", async () => {
  const { runner, calls, job } = harness({ mode: "off", outcomes: [], executor: async () => { throw qpdfError(); } });
  const out = await runner.run({ job, lease });
  assert.equal(calls.resolve + calls.plan, 0);
  assert.equal(calls.fail.length, 1);
  assert.equal(calls.fail[0].diagnosis, undefined);
  assert.equal(out.state, "pending");
});

test("shadow: the engine only plans (diagnoses and logs what it would try); nothing is run and the failure is handled as before", async () => {
  const { runner, calls, job } = harness({ mode: "shadow", outcomes: [], executor: async () => { throw qpdfError(); } });
  const out = await runner.run({ job, lease });
  assert.equal(calls.plan, 1);
  assert.equal(calls.resolve, 0);
  assert.equal(calls.fail.length, 1);
  assert.equal(calls.exhaust.length, 0);
  assert.equal(out.state, "pending");
});

test("on, resolved with retry: the attempts are recorded, the work runs once more, the job completes", async () => {
  let runs = 0;
  const executor = async () => { runs += 1; if (runs === 1) throw qpdfError(); return { template: { status: "active", version: "v" }, versionChanged: true }; };
  const { runner, calls, job } = harness({ mode: "on", outcomes: [{ outcome: "resolved", retry: true, attempts: [{ strategy: "reprobe", ok: true, verified: true, evidence: "found qpdf" }] }], executor });
  const out = await runner.run({ job, lease });
  assert.equal(runs, 2);
  assert.equal(out.state, "done");
  assert.equal(calls.resolutions.length, 1);
  assert.equal(calls.resolutions[0][0].strategy, "reprobe");
  assert.equal(calls.resolutions[0][0].stage, null);
  assert.equal(calls.fail.length, 0);
});

test("on, exhausted: the job becomes a documented hold (not a failure), the developer alert is called once, and the original error still reaches the caller", async () => {
  const error = qpdfError();
  const { runner, calls, job } = harness({ mode: "on", outcomes: [{ outcome: "exhausted", attempts: [{ strategy: "reprobe", ok: false, verified: false, evidence: "no working qpdf" }] }], executor: async () => { throw error; } });
  const out = await runner.run({ job, lease });
  assert.equal(calls.exhaust.length, 1);
  assert.equal(calls.exhaust[0].diagnosis.cause, "tool_unavailable");
  assert.equal(calls.exhaust[0].attempts[0].strategy, "reprobe");
  assert.equal(calls.fail.length, 0, "no ordinary failure / dead-letter path");
  assert.equal(calls.stuck, 1);
  assert.equal(out.state, "held");
  assert.equal(out.error, error);
});

test("on, a passing blip (network) is left to the job's backoff retries until the attempts are used up, then it becomes a documented hold", async () => {
  const net = () => Object.assign(new Error("USCIS page fetch failed: 503"), { status: 503 });
  const early = harness({ mode: "on", outcomes: [{ outcome: "exhausted", attempts: [] }], executor: async () => { throw net(); }, job: { _id: "j2", formCode: "I-130", attempts: 2, maxAttempts: 5 } });
  const first = await early.runner.run({ job: early.job, lease });
  assert.equal(early.calls.exhaust.length, 0);
  assert.equal(early.calls.fail.length, 1);
  assert.equal(first.state, "pending");
  const late = harness({ mode: "on", outcomes: [{ outcome: "exhausted", attempts: [] }], executor: async () => { throw net(); }, job: { _id: "j3", formCode: "I-130", attempts: 5, maxAttempts: 5 } });
  const last = await late.runner.run({ job: late.job, lease });
  assert.equal(late.calls.exhaust.length, 1);
  assert.equal(late.calls.fail.length, 0);
  assert.equal(last.state, "held");
});

test("on, a programming error is not_applicable: ordinary failure handling (the only path that can end in dead-letter)", async () => {
  const { runner, calls, job } = harness({ mode: "on", outcomes: [{ outcome: "not_applicable", attempts: [], diagnosis: diagnose({ error: new TypeError("x is not a function"), stage: "map" }) }], executor: async () => { throw new TypeError("x is not a function"); } });
  const out = await runner.run({ job, lease });
  assert.equal(calls.exhaust.length, 0);
  assert.equal(calls.fail.length, 1);
  assert.equal(calls.fail[0].diagnosis.cause, "programming_error");
  assert.equal(out.state, "pending");
});

test("on, a resolver that itself breaks never breaks the pipeline: the ordinary failure handling runs", async () => {
  const jobService = { heartbeat: async () => {}, stageStart: async () => {}, stageFinish: async () => {}, stageFail: async () => {}, get: async () => ({ _id: "j", formCode: "I-9" }), fail: async () => ({ state: "pending", classification: { class: "transient", code: "x" }, signature: "s" }) };
  const runner = createRunner({ jobService, alerter: null, executor: async () => { throw qpdfError(); }, resolver: { resolve: async () => { throw new Error("resolver bug"); }, plan: async () => { throw new Error("resolver bug"); } }, autonomyMode: () => "on", logger: quiet, heartbeatMs: 1e9 });
  const out = await runner.run({ job: { _id: "j", formCode: "I-9", attempts: 1 }, lease });
  assert.equal(out.state, "pending");
});

test("the classifier maps a diagnosed tool_unavailable / source_not_found to a documented hold only when a diagnosis is passed", () => {
  const error = qpdfError();
  assert.notEqual(classifyError(error).class, ERROR_CLASSES.HELD, "without a diagnosis nothing changes");
  const held = classifyError(error, diagnose({ error, stage: "import" }));
  assert.equal(held.class, ERROR_CLASSES.HELD);
  assert.equal(held.code, "TOOL_UNAVAILABLE");
  const missing = new Error("USCIS page fetch failed: 404");
  assert.equal(classifyError(missing, diagnose({ error: missing, stage: "detect" })).code, "NO_OFFICIAL_SOURCE");
  const blip = new Error("USCIS page fetch failed: 503");
  assert.notEqual(classifyError(blip, diagnose({ error: blip, stage: "detect" })).class, ERROR_CLASSES.HELD);
});
