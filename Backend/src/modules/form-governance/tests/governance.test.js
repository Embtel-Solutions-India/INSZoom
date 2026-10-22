// Phase 5 governance backend, DB-free: pure summarizers, the fail-safe recorders (injected stores), the read services (injected models), and the routes' guards / wiring.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { summarizeCatalogSync, summarizeAutopilot, summarizeUpgrade, stageTimings, jobSummary } = require("../summaries");
const { recordRun, timedRun, recordMigrationOutcome } = require("../GovernanceRecorder");
const { currentFrozen, outcomeTotals, frozenCases, frozenOpenCount } = require("../FrozenCasesService");
const { buildQueue, mappingReviewQueue } = require("../MappingReviewService");
const status = require("../FormStatusService");
const { overview, metrics } = require("../GovernanceOverviewService");
const authorizeRoles = require("../../../middleware/authorizeRoles");

const SRC = path.join(__dirname, "..", "..", "..");
const read = (relative) => fs.readFileSync(path.join(SRC, relative), "utf8");
const code = (relative) => read(relative).split(/\r?\n/).filter((line) => !line.trim().startsWith("//")).join("\n");
const oid = (n) => String(n).padStart(24, "0");

// a chain-able stand-in for a mongoose query
const query = (value) => { const q = { sort: () => q, limit: () => q, skip: () => q, select: () => q, lean: async () => value, then: (a, b) => Promise.resolve(value).then(a, b) }; return q; };

test("run summaries count what each scheduled job reports", () => {
  assert.deepEqual(summarizeCatalogSync({ published: 90, upgradesFound: 2, newFormsFound: 1, errors: ["I-9: boom"], results: [{ outcome: "live" }, { outcome: "kept_in_review" }, { outcome: "error" }, { outcome: "queued" }] }),
    { checked: 90, changed: 3, promoted: 1, held: 1, failed: 2 });
  assert.deepEqual(summarizeAutopilot({ registry: { error: "x" }, forms: [{ activated: true, certified: true }, { mappingSaved: true, certified: false }, { error: "e" }, { skipped: "already certified" }] }),
    { checked: 4, changed: 2, promoted: 1, held: 1, failed: 2 });
  assert.deepEqual(summarizeUpgrade({ checked: 3, upgraded: ["I-130"], results: [{ status: "upgraded" }, { status: "queued" }, { status: "uscis_unreachable" }] }),
    { checked: 3, changed: 1, promoted: 1, held: 1, failed: 1 });
  for (const fn of [summarizeCatalogSync, summarizeAutopilot, summarizeUpgrade]) assert.doesNotThrow(() => fn(undefined));
});

test("stage timings: average and p95 over finished stages only; a Map of stages works too", () => {
  const stage = (start, ms) => ({ startedAt: new Date(start), finishedAt: new Date(new Date(start).getTime() + ms) });
  const jobs = [
    { stages: { import: stage("2026-01-01T00:00:00Z", 1000), map: stage("2026-01-01T00:00:01Z", 200) } },
    { stages: new Map([["import", stage("2026-01-01T01:00:00Z", 3000)]]) },
    { stages: { import: { startedAt: new Date(), finishedAt: null }, certify: { startedAt: "x" } } },
  ];
  assert.deepEqual(stageTimings(jobs), [{ stage: "import", count: 2, avgMs: 2000, p95Ms: 3000 }, { stage: "map", count: 1, avgMs: 200, p95Ms: 200 }]);
  assert.deepEqual(stageTimings([]), []);
});

test("a job summary carries no lease and no history, and its age is measured from creation", () => {
  const now = new Date("2026-01-02T00:00:00Z");
  const out = jobSummary({ _id: oid(1), formCode: "I-130", state: "blocked", attempts: 3, lease: { token: "SECRET" }, history: [1], createdAt: new Date("2026-01-01T00:00:00Z"), nextAttemptAt: now, lastError: { class: "blocked", code: "BAD_PDF", stage: "import", message: "bad", at: now } }, now);
  assert.deepEqual(Object.keys(out).sort(), ["ageMs", "attempts", "currentStage", "formCode", "jobId", "lastError", "nextAttemptAt", "state"]);
  assert.equal(out.ageMs, 86400000);
  assert.equal(out.currentStage, "import");
  assert.deepEqual(out.lastError, { class: "blocked", code: "BAD_PDF", stage: "import", message: "bad" });
  assert.equal(JSON.stringify(out).includes("SECRET"), false);
});

test("recording a run never throws, whatever the store does", async () => {
  const good = [];
  const store = { insertRun: async (row) => good.push(row), pruneRuns: async () => {} };
  const row = await recordRun("autopilot", { startedAt: new Date("2026-01-01T00:00:00Z"), finishedAt: new Date("2026-01-01T00:00:05Z"), checked: 4, error: "e".repeat(900) }, { store });
  assert.equal(row.durationMs, 5000);
  assert.equal(good[0].error.length, 500);
  assert.ok(good[0].expireAt > good[0].finishedAt);
  const broken = { insertRun: async () => { throw new Error("db down"); }, pruneRuns: async () => {} };
  assert.equal(await recordRun("autopilot", {}, { store: broken }), null);
});

test("timedRun passes the task's result and its error through untouched, and records both", async () => {
  const rows = [];
  const store = { insertRun: async (row) => rows.push(row), pruneRuns: async () => {} };
  assert.deepEqual(await timedRun("catalog_sync", async () => ({ published: 5, upgradesFound: 1, results: [] }), summarizeCatalogSync, { store }), { published: 5, upgradesFound: 1, results: [] });
  assert.deepEqual([rows[0].kind, rows[0].checked, rows[0].changed], ["catalog_sync", 5, 1]);
  const failure = new Error("USCIS down");
  await assert.rejects(() => timedRun("catalog_sync", async () => { throw failure; }, summarizeCatalogSync, { store }), (error) => error === failure);
  assert.deepEqual([rows[1].failed, rows[1].error], [1, "USCIS down"]);
  // a summarizer that throws and a store that throws change nothing for the caller
  assert.equal(await timedRun("autopilot", async () => 42, () => { throw new Error("bad summarizer"); }, { store }), 42);
  const broken = { insertRun: async () => { throw new Error("db down"); }, pruneRuns: async () => {} };
  assert.equal(await timedRun("autopilot", async () => 7, () => ({}), { store: broken }), 7);
});

test("migration recording: frozen case forms stay open until a later migration stops reporting them; lost edges are kept; no values are stored", async () => {
  const calls = { frozen: [], resolved: [], outcomes: [] };
  const store = {
    upsertFrozen: async (row) => calls.frozen.push(row),
    resolveFrozenNotIn: async (formCode, ids) => calls.resolved.push({ formCode, ids }),
    insertOutcome: async (row) => calls.outcomes.push(row),
  };
  const template = { _id: oid(9), formCode: "i-130", version: "10/01/25" };
  const caseMigration = {
    considered: 4, migrated: 2, verified: 2, skippedFrozen: 2, unresolved: [{ caseFormId: oid(5), answer: "SECRET-ANSWER" }], reconciliationRequired: [], failed: [],
    frozenReport: [{ caseFormId: oid(1), caseId: oid(2), caseNumber: "C-1", status: "filed", fromEdition: "04/01/24", toEdition: "10/01/25", priority: true }, { caseFormId: "not-an-id" }],
  };
  const out = await recordMigrationOutcome({ template, caseMigration, lostEdges: [{ targetPdfField: "form1[0].Pt1[0].Old[0]", sourcePath: "petitioner.name", targetLabel: "Old name" }] }, { store, now: () => new Date("2026-01-01T00:00:00Z") });
  assert.deepEqual(out, { frozen: 1, lostEdges: 1 });
  assert.deepEqual([calls.frozen[0].formCode, calls.frozen[0].caseNumber, calls.frozen[0].priority, calls.frozen[0].resolved], ["I-130", "C-1", true, false]);
  assert.deepEqual(calls.resolved, [{ formCode: "I-130", ids: [oid(1)] }]);
  const outcome = calls.outcomes[0];
  assert.deepEqual(outcome.counts, { considered: 4, migrated: 2, verified: 2, skippedFrozen: 2, unresolved: 1, reconciliationRequired: 0, failed: 0 });
  assert.deepEqual(outcome.lostEdges, [{ targetFieldId: "form1[0].Pt1[0].Old[0]", sourcePath: "petitioner.name", reason: "field_removed_in_new_edition", label: "Old name" }]);
  assert.equal(JSON.stringify([calls.frozen, outcome]).includes("SECRET-ANSWER"), false);
  assert.ok(outcome.expireAt > outcome.reportedAt);
  // nothing to say and nothing to record
  assert.equal(await recordMigrationOutcome({ template, caseMigration: null, lostEdges: [] }, { store }), null);
  assert.equal(await recordMigrationOutcome({}, { store }), null);
  // a failing store is swallowed
  const broken = { ...store, upsertFrozen: async () => { throw new Error("db down"); } };
  assert.equal(await recordMigrationOutcome({ template, caseMigration }, { store: broken }), null);
});

test("frozen cases: newest row per case form wins, resolved ones are dropped, priority first, counts from the newest outcome per form", async () => {
  const rows = [
    { caseFormId: oid(1), formCode: "I-130", caseId: oid(11), caseNumber: "C-1", status: "filed", fromEdition: "a", toEdition: "b", priority: false, reportedAt: new Date("2026-01-01") },
    { caseFormId: oid(1), formCode: "I-130", caseId: oid(11), status: "filed", priority: false, resolved: true, reportedAt: new Date("2026-02-01") },
    { caseFormId: oid(2), formCode: "I-485", caseId: oid(12), caseNumber: "C-2", status: "locked", priority: true, reportedAt: new Date("2026-01-05") },
    { caseFormId: oid(3), formCode: "I-485", caseId: oid(13), caseNumber: "C-3", status: "locked", priority: false, reportedAt: new Date("2026-01-06") },
  ];
  assert.deepEqual(currentFrozen(rows).map((item) => item.caseNumber), ["C-2", "C-3"]);
  assert.deepEqual(Object.keys(currentFrozen(rows)[0]).sort(), ["caseFormId", "caseId", "caseNumber", "formCode", "fromEdition", "priority", "reportedAt", "status", "toEdition"]);
  assert.deepEqual(outcomeTotals([
    { formCode: "I-130", reportedAt: new Date("2026-01-01"), counts: { unresolved: 9, reconciliationRequired: 9 } },
    { formCode: "I-130", reportedAt: new Date("2026-02-01"), counts: { unresolved: 2, reconciliationRequired: 1 } },
    { formCode: "I-485", reportedAt: new Date("2026-01-01"), counts: { unresolved: 1 } },
  ]), { unresolved: 3, reconciliationRequired: 1 });
  const model = { find: () => query(rows), aggregate: async () => [{ formCode: "I-130", counts: { unresolved: 2, reconciliationRequired: 1 }, reportedAt: new Date() }], distinct: async () => [oid(2), oid(3)] };
  const out = await frozenCases({ model });
  assert.deepEqual([out.total, out.unresolved, out.reconciliationRequired], [2, 2, 1]);
  assert.equal(await frozenOpenCount({ model }), 2);
});

test("mapping review queue: needs_review edges of the newest version per template, read-only", async () => {
  const versions = [
    { formCode: "I-130", template: oid(1), mappingVersion: 3, graph: { edges: [
      { targetFieldId: "f1", targetPdfField: "form1[0].A[0]", targetLabel: "Family name", section: "Part 1", sourcePath: "petitioner.lastName", origin: "ai", status: "needs_review", evidence: { reason: "ai suggestions are review-only", downgradedFrom: "active" } },
      { targetFieldId: "f2", sourcePath: "petitioner.firstName", origin: "authored", status: "active" },
    ] } },
    { formCode: "I-130", template: oid(1), mappingVersion: 2, graph: { edges: [{ targetFieldId: "old", status: "needs_review" }] } },
  ];
  const items = buildQueue([versions[0]]);
  assert.equal(items.length, 1);
  assert.deepEqual(Object.keys(items[0]).sort(), ["evidence", "formCode", "label", "mappingVersion", "origin", "reasons", "section", "sourcePath", "status", "targetFieldId", "targetPdfField", "templateId"]);
  assert.deepEqual(items[0].reasons, ["ai suggestions are review-only", "downgraded from active"]);
  let filter;
  const models = { MappingVersion: { find: (f) => { filter = f; return query(versions); } } };
  const queue = await mappingReviewQueue({ formCode: "i-130", models });
  assert.equal(filter.formCode, "I-130");
  assert.deepEqual([queue.total, queue.items[0].targetFieldId], [1, "f1"], "only the newest version of a template is read");
});

test("form status: certification severity from the policy, coverage, edition policy, timeline", () => {
  const cert = status.certificationStatus({ passed: false, checks: [{ name: "pdf_fillable", passed: true }, { name: "viewer_download", passed: false, detail: "bad" }] });
  assert.equal(cert.state, "warning");
  assert.deepEqual(cert.checks.map((check) => check.severity), ["critical", "non_critical"]);
  assert.equal(status.certificationStatus({ passed: false, checks: [{ name: "widget_inputs", passed: false }] }).state, "blocked");
  assert.equal(status.certificationStatus({ passed: false, checks: [{ name: "brand_new_check", passed: false }] }).checks[0].severity, "critical", "an unknown check is critical");
  assert.equal(status.certificationStatus(undefined).state, "unknown");
  assert.deepEqual(status.coverageStatus({ fields: { mapped: 40, requiredUnmapped: 0, unmappedByClass: { unresolved: 2 } } }), { state: "warning", detail: "40 mapped, 0 required unmapped, 2 unresolved", mapped: 40, requiredUnmapped: 0, unresolved: 2 });
  assert.equal(status.coverageStatus({ fields: { mapped: 1, requiredUnmapped: 1, unmappedByClass: {} } }).state, "blocked");
  assert.equal(status.coverageStatus(undefined).state, "unknown");
  assert.equal(status.editionPolicyStatus({ allowed: false, decision: "not_accepted", reasons: ["r"] }).state, "blocked");
  assert.equal(status.editionPolicyStatus({ allowed: false, decision: "held", reasons: [] }).state, "warning");
  assert.equal(status.editionPolicyStatus({ allowed: true, decision: "accepted" }).state, "ok");
  const timeline = status.timelineOf({ stages: { map: { status: "done", startedAt: new Date("2026-01-01T00:00:05Z") }, import: { status: "failed", startedAt: new Date("2026-01-01T00:00:00Z"), attempts: 2, error: { class: "blocked", code: "BAD", message: "m" } } } });
  assert.deepEqual(timeline.map((item) => item.stage), ["import", "map"]);
  assert.deepEqual(timeline[0].error, { class: "blocked", code: "BAD", message: "m" });
  assert.equal(status.degradedOf({ lifecycle: {} }), null);
  assert.deepEqual(status.degradedOf({ lifecycle: { certificationOverride: { reason: "why", failed: ["viewer_download"], by: oid(4), at: new Date("2026-01-01T00:00:00Z") } } }), { reason: "why", failedChecks: ["viewer_download"], by: oid(4), at: "2026-01-01T00:00:00.000Z" });
  assert.equal(status.holdOf({ decision: "promote", checks: [] }, { state: "ok" }), null);
  assert.deepEqual(status.holdOf({ decision: "held", checks: [{ name: "edition_policy", outcome: "held", detail: "not confirmed" }] }, { state: "warning", reasons: [] }), { reasons: ["not confirmed"], decision: "held" });
});

test("formStatus of one form assembles every part and degrades a failing part to unknown instead of failing", async () => {
  const template = {
    _id: oid(1), formCode: "I-130", version: "10/01/25", editionDate: new Date("2025-10-01"), status: "active", mappingStatus: "active", lastChecked: new Date("2026-01-01T00:00:00Z"),
    importMetadata: { importedAt: new Date("2026-01-01"), source: "uscis", validationSummary: { certification: { passed: true, checks: [{ name: "pdf_fillable", passed: true }] } } },
    lifecycle: { certificationOverride: { reason: "ok to ship", failed: ["components_slice"], at: new Date("2026-01-01") } },
  };
  const deps = {
    now: () => new Date("2026-01-02T00:00:00Z"),
    Template: { find: () => query([template]) },
    MappingVersion: { findOne: () => query({ mappingVersion: 4, validation: { coverage: { fields: { mapped: 10, requiredUnmapped: 0, unmappedByClass: { unresolved: 0 } } } } }) },
    Job: { findOne: () => query({ stages: { import: { status: "done", startedAt: new Date("2026-01-01T00:00:00Z"), finishedAt: new Date("2026-01-01T00:00:02Z"), attempts: 1 } } }) },
    Report: { findOne: () => query({ lostEdges: [{ targetFieldId: "t1", sourcePath: "petitioner.x", reason: "field_removed_in_new_edition" }] }) },
    releaseGate: { evaluate: async () => ({ decision: "promote", checks: [{ name: "approved", outcome: "pass", detail: "ok" }] }) },
    peekAcceptance: async () => ({ allowed: true, decision: "accepted", reasons: [] }),
  };
  const out = await status.formStatus("i-130", deps);
  assert.deepEqual(Object.keys(out).sort(), ["degraded", "editions", "formCode", "hold", "lostEdges", "statuses", "timeline"]);
  assert.deepEqual(Object.keys(out.statuses).sort(), ["certification", "coverage", "editionPolicy", "import", "mapping", "monitoring", "release"]);
  assert.equal(out.formCode, "I-130");
  assert.deepEqual(out.editions, [{ id: oid(1), version: "10/01/25", editionDate: "2025-10-01T00:00:00.000Z", status: "active" }]);
  assert.deepEqual([out.statuses.mapping.state, out.statuses.mapping.activeVersion, out.statuses.coverage.mapped, out.statuses.certification.state, out.statuses.release.decision, out.statuses.editionPolicy.state, out.statuses.monitoring.state], ["ok", 4, 10, "ok", "promote", "ok", "ok"]);
  assert.equal(out.degraded.reason, "ok to ship");
  assert.equal(out.hold, null);
  assert.deepEqual(out.lostEdges, [{ targetFieldId: "t1", sourcePath: "petitioner.x", reason: "field_removed_in_new_edition" }]);
  // every read failing still answers
  const failing = { ...deps, MappingVersion: { findOne: () => { throw new Error("x"); } }, Job: { findOne: () => { throw new Error("x"); } }, Report: { findOne: () => { throw new Error("x"); } }, peekAcceptance: async () => { throw new Error("x"); }, releaseGate: { evaluate: async () => { throw new Error("x"); } } };
  const degraded = await status.formStatus("I-130", failing);
  assert.equal(degraded.statuses.coverage.state, "unknown");
  assert.equal(degraded.statuses.release.decision, "unknown");
  assert.deepEqual(degraded.timeline, []);
  // an unknown form answers with unknown parts, not an error
  const none = await status.formStatus("ZZ-9", { ...deps, Template: { find: () => query([]) } });
  assert.deepEqual([none.editions, none.statuses.import.state, none.statuses.certification.state, none.hold, none.degraded], [[], "unknown", "unknown", null, null]);
});

test("overview: the exact documented shape, from injected models", async () => {
  const now = new Date("2026-01-02T00:00:00Z");
  const old = { _id: oid(7), formCode: "I-90", state: "held", attempts: 2, createdAt: new Date("2026-01-01T00:00:00Z"), lastError: { class: "held", code: "EDITION_HELD", stage: "promote", message: "m" } };
  const Job = {
    aggregate: async (pipeline) => (pipeline[0].$group?._id === "$state" ? [{ _id: "held", n: 1 }, { _id: "done", n: 5 }] : [{ _id: null, n: 3 }]),
    findOne: () => query(old),
    find: (filter) => query(filter.state === "held" ? [old] : filter.state === "blocked" ? [] : [{ stages: { map: { startedAt: new Date("2026-01-01T00:00:00Z"), finishedAt: new Date("2026-01-01T00:00:04Z") } } }]),
    countDocuments: async () => 2,
  };
  const Run = { find: () => query([{ kind: "autopilot", startedAt: now, finishedAt: now, durationMs: 10, checked: 3, changed: 1, promoted: 0, held: 1, failed: 0 }]) };
  const out = await overview({ now: () => now, Job, Run, Suggestion: { countDocuments: async () => 11 }, mode: () => "inline", placement: () => "embedded", workerAlive: async () => true, frozenOpen: async () => 4, preflight: () => ({ ok: true, checks: [] }) });
  assert.deepEqual(Object.keys(out).sort(), ["blocked", "generatedAt", "held", "metrics", "pipeline", "preflight", "runs"]);
  assert.deepEqual(out.preflight, { ok: true, checks: [] });
  assert.deepEqual(Object.keys(out.pipeline).sort(), ["counts", "mode", "oldestUnresolved", "retries", "stageTimings", "worker"]);
  assert.deepEqual(out.pipeline.worker, { placement: "embedded", alive: true });
  assert.deepEqual(out.pipeline.counts, { pending: 0, running: 0, blocked: 0, held: 1, dead_letter: 0, done: 5 });
  assert.deepEqual(out.pipeline.oldestUnresolved, { ageMs: 86400000, formCode: "I-90", state: "held", jobId: oid(7) });
  assert.deepEqual(out.pipeline.retries, { total: 3, last24h: 3 });
  assert.deepEqual(out.pipeline.stageTimings, [{ stage: "map", count: 1, avgMs: 4000, p95Ms: 4000 }]);
  assert.equal(out.held[0].jobId, oid(7));
  assert.deepEqual(out.runs[0], { kind: "autopilot", startedAt: now, finishedAt: now, durationMs: 10, checked: 3, changed: 1, promoted: 0, held: 1, failed: 0 });
  assert.deepEqual(out.metrics, { promotions24h: 2, failures24h: 2, heldNow: 1, deadLetterNow: 0, aiSuggestions24h: 11, frozenCasesOpen: 4 });
  // nothing readable still yields the shape
  const boom = () => { throw new Error("db down"); };
  const empty = await overview({ now: () => now, Job: { aggregate: boom, find: boom, findOne: boom, countDocuments: boom }, Run: { find: boom }, Suggestion: { countDocuments: boom }, mode: boom, placement: boom, workerAlive: boom, frozenOpen: boom });
  assert.deepEqual([empty.pipeline.oldestUnresolved, empty.blocked, empty.runs, empty.pipeline.worker.alive], [null, [], [], false]);
  assert.equal(empty.preflight, null, "no preflight result yet (or an unreadable one) is null, never an error");
  assert.equal("aiSuggestions24h" in empty.metrics, false, "an unreadable suggestions collection leaves the optional metric out");
  assert.deepEqual((await metrics({ now: () => now, Job, Suggestion: { countDocuments: async () => 0 }, frozenOpen: async () => 0 })).aiSuggestions24h, 0);
});

test("the governance API: five GET routes behind authenticate and the exact read roles; nothing writes", () => {
  const router = require("../form-governance.routes");
  const routes = router.stack.filter((layer) => layer.route).map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`).sort();
  assert.deepEqual(routes, ["GET /forms/:formCode/status", "GET /frozen-cases", "GET /mapping-review", "GET /metrics", "GET /overview"]);
  const source = code("modules/form-governance/form-governance.routes.js");
  assert.match(source, /router\.use\(authenticate\)/);
  assert.match(source, /READ_ROLES = \["super_admin", "admin", "team_lead"\]/);
  assert.equal((source.match(/authorizeRoles\(\.\.\.READ_ROLES\)/g) || []).length, 5);
  assert.equal(/authorizePermissions|router\.(post|put|patch|delete)/.test(source), false);
  assert.deepEqual(router.READ_ROLES, ["super_admin", "admin", "team_lead"]);
  // exact roles: team lead may read, other staff and clients may not
  const guard = authorizeRoles(...router.READ_ROLES);
  const attempt = (role) => { let status = 200; guard({ user: { role } }, { status(code) { status = code; return { json() {} }; } }, () => {}); return status; };
  for (const role of ["super_admin", "admin", "team_lead"]) assert.equal(attempt(role), 200, role);
  for (const role of ["case_manager", "attorney", "client", "employee"]) assert.equal(attempt(role), 403, role);
});

test("the routes answer { success, data } from their services and pass errors on", async () => {
  const { createRouter } = require("../form-governance.routes");
  const router = createRouter({ overview: async () => ({ ok: 1 }), formStatus: async (formCode) => ({ formCode }), mappingReview: async (args) => ({ args }), frozenCases: async () => { throw new Error("boom"); }, metrics: async () => ({ m: 1 }) });
  const layer = (routePath) => router.stack.find((item) => item.route?.path === routePath).route.stack.at(-1).handle;
  const call = async (routePath, req) => { let body; let failure; await layer(routePath)(req, { json: (value) => { body = value; } }, (error) => { failure = error; }); return { body, failure }; };
  assert.deepEqual((await call("/overview", {})).body, { success: true, data: { ok: 1 } });
  assert.deepEqual((await call("/forms/:formCode/status", { params: { formCode: "I-130" } })).body.data, { formCode: "I-130" });
  assert.deepEqual((await call("/mapping-review", { query: { formCode: "I-130" } })).body.data.args, { formCode: "I-130" });
  assert.equal((await call("/frozen-cases", {})).failure.message, "boom");
});

test("wiring: mounted once, hooks are fail-safe and sit after the work, no competing writers", () => {
  assert.equal((code("routes/index.js").match(/router\.use\("\/form-governance", require\("\.\.\/modules\/form-governance\/form-governance\.routes"\)\)/g) || []).length, 1);
  const catalog = code("modules/uscis-lifecycle/jobs/USCISCatalogSyncJob.js");
  assert.match(catalog, /timedRun\("catalog_sync"/);
  assert.match(catalog, /runScheduledEditionChecks\(\)/);
  assert.match(code("modules/uscis-lifecycle/jobs/USCISEditionUpgradeJob.js"), /timedRun\("edition_upgrade"/);
  const autopilot = code("modules/form-registry/FormPipelineAutopilot.js");
  assert.match(autopilot, /timedRun\("autopilot", runOnce/);
  assert.match(autopilot, /module\.exports = \{ run,/);
  const acquire = code("modules/uscis-form-import/services/OnDemandFormAcquisitionService.js");
  assert.equal((acquire.match(/recordMigrationOutcome\(/g) || []).length, 1);
  assert.match(acquire, /try \{ await require\("\.\.\/\.\.\/form-governance\/GovernanceRecorder"\)\.recordMigrationOutcome\(\{ template, caseMigration, lostEdges: migration\?\.lostEdges, actor: user \}\); \} catch/);
  // the module only writes its own two bookkeeping collections
  for (const file of ["GovernanceOverviewService.js", "FormStatusService.js", "MappingReviewService.js", "FrozenCasesService.js"]) {
    assert.equal(/\.(create|insertMany|updateOne|updateMany|deleteOne|deleteMany|findOneAndUpdate|findByIdAndUpdate|save|bulkWrite)\(/.test(code(`modules/form-governance/${file}`)), false, `${file} is read-only`);
  }
  assert.equal(/require\("\.\.\/form-mapping\/services\/(MappingGraphService|CaseFormEditionMigrationService)"\)|VersionManagementService/.test(code("modules/form-governance/FormStatusService.js")), false, "the status view cannot activate or migrate anything");
});

test("the index script is a dry run by default and lists the TTL indexes without connecting", async () => {
  const { plan } = require("../../../scripts/createFormGovernanceIndexes");
  const items = plan();
  const runs = items.find((item) => item.collection === "formpipelinerunsummaries");
  const reports = items.find((item) => item.collection === "formmigrationreports");
  assert.ok(runs && reports);
  assert.ok(runs.indexes.some((index) => index.fields.expireAt === 1 && index.options.expireAfterSeconds === 0));
  assert.ok(runs.indexes.some((index) => index.fields.kind === 1 && index.fields.startedAt === -1));
  assert.ok(reports.indexes.some((index) => index.fields.expireAt === 1 && index.options.sparse === true));
  assert.ok(reports.indexes.some((index) => index.fields.caseFormId === 1 && index.fields.reportedAt === -1));
  assert.match(code("scripts/createFormGovernanceIndexes.js"), /const apply = argv\.includes\("--apply"\)/);
});
