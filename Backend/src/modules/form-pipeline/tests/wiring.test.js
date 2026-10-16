// Phase 1 wiring, DB-free: routes are guarded and never leak the lease token; every pipeline entry point goes through the one door; the existing pipeline code is
// hooked without changing what it does when no job context is present; the delete guard knows about a running job. Static + stubbed.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "..", "..");
const read = (relative) => fs.readFileSync(path.join(SRC, relative), "utf8");
const code = (relative) => read(relative).split(/\r?\n/).filter((line) => !line.trim().startsWith("//")).join("\n");

test("the pipeline API: four routes, all behind authenticate; reads for admin / team lead, retry for admin only", () => {
  const router = require("../form-pipeline.routes");
  const routes = router.stack.filter((layer) => layer.route).map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`).sort();
  assert.deepEqual(routes, ["GET /jobs", "GET /jobs/:id", "GET /status", "POST /jobs/:id/retry"]);
  const source = code("modules/form-pipeline/form-pipeline.routes.js");
  assert.match(source, /router\.use\(authenticate\)/);
  assert.match(source, /READ_ROLES = \["super_admin", "admin", "team_lead"\]/);
  assert.match(source, /RETRY_ROLES = \["super_admin", "admin"\]/);
  for (const [route, roles] of [["/status", "READ_ROLES"], ["/jobs\"", "READ_ROLES"], ["/jobs/:id\"", "READ_ROLES"], ["/jobs/:id/retry", "RETRY_ROLES"]]) {
    assert.match(source, new RegExp(`"${route.replace(/[/]/g, "\\/")}[^\\n]*authorizeRoles\\(\\.\\.\\.${roles}\\)`), `${route} is guarded by ${roles}`);
  }
  assert.equal(/authorizePermissions/.test(source), false, "exact roles only");
  const index = code("routes/index.js");
  assert.equal((index.match(/router\.use\("\/form-pipeline"/g) || []).length, 1);
});

test("the lease token (a worker's secret) is never part of what the API returns", () => {
  const source = code("modules/form-pipeline/form-pipeline.routes.js");
  assert.match(source, /const present = /);
  assert.match(source, /lease\.fence|fence: lease\.fence/);
  assert.equal(/token: lease\.token/.test(source), false);
});

test("every pipeline entry point goes through FormPipeline.runForm (with its original call kept as the fallback); the case-scoped paths are unchanged", () => {
  const through = {
    "modules/uscis-form-import/services/FormCatalogSyncService.js": "catalog_sync",
    "modules/uscis-form-import/services/FormEditionUpgradeService.js": "edition_upgrade",
    "modules/form-registry/form-registry.controller.js": "admin_fetch",
    "modules/form-registry/visaFormMapping.service.js": "mapping_save",
  };
  for (const [file, trigger] of Object.entries(through)) {
    const source = code(file);
    assert.match(source, /form-pipeline\/FormPipeline"\)/, `${file} uses the pipeline door`);
    assert.match(source, new RegExp(`trigger: "${trigger}"`), `${file} names its trigger`);
    assert.match(source, /direct: /, `${file} keeps its original call as the fallback`);
  }
  // still direct (case-scoped, user waiting): documented as a later step
  assert.equal(/FormPipeline/.test(code("modules/form-generation/controllers/FormGenerationController.js")), false);
});

test("the existing pipeline is hooked at its stage boundaries, and with no job context every hook is a plain pass-through", () => {
  const source = code("modules/uscis-form-import/services/OnDemandFormAcquisitionService.js");
  for (const stage of ["detect", "import", "map", "certify", "promote", "migrate_cases", "finalize"]) assert.match(source, new RegExp(`"${stage}"`), `stage ${stage} is reported`);
  assert.match(source, /const stage = \(name, fn\) => \(pipeline \? pipeline\.stage\(name, fn\) : fn\(\)\)/, "no context => the function just runs");
  assert.match(source, /pipeline = null\)/);
  assert.match(source, /activationBlockedCode/, "a policy hold is reported to the job");
  assert.match(source, /async function recordEdition\(pipeline/);
});

test("the policy hold inside the existing activation is recognised from the error code the gate throws", () => {
  const { EditionPolicyHeldError } = require("../../form-edition-policy/EditionPolicyEnforcer");
  const error = new EditionPolicyHeldError({ formCode: "I-1", editionIdentifier: "2026-01-01", reasons: ["no_policy"], entryPoint: "x" });
  assert.equal(error.code, "EDITION_POLICY_HELD");
  assert.match(code("modules/uscis-form-import/services/OnDemandFormAcquisitionService.js"), /activationBlockedCode = error\.code/);
});

test("the server starts the pipeline worker (embedded unless external/off) and stops it on shutdown; the standalone worker process exists", () => {
  const server = code("server.js");
  assert.match(server, /startFormPipeline\(\{ withJobLock \}\)/);
  assert.match(server, /formPipeline\.stop\(\)/);
  const worker = code("workers/formPipelineWorker.js");
  assert.match(worker, /buildWorker\(\)/);
  assert.match(worker, /SIGTERM/);
  const { workerPlacement } = require("../index");
  assert.equal(workerPlacement({}), "embedded");
  assert.equal(workerPlacement({ FORM_PIPELINE_WORKER: "external" }), "external");
  assert.equal(workerPlacement({ FORM_PIPELINE_WORKER: "OFF" }), "off");
  assert.equal(workerPlacement({ FORM_PIPELINE_WORKER: "nonsense" }), "embedded");
});

test("the mode is inline unless FORM_PIPELINE_MODE=queued", () => {
  const { mode } = require("../FormPipeline");
  assert.equal(mode({}), "inline");
  assert.equal(mode({ FORM_PIPELINE_MODE: "queued" }), "queued");
  assert.equal(mode({ FORM_PIPELINE_MODE: "QUEUED" }), "queued");
  assert.equal(mode({ FORM_PIPELINE_MODE: "whatever" }), "inline");
});

test("deleting a form is refused while a pipeline job for THAT form is running", async (t) => {
  const JobLock = require("../../../models/JobLock");
  const FormPipelineJob = require("../../../models/FormPipelineJob");
  const USCISFormTemplate = require("../../../models/USCISFormTemplate");
  const controller = require("../../form-registry/form-registry.controller");
  t.mock.method(JobLock, "find", () => ({ select: () => ({ lean: async () => [] }) }));
  let asked;
  t.mock.method(FormPipelineJob, "exists", async (filter) => { asked = filter; return { _id: "x" }; });
  let touched = 0;
  t.mock.method(USCISFormTemplate, "find", () => { touched += 1; return { select: () => ({ lean: async () => [] }) }; });
  let failure;
  await controller.deleteFormFromCatalog({ params: { formCode: "i-131" }, user: { _id: "u" } }, { json() { throw new Error("must not respond"); } }, (error) => { failure = error; });
  assert.deepEqual(asked, { formCode: "I-131", state: "running" });
  assert.deepEqual([failure.status, failure.code, touched], [409, "FORM_PIPELINE_JOB_RUNNING", 0]);
});

test("Admin Fetch in QUEUED mode answers 202 with the job to poll and does not call the pipeline directly; in the default mode it answers as it always did", async (t) => {
  const VisaFormMapping = require("../../../models/VisaFormMapping");
  const controller = require("../../form-registry/form-registry.controller");
  const OnDemand = require("../../uscis-form-import/services/OnDemandFormAcquisitionService");
  const pipeline = require("../FormPipeline");
  t.mock.method(VisaFormMapping, "findOne", () => ({ select: () => ({ lean: async () => ({ agency: "USCIS" }) }) }));
  let direct = 0;
  t.mock.method(OnDemand, "acquireAndActivate", async () => { direct += 1; return { alreadyActive: true, requiresActivation: false, template: { _id: "t1", formCode: "I-1", status: "active", mappingStatus: "active" } }; });
  const respond = () => { const out = {}; return { out, res: { status(code) { out.status = code; return this; }, json(body) { out.body = body; return this; } } }; };
  const previous = process.env.FORM_PIPELINE_MODE;
  try {
    process.env.FORM_PIPELINE_MODE = "queued";
    pipeline.setServicesForTests({ jobService: { enqueue: async () => ({ created: true, job: { _id: "job-1", state: "pending", formCode: "I-1" } }) }, runner: {} });
    const queued = respond();
    await controller.fetchFormFromUSCIS({ params: { formCode: "I-1" }, user: { _id: "u", role: "admin" } }, queued.res, (error) => { throw error; });
    assert.equal(queued.out.status, 202);
    assert.deepEqual([queued.out.body.data.queued, queued.out.body.data.jobId, queued.out.body.data.state], [true, "job-1", "pending"]);
    assert.equal(direct, 0, "nothing ran on the request thread");

    delete process.env.FORM_PIPELINE_MODE; // default inline: the job store is unavailable here, so the original call is made and answered exactly as before
    pipeline.setServicesForTests({ jobService: { enqueue: async () => { throw new Error("job store down"); } }, runner: {} });
    const inline = respond();
    await controller.fetchFormFromUSCIS({ params: { formCode: "I-1" }, user: { _id: "u", role: "admin" } }, inline.res, (error) => { throw error; });
    assert.equal(inline.out.status, undefined, "plain 200 JSON as before");
    assert.deepEqual([inline.out.body.success, inline.out.body.data.alreadyActive, inline.out.body.data.template.formCode, direct], [true, true, "I-1", 1]);
  } finally {
    pipeline.setServicesForTests(null);
    if (previous === undefined) delete process.env.FORM_PIPELINE_MODE; else process.env.FORM_PIPELINE_MODE = previous;
  }
});
