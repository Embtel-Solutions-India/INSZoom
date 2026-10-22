// Phase 7.1 preflight: every dependency is injected, so no database, no qpdf and no network are touched.
const test = require("node:test");
const assert = require("node:assert/strict");
const preflight = require("../preflight/pipelinePreflight");

const goodIndexes = {
  formpipelinejobs: [{ name: "one_open_job_per_form", key: { formCode: 1 }, unique: true, partialFilterExpression: { open: true } }],
  uscisformtemplates: [{ name: "formCode_1_version_1", key: { formCode: 1, version: 1 }, unique: true }],
  formeditiondecisions: [{ name: "formCode_1_editionIdentifier_1", key: { formCode: 1, editionIdentifier: 1 }, unique: true }],
};
const fakeDb = (indexes = goodIndexes) => ({ collection: (name) => ({ indexes: async () => { if (!indexes[name]) { const e = new Error("ns does not exist"); e.code = 26; throw e; } return indexes[name]; } }) });
const base = (over = {}) => ({
  env: { FORM_EDITION_AUTO_EVIDENCE: "true" },
  qpdfPath: () => "qpdf",
  exec: async () => "qpdf version 11.9.0\n",
  db: () => fakeDb(),
  Job: () => ({ countDocuments: async () => 0 }),
  User: () => ({ countDocuments: async () => 2 }),
  now: () => new Date("2026-10-22T00:00:00Z"),
  noCache: true,
  ...over,
});
const byName = (result, name) => result.checks.find((item) => item.name === name);

test("version parsing and comparison", () => {
  assert.equal(preflight.parseQpdfVersion("qpdf version 12.3.2"), "12.3.2");
  assert.equal(preflight.parseQpdfVersion("nothing"), null);
  assert.ok(preflight.versionAtLeast("10.6.0", "10.6.0"));
  assert.ok(preflight.versionAtLeast("11.0.0", "10.6.9"));
  assert.ok(!preflight.versionAtLeast("10.5.9", "10.6.0"));
});

test("everything in place: ok, nothing blocking", async () => {
  const result = await preflight.runPreflight(base());
  assert.equal(result.ok, true);
  assert.equal(result.blocking, false);
  assert.equal(result.checks.length, 7);
  assert.ok(result.checks.every((item) => item.status === "pass"));
  assert.equal(result.checkedAt, "2026-10-22T00:00:00.000Z");
});

test("qpdf missing, unreadable or too old is a critical failure", async () => {
  const missing = await preflight.runPreflight(base({ exec: async () => { throw Object.assign(new Error("spawn"), { code: "ENOENT" }); } }));
  assert.equal(byName(missing, "qpdf").status, "fail");
  assert.equal(byName(missing, "qpdf").critical, true);
  assert.equal(byName(await preflight.runPreflight(base({ exec: async () => "garbage" })), "qpdf").status, "fail");
  assert.match(byName(await preflight.runPreflight(base({ exec: async () => "qpdf version 9.1.0" })), "qpdf").detail, /older than/);
});

test("it never installs anything: only the --version probe is executed", async () => {
  const calls = [];
  await preflight.runPreflight(base({ exec: async (binary, args) => { calls.push([binary, ...args]); return "qpdf version 11.0.0"; } }));
  assert.deepEqual(calls, [["qpdf", "--version"]]);
});

test("missing indexes are critical; a disconnected database is only a warning", async () => {
  const missing = await preflight.runPreflight(base({ db: () => fakeDb({ ...goodIndexes, formpipelinejobs: [{ name: "_id_", key: { _id: 1 } }] }) }));
  assert.equal(byName(missing, "indexes").status, "fail");
  assert.match(byName(missing, "indexes").detail, /one_open_job_per_form/);
  const noCollection = await preflight.runPreflight(base({ db: () => fakeDb({ formpipelinejobs: goodIndexes.formpipelinejobs }) }));
  assert.match(byName(noCollection, "indexes").detail, /collection missing/);
  const offline = await preflight.runPreflight(base({ db: () => null }));
  assert.equal(byName(offline, "indexes").status, "warn");
  assert.equal(offline.ok, true);
  // a non-partial index with the right name does not count
  const weak = await preflight.runPreflight(base({ db: () => fakeDb({ ...goodIndexes, formpipelinejobs: [{ name: "one_open_job_per_form", key: { formCode: 1 }, unique: true }] }) }));
  assert.equal(byName(weak, "indexes").status, "fail");
});

test("worker placement: invalid values and queued-with-no-worker fail critically", async () => {
  assert.equal(byName(await preflight.runPreflight(base({ env: { FORM_PIPELINE_MODE: "bogus" } })), "worker_placement").status, "fail");
  assert.equal(byName(await preflight.runPreflight(base({ env: { FORM_PIPELINE_WORKER: "bogus" } })), "worker_placement").status, "fail");
  const queuedOff = await preflight.runPreflight(base({ env: { FORM_PIPELINE_MODE: "queued", FORM_PIPELINE_WORKER: "off" } }));
  assert.equal(byName(queuedOff, "worker_placement").status, "fail");
  assert.equal(byName(await preflight.runPreflight(base({ env: { FORM_PIPELINE_MODE: "queued", FORM_PIPELINE_WORKER: "external" } })), "worker_placement").status, "pass");
});

test("open jobs this build cannot claim, a switched-off evidence flag, no admin, bad autonomy value: warnings, not critical", async () => {
  const result = await preflight.runPreflight(base({ env: { FORM_PIPELINE_AUTONOMY: "maybe" }, Job: () => ({ countDocuments: async () => 3 }), User: () => ({ countDocuments: async () => 0 }) }));
  assert.equal(byName(result, "job_schema_version").status, "warn");
  assert.equal(byName(result, "auto_evidence").status, "warn");
  assert.equal(byName(result, "admin_user").status, "warn");
  assert.equal(byName(result, "autonomy_switch").status, "fail");
  assert.equal(byName(result, "autonomy_switch").critical, false);
  assert.equal(result.blocking, false);
});

test("blocking only when a critical check failed AND enforcement is switched on", async () => {
  const failing = { exec: async () => { throw new Error("nope"); } };
  assert.equal((await preflight.runPreflight(base(failing))).blocking, false);
  const enforced = await preflight.runPreflight(base({ ...failing, env: { FORM_PIPELINE_PREFLIGHT_ENFORCE: "true" } }));
  assert.equal(enforced.blocking, true);
  assert.equal(enforced.enforced, true);
  // a non-critical failure never blocks, even when enforced
  assert.equal((await preflight.runPreflight(base({ env: { FORM_PIPELINE_PREFLIGHT_ENFORCE: "true", FORM_PIPELINE_AUTONOMY: "x" } }))).blocking, false);
});

test("it never throws: a crashing dependency becomes a warning", async () => {
  const result = await preflight.runPreflight(base({ db: () => { throw new Error("boom"); }, Job: () => { throw new Error("boom"); }, User: () => { throw new Error("boom"); }, qpdfPath: () => { throw new Error("boom"); } }));
  assert.equal(result.checks.length, 7);
  assert.equal(byName(result, "indexes").status, "warn");
  assert.equal(byName(result, "job_schema_version").status, "warn");
});

test("the cached result and isBlocking follow the last run", async () => {
  const saved = process.env.FORM_PIPELINE_PREFLIGHT_ENFORCE;
  try {
    delete process.env.FORM_PIPELINE_PREFLIGHT_ENFORCE;
    await preflight.runPreflight(base({ noCache: false, env: { FORM_PIPELINE_PREFLIGHT_ENFORCE: "true" }, exec: async () => { throw new Error("x"); } }));
    assert.equal(preflight.getLastPreflight().blocking, true);
    assert.equal(preflight.isBlocking(), false, "report-only unless the process itself is enforcing");
    process.env.FORM_PIPELINE_PREFLIGHT_ENFORCE = "true";
    assert.equal(preflight.isBlocking(), true);
  } finally {
    if (saved === undefined) delete process.env.FORM_PIPELINE_PREFLIGHT_ENFORCE; else process.env.FORM_PIPELINE_PREFLIGHT_ENFORCE = saved;
  }
});

test("the admin notice goes out once per distinct failing set, per admin, with a dedupe key", async () => {
  const sent = [];
  const deps = { listAdmins: async () => [{ _id: "a1", role: "admin" }, { _id: "a2", role: "super_admin" }], notifications: { createNotification: async (payload) => { sent.push(payload); } } };
  const failing = await preflight.runPreflight(base({ exec: async () => { throw new Error("nope"); } }));
  assert.equal(await preflight.notifyAdmins(failing, deps), true);
  assert.equal(sent.length, 2);
  assert.ok(sent.every((payload) => payload.dedupeKey.startsWith("form-pipeline-preflight:qpdf:")));
  assert.equal(await preflight.notifyAdmins(failing, deps), false, "same failing set: no second notice");
  const healthy = await preflight.runPreflight(base());
  assert.equal(await preflight.notifyAdmins(healthy, deps), false);
  assert.equal(await preflight.notifyAdmins(failing, deps), true, "after recovery, a new failure alerts again");
  assert.equal(sent.length, 4);
});

test("preflight never writes: the module has no database write call", () => {
  const source = require("node:fs").readFileSync(require.resolve("../preflight/pipelinePreflight"), "utf8");
  assert.doesNotMatch(source, /\.(insert|update|delete|save|drop|bulkWrite|createIndex|ensureIndex|replace)\w*\(/);
  assert.doesNotMatch(source, /apt-get|winget|choco|brew install|ensureQpdf/);
});
