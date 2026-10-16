// Phase 0 AI infrastructure prerequisites: outputSchema enforced, crashed "processing" jobs recovered, Gemini calls time out. DB-free (stubs).
const test = require("node:test");
const assert = require("node:assert/strict");
const { enforceOutputSchema, AIOutputSchemaError } = require("../outputSchema");
const AIJob = require("../../../models/AIJob");
const orchestration = require("../ai-orchestration.service");
const promptDefaults = require("../prompt.defaults");
const gemini = require("../../document-intelligence/services/gemini.service");

test("outputSchema: right types pass, missing keys get their empty value, extra keys are kept, no schema means untouched", () => {
  const schema = { answer: "string", confidence: "number", citations: "array", filters: "object", ok: "boolean" };
  assert.deepEqual(enforceOutputSchema({ answer: "x", confidence: 80, citations: [1], filters: {}, ok: true, extra: 1 }, schema), { answer: "x", confidence: 80, citations: [1], filters: {}, ok: true, extra: 1 });
  assert.deepEqual(enforceOutputSchema({ answer: "x" }, schema), { answer: "x", confidence: 0, citations: [], filters: {}, ok: false });
  assert.deepEqual(enforceOutputSchema({ answer: null, citations: null }, schema), { answer: "", citations: [], confidence: 0, filters: {}, ok: false });
  const untouched = { anything: [1] };
  assert.equal(enforceOutputSchema(untouched, undefined), untouched);
  assert.equal(enforceOutputSchema(untouched, {}), untouched);
  const first = enforceOutputSchema({}, schema);
  const second = enforceOutputSchema({}, schema);
  assert.notEqual(first.citations, second.citations, "filled defaults are never shared between answers");
});

test("outputSchema: numbers and booleans sent as strings are converted, not rejected", () => {
  assert.deepEqual(enforceOutputSchema({ confidence: "85", ok: "TRUE" }, { confidence: "number", ok: "boolean" }), { confidence: 85, ok: true });
  assert.throws(() => enforceOutputSchema({ confidence: "high" }, { confidence: "number" }), /should be number but is string/);
  assert.throws(() => enforceOutputSchema({ confidence: "" }, { confidence: "number" }), /should be number/);
});

test("outputSchema: a wrong type or a non-object answer is a retryable 502 that names the problem", () => {
  assert.throws(() => enforceOutputSchema({ confidence: "high" }, { confidence: "number" }), (error) => error instanceof AIOutputSchemaError && error.status === 502 && error.retryable === true && /"confidence" should be number but is string/.test(error.message));
  assert.throws(() => enforceOutputSchema("not json", { a: "string" }), /expected an object but got string/);
  assert.throws(() => enforceOutputSchema([1], { a: "string" }), /expected an object but got array/);
  assert.throws(() => enforceOutputSchema(null, { a: "string" }), /got null/);
  assert.throws(() => enforceOutputSchema({ a: [] }, { a: "object" }), /should be object but is array/);
});

test("every built-in prompt template's schema can be enforced (only known type names)", () => {
  const templates = Object.entries(promptDefaults);
  assert.ok(templates.length >= 5);
  for (const [name, template] of templates) {
    assert.ok(template.outputSchema && Object.keys(template.outputSchema).length, `${name} declares a schema`);
    for (const type of Object.values(template.outputSchema)) assert.ok(["string", "number", "boolean", "array", "object"].includes(type), `${name}: ${type}`);
    assert.doesNotThrow(() => enforceOutputSchema({}, template.outputSchema), name);
  }
});

test("a job a crash left in 'processing' is queued again (attempts left) or failed (none left), each claimed atomically", async (t) => {
  const now = new Date("2026-10-16T12:00:00Z");
  const updates = [];
  t.mock.method(AIJob, "find", (query) => {
    assert.equal(query.status, "processing");
    assert.equal(query.updatedAt.$lt.toISOString(), "2026-10-16T11:45:00.000Z", "15 minutes by default");
    return { select: () => ({ limit: () => ({ lean: async () => [{ _id: "a", attempts: 1, maxAttempts: 3 }, { _id: "b", attempts: 3, maxAttempts: 3 }, { _id: "c", attempts: 0 }] }) }) };
  });
  t.mock.method(AIJob, "findOneAndUpdate", async (filter, update) => {
    updates.push({ filter, update });
    return filter._id === "c" ? null : { _id: filter._id }; // "c" was claimed by someone else in the meantime
  });
  const result = await orchestration.recoverStuckProcessingJobs(now);
  assert.deepEqual(result, { requeued: 1, failed: 1 });
  assert.equal(updates.length, 3);
  assert.deepEqual(updates[0].filter, { _id: "a", status: "processing", updatedAt: { $lt: new Date("2026-10-16T11:45:00.000Z") } }, "only if it is STILL stuck");
  assert.equal(updates[0].update.$set.status, "queued");
  assert.equal(updates[0].update.$set.error.code, "AI_JOB_INTERRUPTED");
  assert.equal(updates[1].update.$set.status, "failed");
  assert.equal(updates[1].update.$set.error.retryable, false);
});

test("Gemini (document intelligence): a call that never answers is aborted and fails with 504 after the last attempt, not hung forever", async (t) => {
  const previous = { key: process.env.GEMINI_API_KEY, timeout: process.env.GEMINI_TIMEOUT_MS, attempts: process.env.GEMINI_MAX_ATTEMPTS };
  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_TIMEOUT_MS = "1000";
  process.env.GEMINI_MAX_ATTEMPTS = "1";
  let sawSignal = false;
  t.mock.method(globalThis, "fetch", (url, options) => new Promise((resolve, reject) => {
    sawSignal = options?.signal instanceof AbortSignal;
    options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  }));
  try {
    const started = Date.now();
    await assert.rejects(gemini.generateStructuredJson({ prompt: "hi" }), (error) => error.statusCode === 504 && /did not answer within 1s/.test(error.message));
    assert.ok(Date.now() - started < 5000);
    assert.equal(sawSignal, true);
  } finally {
    for (const [name, value] of [["GEMINI_API_KEY", previous.key], ["GEMINI_TIMEOUT_MS", previous.timeout], ["GEMINI_MAX_ATTEMPTS", previous.attempts]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test("Gemini: a dropped connection on the first attempt is retried, and a good answer afterwards is returned as before", async (t) => {
  const previous = { key: process.env.GEMINI_API_KEY, attempts: process.env.GEMINI_MAX_ATTEMPTS };
  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_MAX_ATTEMPTS = "2";
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    if (calls === 1) throw new Error("socket hang up");
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "{\"documentType\":\"passport\"}" }] } }] }) };
  });
  const realSetTimeout = globalThis.setTimeout;
  // the retry back-off (2 s) is skipped; the request-deadline timer (default 90 s) is left real so it can still be cleared
  t.mock.method(globalThis, "setTimeout", (fn, ms, ...rest) => (ms === 2000 ? realSetTimeout(fn, 0) : realSetTimeout(fn, ms, ...rest)));
  try {
    assert.deepEqual(await gemini.generateStructuredJson({ prompt: "hi" }), { documentType: "passport" });
    assert.equal(calls, 2);
  } finally {
    for (const [name, value] of [["GEMINI_API_KEY", previous.key], ["GEMINI_MAX_ATTEMPTS", previous.attempts]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
