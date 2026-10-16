// Phase 0: the lifecycle jobs run under withJobLock, failures are logged, and a form cannot be deleted from the catalog while a pipeline job is running. DB-free.
const test = require("node:test");
const assert = require("node:assert/strict");
const JobLock = require("../../../models/JobLock");
const User = require("../../../models/User");
const USCISScannerService = require("../services/USCISScannerService");
const upgradeService = require("../../uscis-form-import/services/FormEditionUpgradeService");
const { runningJobs, FORM_PIPELINE_JOBS } = require("../../../utils/jobLock");
const { startUSCISMonitoringJob } = require("../jobs/USCISMonitoringJob");
const upgradeJobPath = require.resolve("../jobs/USCISEditionUpgradeJob");
// the job destructures upgradeTrackedForms when it loads, so it is loaded AFTER the stub is in place
const loadUpgradeJob = () => { delete require.cache[upgradeJobPath]; return require(upgradeJobPath).startUSCISEditionUpgradeJob; };

const lockSpy = () => {
  const calls = [];
  return { calls, withJobLock: async (name, ttlMs, fn) => { calls.push([name, ttlMs]); return fn(); } };
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
const withEnv = async (vars, fn) => {
  const before = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  Object.assign(process.env, vars);
  try { return await fn(); } finally { for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
};

test("the monitoring job runs inside its job lock and its failure is logged, not thrown", async (t) => {
  const spy = lockSpy();
  let scans = 0;
  t.mock.method(USCISScannerService, "scanAll", async () => { scans += 1; throw new Error("uscis.gov down"); });
  const timer = await withEnv({ USCIS_MONITORING_ENABLED: "true", USCIS_MONITORING_INITIAL_DELAY_MS: "0", USCIS_MONITORING_INTERVAL_MS: "3600000" }, async () => {
    const started = startUSCISMonitoringJob(spy.withJobLock);
    await settle();
    return started;
  });
  clearInterval(timer);
  assert.deepEqual(spy.calls, [["uscis-monitoring", 3 * 60 * 60 * 1000]]);
  assert.equal(scans, 1);
});

test("the edition-upgrade job runs inside its job lock too, and without a lock function (tests / old callers) it still just runs", async (t) => {
  const spy = lockSpy();
  let upgrades = 0;
  t.mock.method(User, "findOne", () => ({ sort: async () => ({ role: "admin" }) }));
  t.mock.method(upgradeService, "upgradeTrackedForms", async () => { upgrades += 1; return {}; });
  const startUSCISEditionUpgradeJob = loadUpgradeJob();
  const env = { USCIS_EDITION_UPGRADE_ENABLED: "true", USCIS_EDITION_UPGRADE_INITIAL_DELAY_MS: "0", USCIS_EDITION_UPGRADE_INTERVAL_MS: "3600000" };
  const locked = await withEnv(env, async () => { const started = startUSCISEditionUpgradeJob(spy.withJobLock); await settle(); return started; });
  clearInterval(locked);
  assert.deepEqual(spy.calls, [["uscis-edition-upgrade", 3 * 60 * 60 * 1000]]);
  assert.equal(upgrades, 1);
  const bare = await withEnv(env, async () => { const started = startUSCISEditionUpgradeJob(); await settle(); return started; });
  clearInterval(bare);
  assert.equal(upgrades, 2);
});

test("disabled jobs schedule nothing", async () => {
  const startUSCISEditionUpgradeJob = loadUpgradeJob();
  await withEnv({ USCIS_MONITORING_ENABLED: "false", USCIS_EDITION_UPGRADE_ENABLED: "false" }, async () => {
    assert.equal(startUSCISMonitoringJob(), null);
    assert.equal(startUSCISEditionUpgradeJob(), null);
  });
});

test("runningJobs reports held pipeline locks, and a lock-store error only ever means 'none' (it can only add a refusal)", async (t) => {
  assert.deepEqual([...FORM_PIPELINE_JOBS], ["uscis-catalog-sync", "uscis-edition-upgrade", "uscis-monitoring", "form-pipeline-autopilot"]);
  let filter;
  t.mock.method(JobLock, "find", (query) => { filter = query; return { select: () => ({ lean: async () => [{ name: "uscis-catalog-sync" }] }) }; });
  assert.deepEqual(await runningJobs(), ["uscis-catalog-sync"]);
  assert.deepEqual(filter.name.$in, [...FORM_PIPELINE_JOBS]);
  assert.ok(filter.lockedUntil.$gt instanceof Date, "only locks that have not expired count");
  t.mock.method(JobLock, "find", () => { throw new Error("database down"); });
  assert.deepEqual(await runningJobs(), []);
});

test("a recurring job holding its lock does NOT block deleting a form (they run most of the day); the delete goes ahead and clears that form's waiting jobs", async (t) => {
  const USCISFormTemplate = require("../../../models/USCISFormTemplate");
  const VisaFormMapping = require("../../../models/VisaFormMapping");
  const FormPipelineJob = require("../../../models/FormPipelineJob");
  const controller = require("../../form-registry/form-registry.controller");
  t.mock.method(JobLock, "find", () => ({ select: () => ({ lean: async () => [{ name: "uscis-edition-upgrade" }, { name: "form-pipeline-autopilot" }] }) }));
  t.mock.method(FormPipelineJob, "exists", async () => null); // nothing is running for THIS form
  let cleared;
  t.mock.method(FormPipelineJob, "deleteMany", async (filter) => { cleared = filter; return { deletedCount: 1 }; });
  t.mock.method(USCISFormTemplate, "find", () => ({ select: () => ({ lean: async () => [{ _id: "t1" }] }) }));
  t.mock.method(require("../../../models/CaseForm"), "countDocuments", async () => 0);
  t.mock.method(VisaFormMapping, "countDocuments", async () => 1);
  t.mock.method(VisaFormMapping, "deleteMany", async () => ({ deletedCount: 1 }));
  t.mock.method(require("../../../models/USCISMappingVersion"), "deleteMany", async () => ({ deletedCount: 1 }));
  t.mock.method(require("../../../models/USCISFormComponentDefinition"), "deleteMany", async () => ({ deletedCount: 0 }));
  t.mock.method(USCISFormTemplate, "deleteMany", async () => ({ deletedCount: 1 }));
  let body = null;
  let failure = null;
  await controller.deleteFormFromCatalog({ params: { formCode: "ds-117" }, user: { _id: "u" } }, { json(value) { body = value; } }, (error) => { failure = error; });
  assert.equal(failure, null);
  assert.equal(body.success, true);
  assert.deepEqual(cleared, { formCode: "DS-117", state: { $in: ["pending", "blocked", "held"] } });
});
