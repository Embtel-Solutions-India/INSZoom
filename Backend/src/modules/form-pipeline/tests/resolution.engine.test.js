// Phase 7.E: diagnoser, resolver (ordering, verification, containment, learning), discovery, catalog loading. DB-free.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { diagnose, signatureOf } = require("../resolution/Diagnoser");
const { createResolver } = require("../resolution/Resolver");
const { createMemoryStore } = require("../resolution/solutionStore");
const { loadCatalog } = require("../resolution/catalog");

const QPDF_MESSAGE = 'qpdf binary not found (looked for "C:\\Program Files\\qpdf 12.3.2\\bin\\qpdf.exe"). Install it and/or set QPDF_PATH, then open a NEW terminal (PATH changes don\'t reach already-open shells).';
const qpdfError = () => Object.assign(new Error(QPDF_MESSAGE), { code: "QPDF_NOT_FOUND" });
const quiet = { info() {}, warn() {} };

test("the real stored QPDF_NOT_FOUND error diagnoses as tool_unavailable and records whether the path exists and the tool runs", () => {
  const present = diagnose({ error: qpdfError(), stage: "import", job: { formCode: "I-212" }, deps: { exists: () => true, probeTool: () => true } });
  assert.equal(present.cause, "tool_unavailable");
  assert.equal(present.fixable, true);
  assert.equal(present.reasonCode, "TOOL_UNAVAILABLE");
  assert.ok(present.evidence.includes("configured tool path exists"));
  assert.ok(present.evidence.some((line) => /runs when probed now/.test(line)));
  assert.ok(present.evidence.some((line) => /started before the tool was installed/.test(line)), "the stale-process cause is named when the tool runs now");
  const missing = diagnose({ error: qpdfError(), stage: "import", deps: { exists: () => false } });
  assert.ok(missing.evidence.includes("configured tool path does not exist"));
  assert.equal(missing.cause, "tool_unavailable");
});

test("a plain ENOENT is not assumed to be a missing tool: the evidence carries the syscall and the path check", () => {
  const error = Object.assign(new Error("ENOENT: no such file or directory, open '/tmp/x.in.pdf'"), { code: "ENOENT", syscall: "open" });
  const d = diagnose({ error, stage: "import", deps: { exists: () => true, configuredToolPath: () => "/usr/bin/qpdf" } });
  assert.equal(d.cause, "tool_unavailable");
  assert.ok(d.evidence.includes("syscall open"));
  assert.ok(d.evidence.includes("configured tool path exists"));
});

test("the real 404 messages diagnose as source_not_found, a 503 as network, other known cases as their cause", () => {
  assert.equal(diagnose({ error: new Error("USCIS page fetch failed: 404"), stage: "detect" }).cause, "source_not_found");
  assert.equal(diagnose({ error: Object.assign(new Error("x"), { code: "USCIS_PDF_UNRESOLVED" }), stage: "import" }).cause, "source_not_found");
  const net = diagnose({ error: new Error("USCIS page fetch failed: 503"), stage: "detect" });
  assert.equal(net.cause, "network");
  assert.equal(net.retryFirst, true);
  assert.equal(diagnose({ error: Object.assign(new Error("bad"), { code: "NORMALIZE_INPUT_NOT_PDF" }), stage: "import" }).cause, "not_a_pdf");
  assert.equal(diagnose({ error: new Error("qpdf normalization failed: damaged xref"), stage: "import" }).cause, "pdf_damaged");
  assert.equal(diagnose({ error: Object.assign(new Error("none"), { code: "NORMALIZED_SCAN_EMPTY_FIELDS" }), stage: "import" }).cause, "xfa_or_no_fields");
  assert.equal(diagnose({ error: new Error("BSONObj size: 17000000 is invalid"), stage: "import" }).cause, "template_too_large");
  assert.equal(diagnose({ error: Object.assign(new Error("busy"), { code: "PROMOTION_BUSY" }), stage: "promote" }).cause, "promotion_busy");
  assert.equal(diagnose({ error: new Error("boom"), stage: "migrate_cases" }).cause, "migration_failed");
  assert.equal(diagnose({ error: new Error("weird"), stage: "map" }).cause, "unknown");
});

test("a TypeError from our own code is a programming error (not fixable); a network TypeError (fetch failed) is not", () => {
  assert.equal(diagnose({ error: new TypeError("Cannot read properties of undefined (reading 'x')"), stage: "map" }).cause, "programming_error");
  assert.equal(diagnose({ error: new TypeError("fetch failed"), stage: "detect" }).cause, "network");
});

test("signatures are stable across forms, numbers and paths, and differ across causes and stages", () => {
  const a = diagnose({ error: qpdfError(), stage: "import", job: { formCode: "G-1041" } }).signature;
  const b = diagnose({ error: Object.assign(new Error(QPDF_MESSAGE.replace("12.3.2", "13.0.1")), { code: "QPDF_NOT_FOUND" }), stage: "import", job: { formCode: "I-193" } }).signature;
  assert.equal(a, b);
  assert.notEqual(a, diagnose({ error: qpdfError(), stage: "detect" }).signature);
  assert.notEqual(signatureOf({ stage: "import", code: "A", message: "x" }), signatureOf({ stage: "import", code: "B", message: "x" }));
});

// ---------------------------------------------------------------------------------------------------------------------------------------------- resolver

const entry = (id, strategies, matcher = () => true) => ({ id, description: id, matches: matcher, strategies });
const strategy = (id, run, verify = async () => true) => ({ id, description: id, safe: true, run, verify });

test("a strategy that runs ok and verifies resolves; the first verified one wins and later ones are not run", async () => {
  const ran = [];
  const resolver = createResolver({ catalog: [entry("e", [strategy("a", async () => { ran.push("a"); return { ok: false, evidence: "no" }; }), strategy("b", async () => { ran.push("b"); return { ok: true, evidence: "yes", retry: true }; }), strategy("c", async () => { ran.push("c"); return { ok: true }; })])], store: createMemoryStore(), log: quiet });
  const out = await resolver.resolve({ error: qpdfError(), stage: "import", job: { formCode: "I-212" } });
  assert.equal(out.outcome, "resolved");
  assert.equal(out.retry, true);
  assert.deepEqual(ran, ["a", "b"]);
  assert.deepEqual(out.attempts.map((attempt) => [attempt.strategy, attempt.ok, attempt.verified]), [["a", false, false], ["b", true, true]]);
});

test("a strategy that runs ok but does not verify falls through to the next", async () => {
  const resolver = createResolver({ catalog: [entry("e", [strategy("liar", async () => ({ ok: true, evidence: "fixed" }), async () => false), strategy("honest", async () => ({ ok: true, evidence: "fixed" }))])], store: createMemoryStore(), log: quiet });
  const out = await resolver.resolve({ error: qpdfError(), stage: "import" });
  assert.equal(out.outcome, "resolved");
  assert.equal(out.attempts[0].verified, false);
  assert.match(out.attempts[0].evidence, /not verified/);
  assert.equal(out.attempts[1].strategy, "honest");
});

test("a throwing strategy and a hanging strategy are contained as unsuccessful attempts", async () => {
  const resolver = createResolver({ catalog: [entry("e", [strategy("throws", async () => { throw new Error("kaboom"); }), strategy("hangs", () => new Promise(() => {})), strategy("ok", async () => ({ ok: true, evidence: "fine" }))])], store: createMemoryStore(), log: quiet });
  const out = await resolver.resolve({ error: qpdfError(), stage: "import", ctx: { timeoutMs: 40 } });
  assert.equal(out.outcome, "resolved");
  assert.match(out.attempts[0].evidence, /threw: kaboom/);
  assert.match(out.attempts[1].evidence, /timed out/);
});

test("the stored solution for a signature is tried FIRST, and a stored solution that fails twice is demoted", async () => {
  const store = createMemoryStore();
  const order = [];
  const make = (fail) => createResolver({ catalog: [entry("e", [strategy("first", async () => { order.push("first"); return { ok: false }; }), strategy("learned", async () => { order.push("learned"); return fail ? { ok: false } : { ok: true, evidence: "worked" }; })])], store, log: quiet });
  const error = qpdfError();
  await make(false).resolve({ error, stage: "import", job: { formCode: "A" } });
  assert.deepEqual(order, ["first", "learned"], "nothing stored yet: catalog order");
  order.length = 0;
  await make(false).resolve({ error, stage: "import", job: { formCode: "B" } });
  assert.deepEqual(order, ["learned"], "the stored solution ran first and resolved, so nothing else was tried");
  order.length = 0;
  await make(true).resolve({ error, stage: "import" });
  await make(true).resolve({ error, stage: "import" });
  order.length = 0;
  await make(false).resolve({ error, stage: "import" });
  assert.deepEqual(order, ["first", "learned"], "two failures in a row demoted the stored solution: back to catalog order");
});

test("nothing solves it: exhausted with every attempt recorded; no match and no portfolio is exhausted with no attempts", async () => {
  const resolver = createResolver({ catalog: [entry("e", [strategy("a", async () => ({ ok: false, evidence: "no" }))])], store: createMemoryStore(), log: quiet });
  const out = await resolver.resolve({ error: qpdfError(), stage: "import" });
  assert.equal(out.outcome, "exhausted");
  assert.equal(out.attempts.length, 1);
  const empty = await createResolver({ catalog: [], store: createMemoryStore(), log: quiet }).resolve({ error: new Error("weird"), stage: "map" });
  assert.equal(empty.outcome, "exhausted");
  assert.deepEqual(empty.attempts, []);
});

test("programming errors and refused errors (edition policy hold, lease lost) are not_applicable: no strategy is run", async () => {
  let ran = 0;
  const resolver = createResolver({ catalog: [entry("e", [strategy("a", async () => { ran += 1; return { ok: true }; })])], store: createMemoryStore(), log: quiet });
  assert.equal((await resolver.resolve({ error: new TypeError("x is not a function"), stage: "map" })).outcome, "not_applicable");
  assert.equal((await resolver.resolve({ error: Object.assign(new Error("held"), { code: "EDITION_POLICY_HELD" }), stage: "promote" })).outcome, "not_applicable");
  assert.equal(ran, 0);
});

test("discovery: with no matching catalog entry the generic portfolio is tried, and the strategy that verifies is stored as the solution", async () => {
  const generic = loadCatalog({ log: quiet }).find((item) => item.id === "generic");
  const store = createMemoryStore();
  const resolver = createResolver({ catalog: [generic], store, log: quiet });
  const calls = [];
  const deps = { freshTempDir: async () => { calls.push("fresh"); return { ok: true, evidence: "worked in a fresh temp dir" }; }, retryWithTimeout: async () => { calls.push("timeout"); return { ok: false }; } };
  const error = new Error("something nobody has seen before");
  const out = await resolver.resolve({ error, stage: "import", job: { formCode: "X-1" }, ctx: { deps } });
  assert.equal(out.outcome, "resolved");
  assert.equal(out.attempts[0].source, "discovery");
  assert.equal(out.attempts[0].strategy, "generic_fresh_temp_dir");
  const stored = await store.best(out.attempts[0] && resolverSignature(error));
  assert.equal(stored.strategyId, "generic_fresh_temp_dir");
  // next time the same signature runs the stored solution first
  calls.length = 0;
  await resolver.resolve({ error, stage: "import", ctx: { deps } });
  assert.deepEqual(calls, ["fresh"]);
});
const resolverSignature = (error) => diagnose({ error, stage: "import" }).signature;

test("discovery orders the portfolio by past success for the stage", async () => {
  const generic = loadCatalog({ log: quiet }).find((item) => item.id === "generic");
  const store = createMemoryStore();
  await store.recordSuccess({ signature: "other", strategyId: "generic_alternate_parser", stage: "import" });
  await store.recordSuccess({ signature: "other2", strategyId: "generic_alternate_parser", stage: "import" });
  const resolver = createResolver({ catalog: [generic], store, log: quiet });
  const planned = await resolver.plan({ error: new Error("another unknown"), stage: "import" });
  assert.equal(planned.planned[0], "generic_alternate_parser");
  assert.deepEqual(planned.planned.slice(1), ["generic_fresh_temp_dir", "generic_retry_longer_timeout", "generic_reresolve_source"]);
});

test("generic and dependency strategies report an honest 'dependency not provided' when the stage owner supplies nothing", async () => {
  const resolver = createResolver({ catalog: loadCatalog({ log: quiet }), store: createMemoryStore(), log: quiet });
  const out = await resolver.resolve({ error: new Error("USCIS page fetch failed: 503"), stage: "detect" });
  assert.equal(out.outcome, "exhausted");
  assert.ok(out.attempts.every((attempt) => /not provided|not registered|does not apply|did not help/.test(attempt.evidence)), JSON.stringify(out.attempts.map((attempt) => attempt.evidence)));
});

test("trim_leading_junk repairs a buffer with junk before the PDF header and refuses a buffer that already starts correctly", async () => {
  const catalog = loadCatalog({ log: quiet });
  const resolver = createResolver({ catalog, store: createMemoryStore(), log: quiet });
  let used = null;
  const junk = Buffer.concat([Buffer.from("<html>oops</html>\n"), Buffer.from("%PDF-1.7\n%%EOF")]);
  const out = await resolver.resolve({ error: Object.assign(new Error("normalizePdf expects a PDF Buffer"), { code: "NORMALIZE_INPUT_NOT_PDF" }), stage: "import", ctx: { deps: { inputBuffer: junk, useBuffer: async (buffer) => { used = buffer; } } } });
  assert.equal(out.outcome, "resolved");
  assert.equal(out.attempts[0].strategy, "trim_leading_junk");
  assert.equal(used.subarray(0, 5).toString(), "%PDF-");
  const clean = await resolver.resolve({ error: Object.assign(new Error("bad"), { code: "NORMALIZE_INPUT_NOT_PDF" }), stage: "import", ctx: { deps: { inputBuffer: Buffer.from("%PDF-1.7") } } });
  assert.equal(clean.outcome, "exhausted");
});

test("the legacy Phase 4 repairs run through the catalog (repair, verify, retry) and respect the per-job limit", async () => {
  const resolver = createResolver({ catalog: loadCatalog({ log: quiet }), store: createMemoryStore(), log: quiet });
  const calls = [];
  const legacy = { name: "clear_template_cache", matches: (error) => /stale template cache/i.test(error.message), repair: async () => calls.push("repair"), verify: async () => "repaired: cache and database agree" };
  const error = new Error("stale template cache");
  const out = await resolver.resolve({ error, stage: "certify", job: { formCode: "I-130", repairsTried: [] }, ctx: { deps: { legacyRepairs: [legacy], recordRepair: async (entry) => calls.push(entry.outcome) } } });
  assert.equal(out.outcome, "resolved");
  assert.equal(out.retry, true);
  assert.deepEqual(calls, ["repair", "repaired"]);
  const again = await resolver.resolve({ error, stage: "certify", job: { formCode: "I-130", repairsTried: [{ strategy: "clear_template_cache" }] }, ctx: { deps: { legacyRepairs: [legacy] } } });
  assert.equal(again.outcome, "exhausted");
});

test("the catalog loader loads every entry (including the other workers') and skips malformed files without failing", () => {
  const entries = loadCatalog({ log: quiet });
  const ids = entries.map((item) => item.id);
  for (const id of ["network", "notAPdf", "pdfDamaged", "xfaNoFields", "templateTooLarge", "scanFieldException", "legacyRepairs", "generic"]) assert.ok(ids.includes(id), `${id} loaded`);
  assert.equal(ids[ids.length - 1], "generic", "generic is last");
  assert.ok(entries.every((item) => item.strategies.length >= 1));
  const warnings = [];
  const fs = require("fs");
  const os = require("os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-"));
  fs.writeFileSync(path.join(dir, "bad.js"), "module.exports = { id: 5 };");
  fs.writeFileSync(path.join(dir, "throws.js"), "throw new Error('nope');");
  fs.writeFileSync(path.join(dir, "good.js"), "module.exports = { id: 'good', matches: () => true, strategies: [{ id: 's', run: async () => ({ ok: true }) }] };");
  const loaded = loadCatalog({ dir, log: { warn: (name) => warnings.push(name) } });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(loaded.map((item) => item.id), ["good"]);
  assert.equal(warnings.length, 2);
});
