// Phase 7.1: failure memory in the 12-hour catalog sync (FORM_PIPELINE_AUTONOMY off | shadow | on). DB-free: every dependency is injected.
const assert = require("node:assert/strict");
const test = require("node:test");
const { runCatalogSync, applyFailureMemory } = require("../services/FormCatalogSyncService");
const autonomy = require("../../../config/formPipelineAutonomy");

const d = (value) => new Date(value);

test("autonomy mode: default off, invalid is off, shadow and on are recognised (case-insensitive)", () => {
  assert.equal(autonomy.mode({}), "off");
  assert.equal(autonomy.mode({ FORM_PIPELINE_AUTONOMY: "bogus" }), "off");
  assert.equal(autonomy.mode({ FORM_PIPELINE_AUTONOMY: "Shadow" }), "shadow");
  assert.equal(autonomy.mode({ FORM_PIPELINE_AUTONOMY: " ON " }), "on");
  assert.equal(autonomy.isOn({ FORM_PIPELINE_AUTONOMY: "on" }), true);
  assert.equal(autonomy.isOn({ FORM_PIPELINE_AUTONOMY: "shadow" }), false);
});

test("applyFailureMemory skips a blocked / held / dead-letter job for the same edition, and a recent failure; everything else stays", () => {
  const candidates = [
    { formCode: "I-1", editionDate: d("2026-09-18") }, // dead letter for this edition
    { formCode: "I-2", editionDate: d("2026-09-18") }, // blocked, but for an OLDER edition: the new one is worth a try
    { formCode: "I-3", editionDate: d("2026-09-18") }, // failed 1 h ago
    { formCode: "I-4", editionDate: d("2026-09-18") }, // failed 2 days ago
    { formCode: "I-5", editionDate: d("2026-09-18") }, // no job at all
    { formCode: "I-6", editionDate: d("2026-09-18") }, // held
  ];
  const now = d("2026-10-22T12:00:00Z").getTime();
  const jobs = [
    { formCode: "I-1", editionKey: "I-1|2026-09-18|abc", state: "dead_letter" },
    { formCode: "I-2", editionKey: "I-2|2025-01-20|abc", state: "blocked" },
    { formCode: "I-3", editionKey: "I-3|2026-09-18|abc", state: "pending", hasError: true, at: d("2026-10-22T11:00:00Z") },
    { formCode: "I-4", editionKey: "I-4|2026-09-18|abc", state: "pending", hasError: true, at: d("2026-10-20T11:00:00Z") },
    { formCode: "I-6", editionKey: "I-6|2026-09-18|abc", state: "held" },
  ];
  const { keep, skipped } = applyFailureMemory(candidates, jobs, { now });
  assert.deepEqual(keep.map((item) => item.formCode), ["I-2", "I-4", "I-5"]);
  assert.deepEqual(skipped.map((item) => item.formCode), ["I-1", "I-3", "I-6"]);
  assert.ok(skipped.every((item) => item.reason));
});

function deps({ forms, jobs, failFor = [] }) {
  const imported = [];
  return {
    imported,
    listPublishedForms: async () => forms,
    publishedEdition: async () => null,
    installedTemplate: async () => ({ editionDate: d("2020-01-01") }),
    recentJobs: async () => jobs,
    importForm: async (code) => { imported.push(code); if (failFor.includes(code)) throw new Error("boom"); return { template: { status: "active" }, requiresActivation: false }; },
  };
}
const forms = ["I-1", "I-2", "I-3", "I-4"].map((formCode) => ({ formCode, editionDate: d("2026-09-18") }));
const stuck = [{ formCode: "I-1", editionKey: "I-1|2026-09-18|x", state: "dead_letter" }, { formCode: "I-2", editionKey: "I-2|2026-09-18|x", state: "blocked" }];

async function withMode(value, fn) {
  const before = process.env.FORM_PIPELINE_AUTONOMY;
  if (value === undefined) delete process.env.FORM_PIPELINE_AUTONOMY; else process.env.FORM_PIPELINE_AUTONOMY = value;
  try { return await fn(); } finally { if (before === undefined) delete process.env.FORM_PIPELINE_AUTONOMY; else process.env.FORM_PIPELINE_AUTONOMY = before; }
}

test("off (default): behavior is unchanged - the stuck forms still use the slots", async () => {
  await withMode(undefined, async () => {
    const fake = deps({ forms, jobs: stuck });
    const result = await runCatalogSync({ maxFormsPerRun: 2 }, fake);
    assert.deepEqual(fake.imported, ["I-1", "I-2"]);
    assert.deepEqual(result.skippedKnownFailures, []);
    assert.equal(result.autonomy, "off");
  });
});

test("shadow: still imports exactly as before, but reports what it would have skipped", async () => {
  await withMode("shadow", async () => {
    const fake = deps({ forms, jobs: stuck });
    const result = await runCatalogSync({ maxFormsPerRun: 2 }, fake);
    assert.deepEqual(fake.imported, ["I-1", "I-2"]);
    assert.deepEqual(result.skippedKnownFailures.map((item) => item.formCode), ["I-1", "I-2"]);
  });
});

test("on: the slots go to forms that can progress, the stuck ones are reported, the rest is deferred", async () => {
  await withMode("on", async () => {
    const fake = deps({ forms, jobs: stuck });
    const result = await runCatalogSync({ maxFormsPerRun: 2 }, fake);
    assert.deepEqual(fake.imported, ["I-3", "I-4"]);
    assert.deepEqual(result.skippedKnownFailures.map((item) => item.formCode), ["I-1", "I-2"]);
    assert.equal(result.deferred, 0);
  });
});

test("on: a failing job lookup never blocks the sync", async () => {
  await withMode("on", async () => {
    const fake = deps({ forms, jobs: [] });
    fake.recentJobs = async () => { throw new Error("db down"); };
    const result = await runCatalogSync({ maxFormsPerRun: 2 }, fake);
    assert.deepEqual(fake.imported, ["I-1", "I-2"]);
    assert.equal(result.errors.length, 0);
  });
});

test("on: the time budget stops a long run; the rest is deferred, not failed", async () => {
  await withMode("on", async () => {
    const fake = deps({ forms, jobs: [] });
    const slow = fake.importForm;
    fake.importForm = async (code) => { await new Promise((resolve) => setTimeout(resolve, 30)); return slow(code); };
    const result = await runCatalogSync({ maxFormsPerRun: 4, timeBudgetMs: 20 }, fake);
    assert.deepEqual(fake.imported, ["I-1"]);
    assert.deepEqual(result.results.filter((item) => item.outcome === "deferred").map((item) => item.formCode), ["I-2", "I-3", "I-4"]);
  });
});
