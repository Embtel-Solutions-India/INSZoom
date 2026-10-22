// DB-free tests for the performance tooling: statistics, the budget comparison, the lag meter, the DB-call counter (Mongoose methods stubbed - no connection), the import
// scan (synthetic tree + the real hot-path files) and the HTTP runner (fake fetch, dry-run default). Nothing here touches a database, a server or the network.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const mongoose = require("mongoose");
const { percentile, summarize } = require("./stats");
const { PROPOSED_TOLERANCES, compareToBaseline } = require("./budget");
const { createLagMeter, measureLag } = require("./eventLoopLag");
const { createDbCallCounter, assertNoAddedDbCalls } = require("./dbCallCounter");
const { scanHotPaths } = require("./importScan");
const http = require("./baselineHttp");

test("percentile / summarize use nearest-rank and ignore non-numbers", () => {
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
  assert.equal(percentile([], 50), null);
  assert.deepEqual(summarize([]).count, 0);
  const s = summarize([10, 20, NaN, 30]);
  assert.deepEqual([s.count, s.min, s.max, s.p50], [3, 10, 30, 20]);
});

const base = { endpoints: { "form load": { p50: 100, p95: 200 } }, eventLoop: { p99: 20, max: 100 }, dbCalls: { "form load": 3 } };

test("budget: within the proposed tolerances passes only once the numbers are approved", () => {
  assert.deepEqual(PROPOSED_TOLERANCES, { p50Pct: 5, p95Pct: 10, eventLoopP99Ms: 10, eventLoopMaxMs: 50 });
  const ok = { endpoints: { "form load": { p50: 105, p95: 220 } }, eventLoop: { p99: 30, max: 150 }, dbCalls: { "form load": 3 } };
  const provisional = compareToBaseline(base, ok);
  assert.equal(provisional.provisional, true);
  assert.equal(provisional.passed, false, "unapproved tolerances can never pass");
  assert.ok(provisional.results.every((row) => row.ok));
  assert.equal(compareToBaseline(base, ok, { approved: true }).passed, true);
});

test("budget: any metric over budget, a missing endpoint or an added DB call fails", () => {
  const slow = { endpoints: { "form load": { p50: 106, p95: 200 } }, eventLoop: { p99: 20, max: 100 }, dbCalls: { "form load": 3 } };
  assert.equal(compareToBaseline(base, slow, { approved: true }).passed, false);
  const lag = { endpoints: { "form load": { p50: 100, p95: 200 } }, eventLoop: { p99: 31, max: 100 }, dbCalls: { "form load": 3 } };
  assert.equal(compareToBaseline(base, lag, { approved: true }).passed, false);
  const maxLag = { endpoints: { "form load": { p50: 100, p95: 200 } }, eventLoop: { p99: 20, max: 151 }, dbCalls: { "form load": 3 } };
  assert.equal(compareToBaseline(base, maxLag, { approved: true }).passed, false);
  const missing = { endpoints: {}, eventLoop: { p99: 20, max: 100 }, dbCalls: { "form load": 3 } };
  assert.equal(compareToBaseline(base, missing, { approved: true }).passed, false);
  const extraCall = { endpoints: { "form load": { p50: 100, p95: 200 } }, eventLoop: { p99: 20, max: 100 }, dbCalls: { "form load": 4 } };
  const result = compareToBaseline(base, extraCall, { approved: true });
  assert.equal(result.passed, false);
  assert.equal(result.hardFailures[0].metric, "form load DB calls");
});

test("lag meter: reports ms from the histogram, stops on error, is safe to stop twice", async () => {
  const calls = [];
  const histogram = { enable: () => calls.push("enable"), disable: () => calls.push("disable"), reset: () => calls.push("reset"), percentile: (p) => (p === 50 ? 2e6 : 8e6), max: 12e6 };
  let heap = 100;
  const meter = createLagMeter({ monitor: () => histogram, memory: () => ({ heapUsed: heap }) });
  meter.start();
  heap = 160;
  const snapshot = meter.stop();
  assert.deepEqual(snapshot, { p50: 2, p99: 8, max: 12, heapGrowthBytes: 60 });
  meter.stop();
  assert.equal(calls.filter((c) => c === "disable").length, 1);
  calls.length = 0;
  await assert.rejects(measureLag(async () => { throw new Error("boom"); }, { monitor: () => histogram, memory: () => ({ heapUsed: 0 }) }), /boom/);
  assert.ok(calls.includes("disable"), "stopped although the work threw");
  const real = await measureLag(async () => 7);
  assert.equal(real.result, 7);
  assert.ok(Number.isFinite(real.lag.max));
});

test("db call counter: counts queries, saves and aggregates by collection, restores every method", async () => {
  const proto = mongoose.Query.prototype;
  const aggProto = mongoose.Aggregate.prototype;
  const modelProto = mongoose.Model.prototype;
  const originals = { exec: proto.exec, aggExec: aggProto.exec, save: modelProto.save, bulkWrite: mongoose.Model.bulkWrite, insertMany: mongoose.Model.insertMany };
  // stub the real database methods so nothing can connect, then let the counter wrap the stubs
  proto.exec = async function stub() { return []; };
  aggProto.exec = async function stub() { return []; };
  modelProto.save = async function stub() { return this; };
  const stubs = { exec: proto.exec, aggExec: aggProto.exec, save: modelProto.save };
  try {
    const counter = createDbCallCounter(mongoose);
    const fakeQuery = Object.create(proto, { model: { value: { collection: { name: "templates" } } } });
    const fakeAgg = Object.create(aggProto, { _model: { value: { collection: { name: "cases" } } } });
    const fakeDoc = Object.create(modelProto, { constructor: { value: { collection: { name: "cases" } } } });
    const { calls, byCollection, result } = await counter.measure(async () => {
      await fakeQuery.exec(); await fakeQuery.exec(); await fakeAgg.exec(); await fakeDoc.save();
      return "done";
    });
    assert.equal(result, "done");
    assert.equal(calls, 4);
    assert.deepEqual(byCollection, { templates: 2, cases: 2 });
    assert.equal(proto.exec, stubs.exec);
    assert.equal(aggProto.exec, stubs.aggExec);
    assert.equal(modelProto.save, stubs.save);
    assert.equal(mongoose.Model.bulkWrite, originals.bulkWrite);
    assert.equal((await counter.measure(async () => 1)).calls, 0, "no calls, no count");
    await assert.rejects(counter.measure(async () => { throw new Error("x"); }), /x/);
    assert.equal(proto.exec, stubs.exec, "restored even when the measured code throws");
  } finally {
    proto.exec = originals.exec; aggProto.exec = originals.aggExec; modelProto.save = originals.save;
  }
});

test("hard check: more DB calls than the baseline throws ADDED_HOT_PATH_DB_CALLS", () => {
  assert.equal(assertNoAddedDbCalls("autofill", 5, 5), true);
  assert.equal(assertNoAddedDbCalls("autofill", 5, 3), true);
  assert.throws(() => assertNoAddedDbCalls("autofill", 5, 6), (e) => e.code === "ADDED_HOT_PATH_DB_CALLS");
});

test("import scan: finds a pipeline / Gemini module reached through a chain, including a lazy require; ignores clean graphs", () => {
  const files = {
    "/s/hot.js": 'const a = require("./mid"); function f() { return require("./lazy"); }',
    "/s/mid.js": 'require("./modules/form-pipeline/FormPipeline")',
    "/s/lazy.js": 'require("@google/generative-ai")',
    "/s/modules/form-pipeline/FormPipeline.js": 'require("./never-walked")',
    "/s/clean.js": 'require("./leaf"); require("lodash")',
    "/s/leaf.js": "module.exports = 1",
  };
  const fs = require("node:fs");
  const realExists = fs.existsSync;
  const realStat = fs.statSync;
  const norm = (p) => p.replace(/\\/g, "/").replace(/^[A-Za-z]:/, "");
  fs.existsSync = (p) => (norm(String(p)) in files) || realExists(p);
  fs.statSync = (p, ...rest) => ((norm(String(p)) in files) ? { isFile: () => true } : realStat(p, ...rest));
  try {
    const read = (file) => files[norm(file)] ?? "";
    const hits = scanHotPaths([path.resolve("/s/hot.js")], { read });
    assert.deepEqual(hits.map((h) => h.kind).sort(), ["form pipeline", "package @google/generative-ai"]);
    assert.equal(scanHotPaths([path.resolve("/s/clean.js")], { read }).length, 0);
  } finally {
    fs.existsSync = realExists; fs.statSync = realStat;
  }
});

// STATIC reachability is coarser than the runtime rule: AutoFillService -> case-lifecycle-orchestrator pulls these modules in at LOAD time (the orchestrator starts pipeline
// work for a case, it is not on the autofill call path). So this is a ratchet, not a zero check: today's load-time chains are listed, and any NEW chain - above all Gemini
// or AI mapping becoming reachable by a new route - fails here. Whether a call actually happens on the hot path is the call counter's job (zero added DB calls) plus review.
const KNOWN_LOAD_TIME_CHAINS = new Set([
  "form pipeline: AutoFillService.js -> case-lifecycle-orchestrator.service.js -> visaFormMapping.service.js -> FormPipeline.js",
  "release gate / certification: AutoFillService.js -> case-lifecycle-orchestrator.service.js -> uscis-form.service.js -> VersionManagementService.js -> certPolicy.js",
  "release gate / certification: AutoFillService.js -> case-lifecycle-orchestrator.service.js -> uscis-form.service.js -> VersionManagementService.js -> ReleaseGate.js",
  "release gate / certification: AutoFillService.js -> case-lifecycle-orchestrator.service.js -> visaFormMapping.service.js -> OnDemandFormAcquisitionService.js -> FormCertificationService.js",
]);
const describe = (hit) => `${hit.kind}: ${hit.via.map((file) => path.basename(file)).join(" -> ")}`;

test("hot-path import ratchet: no Gemini / AI-mapping module is reachable from autofill or mapping lookup, and no new pipeline / release chain appears", () => {
  const root = path.resolve(__dirname, "../..");
  const entries = ["modules/form-mapping/services/AutoFillService.js", "modules/form-mapping/services/FormMappingService.js"].map((file) => path.join(root, file));
  const hits = scanHotPaths(entries);
  const unexpected = hits.map(describe).filter((line) => !KNOWN_LOAD_TIME_CHAINS.has(line));
  // the AI-mapping engine is wired from OnDemandFormAcquisitionService behind a flag (off by default); reaching it at load time through that file is expected, nothing else is
  const aiOnly = unexpected.filter((line) => !/^AI mapping: AutoFillService.js -> case-lifecycle-orchestrator.service.js -> visaFormMapping.service.js -> OnDemandFormAcquisitionService.js -> /.test(line));
  assert.deepEqual(aiOnly, []);
  assert.ok(hits.length > 0, "the scan really walks the graph");
});

test("http runner: the default is a dry run that sends nothing; --apply needs an explicit http(s) base url and every input", () => {
  assert.equal(http.parseArgs([]).apply, false);
  assert.equal(http.describePlan().sends, false);
  assert.deepEqual(http.validateApply(http.parseArgs(["--apply"])).length, 5);
  assert.match(http.validateApply(http.parseArgs(["--apply", "--base-url", "ftp://x", "--token", "t", "--case-id", "c", "--form-id", "f", "--out", "o"]))[0], /http\(s\)/);
  assert.deepEqual(http.validateApply(http.parseArgs(["--apply", "--base-url", "http://localhost:1", "--token", "t", "--case-id", "c", "--form-id", "f", "--out", "o"])), []);
});

test("http runner: warm-up then sequential sampling then a concurrent run, per the plan, with a fake fetch", async () => {
  let requests = 0;
  const fetchImpl = async (url, init) => { requests += 1; assert.match(init.headers.Authorization, /^Bearer t$/); return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) }; };
  let now = 0;
  const clock = () => (now += 1);
  const args = http.parseArgs(["--apply", "--base-url", "http://fake.invalid/", "--token", "t", "--case-id", "c1", "--form-id", "f1", "--out", "o"]);
  const out = await http.run(args, { fetchImpl, clock, sequential: 5, warmup: 2, concurrentMs: 30 });
  assert.equal(out.endpoints["case read"].count, 5);
  assert.equal(out.endpoints["form load"].failures, 0);
  assert.ok(requests >= (2 + 5) * http.ENDPOINTS.length);
  assert.ok(Object.keys(out.concurrent).length > 0);
});
