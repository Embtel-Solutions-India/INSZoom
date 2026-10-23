// Phase 7.8: the ERROR / FAULT simulation. It drives the REAL importer, error-resolution engine, job service, runner and alerter against the fake uscis.gov of
// test-utils/editionSim/fakeUscis.js, on the throwaway database of harness.js. Only the network (globalThis.fetch -> the fake site) and the mailbox (a mocked provider) are replaced.
//
//   runFaultScenario(scenario, { mode })  -> { id, kind, mode, expect, endState, autonomous, held, defects[], notes[], runs, strategies[], emails[], ... }
//     endState: "imported" (autonomous, no human step) | "held" | "dead_letter" | "pending" (still retrying when the attempts ran out of this run) | "skipped:<reason>" | "error:<what>"
//
// Fault kinds: import (a bad download / bad file / missing tool, see faultScenarios.IMPORT_SCENARIOS), lease_loss, worker_kill, repeated_run, migration_fault (a database error at a
// checkpoint of the real case migration; runs through harness.runEditionScenario).
const harness = require("./harness");
const pipelineDb = require("../../../../test-utils/pipelineDb");
const { createFakeUscis } = require("../../../../test-utils/editionSim/fakeUscis");
const faultPdfs = require("../../../../test-utils/editionSim/faultPdfs");
const { IMPORT_SCENARIOS, PIPELINE_FAULTS, MIGRATION_FAULTS, pdfOf, pageOf, slugOf } = require("../../../../test-utils/editionSim/faultScenarios");
const { EDITION_SCENARIOS } = require("../../../../test-utils/editionSim/scenarios");

const USCISFormTemplate = require("../../../../models/USCISFormTemplate");
const FormPipelineJob = require("../../../../models/FormPipelineJob");
const importer = require("../../../uscis-form-import/services/USCISFormImporterService");
const acquisition = require("../../../uscis-form-import/services/OnDemandFormAcquisitionService");
const { fetchOfficialSource } = require("../../../form-edition-policy/OfficialSourceFetcher");
const PDFFieldScannerService = require("../../../uscis-form-import/services/PDFFieldScannerService");
const PdfDownload = require("../../../uscis-form-import/services/PdfDownload");
const { createJobService } = require("../../FormPipelineJobService");
const { createRunner } = require("../../FormPipelineRunner");
const { createAlerter } = require("../../PipelineAlerter");
const { createMemoryStuckStore } = require("../../alerts/stuckStore");
const { createResolver, createMemoryStore, loadCatalog } = require("../../resolution");
const { createImportDeps } = require("../../resolution/importDeps");
const { LIMITS, STAGES } = require("../../pipeline.constants");

const { silent, actor, req, withMode } = harness;
const DEVELOPER = "developer@sim.test";

const makeClock = () => { let t = Date.parse("2026-10-23T09:00:00Z"); return { now: () => new Date(t), advance: (ms) => { t += ms; } }; };
const usedCodes = new Set();
/** A form code shaped like a real one (2-4 digits) that no real form has (ZZ-), unique within the process. */
const randomCode = () => { let code; do code = `ZZ-${Math.floor(1000 + Math.random() * 9000)}`; while (usedCodes.has(code)); usedCodes.add(code); return code; };

let shared = null;
/** The PDFs every scenario can serve (built once per process). */
async function sharedPdfs() {
  if (shared) return shared;
  const base = await require("../../../../test-utils/editionSim/basePdf").buildBaseEdition();
  const qpdf = await require("../../../../utils/ensureQpdf").ensureQpdf().catch(() => null);
  shared = {
    base, xfa: await faultPdfs.buildXfaOnly(), truncated: faultPdfs.truncate(base), password: await faultPdfs.buildPasswordProtected(base, qpdf), qpdf,
    baseFieldCount: (await new PDFFieldScannerService().scan(base)).fields.length,
  };
  return shared;
}

/**
 * The pipeline around the real importer: detect -> import. (map / certify / promote / migrate are proven by the edition scenarios.)
 * With `checkPage` the detect stage reads the form's official page like the real one does; an address failure (404 / 403) goes through the real recoverFormSource (stored address,
 * alias slugs, parent page, stable address, directory), which remembers the verified address on the template; the import stage always uses the address the template holds NOW.
 */
function importExecutor({ code, pdfUrl, record, checkPage = null, oldId = null }) {
  return async (job, context) => {
    await context.stage(STAGES.DETECT, async () => {
      if (!checkPage) return true;
      const fetched = await fetchOfficialSource(checkPage, { accept: "html" });
      if (fetched.ok) return true;
      const failure = `USCIS page fetch failed: ${fetched.status || fetched.error}`;
      const recovered = await acquisition.recoverFormSource({ formCode: code, existing: await USCISFormTemplate.findById(oldId).lean(), failure, pageUrl: checkPage, user: actor, req });
      if (!recovered) throw Object.assign(new Error(failure), { status: fetched.status || 502 });
      return true;
    });
    const address = (oldId && (await USCISFormTemplate.findById(oldId).select("officialPdfUrl").lean())?.officialPdfUrl) || pdfUrl;
    const imported = await context.stage(STAGES.IMPORT, () => importer.importFromUrl({ formCode: code, formType: code, pdfUrl: address, provider: "uscis", source: "system_download" }, actor, req));
    if (record) record(imported);
    return { template: imported.template, versionChanged: false, requiresActivation: true, alreadyActive: false };
  };
}

function build({ code, clock, executor, mode, emails, runnerOptions = {} }) {
  const svc = createJobService({ random: () => 0.5, now: clock.now });
  const deps = {
    email: { isConfigured: () => true, sendTemplateEmail: async (key, payload) => { emails.push({ key, to: payload.to, subject: payload.data?.subject, data: payload.data }); return { sent: true }; } },
    notifications: { createForRoles: async () => [], createNotification: async (payload) => payload },
    logger: silent, describeForm: async () => ({}), listAdmins: async () => [], audit: async () => {}, stuckStore: createMemoryStuckStore(), now: clock.now,
    listStuck: async () => FormPipelineJob.find({ formCode: code, state: { $in: ["held", "dead_letter"] } }).lean(),
  };
  const alerter = createAlerter({ jobService: svc, env: { DEVELOPER_EMAIL: DEVELOPER }, deps });
  const resolver = createResolver({ catalog: loadCatalog({ log: silent }), store: createMemoryStore(), log: silent, diagnoseDeps: { configuredToolPath: () => require("../../../../config/env").qpdfPath } });
  const runner = createRunner({
    jobService: svc, alerter, executor, resolver, resolverDeps: createImportDeps(), autonomyMode: () => mode, logger: silent, heartbeatMs: 1e9,
    promotionLock: async (_code, fn) => ({ ran: true, value: await fn() }), ...runnerOptions,
  });
  return { svc, runner, alerter };
}

/** Claims and runs the job until it is finished (done / held / dead_letter) or `maxRuns` runs have happened; the clock jumps over every backoff. */
async function drive({ svc, runner, jobId, clock, maxRuns = LIMITS.maxAttempts }) {
  const outcomes = [];
  for (let run = 0; run < maxRuns; run += 1) {
    const claim = await svc.claimById(jobId);
    if (!claim) { clock.advance(LIMITS.backoffMaxMs + 1000); const again = await svc.claimById(jobId); if (!again) break; outcomes.push(await runner.run({ ...again, actor, req })); }
    else outcomes.push(await runner.run({ ...claim, actor, req }));
    const job = await svc.get(jobId);
    if (!["pending", "running"].includes(job.state)) break;
    clock.advance(LIMITS.backoffMaxMs + 1000);
  }
  return outcomes;
}

const stuckMails = (emails) => emails.filter((mail) => mail.key === "form-pipeline-stuck");

function baseResult(scenario, mode) {
  return { id: scenario.id, label: scenario.label, kind: scenario.kind || "import", mode, expect: scenario.expect, knownDefect: scenario.knownDefect || null, endState: "error:setup", autonomous: false, held: false, loss: 0, corruption: 0, defects: [], notes: [], runs: 0, strategies: [], emails: [], durationMs: 0 };
}

async function finish(result, started, expectOverride) {
  result.durationMs = Date.now() - started;
  const expect = expectOverride || result.expect;
  result.autonomous = result.endState === "imported" && !result.defects.length;
  result.held = result.endState === "held" || result.endState === "dead_letter";
  // the expectations describe the engine ON; with it off or in shadow the same scenario is only a baseline (reported, never judged)
  result.matchesExpectation = result.mode !== "on" ? null : !String(result.endState).startsWith("skipped") && !result.defects.length && (expect === "autonomous" ? result.endState === "imported" : result.held);
  return result;
}

// ----- an import scenario ----------------------------------------------------------------------------------------------------------------------------------------------------------
async function runImportScenario(scenario, { mode = "on" } = {}) {
  const started = Date.now();
  const result = baseResult(scenario, mode);
  const pdfs = await sharedPdfs();
  if (scenario.needsPassword && !pdfs.password) { result.endState = "skipped: qpdf is not installed, so no password-protected PDF can be built"; result.matchesExpectation = null; result.durationMs = Date.now() - started; return result; }
  const code = scenario.formCode || randomCode();
  const slug = slugOf(code);
  const setup = scenario.setup({ code, ...pdfs });
  const site = createFakeUscis(setup.routes);
  const undo = [];
  const savedFetch = globalThis.fetch;
  const savedRetryDelay = process.env.USCIS_PDF_DOWNLOAD_RETRY_DELAY_MS;
  try {
    if (scenario.prepare) undo.push(await scenario.prepare());
    process.env.USCIS_PDF_DOWNLOAD_RETRY_DELAY_MS = "0";
    globalThis.fetch = site.fetchImpl; // the importer, the hardened fetcher and the source resolver all reach uscis.gov through this
    PdfDownload.clearHints();
    const pdfUrl = setup.staleUrl || pdfOf(slug);
    await forgetForm(code);
    const old = await USCISFormTemplate.create({
      formCode: code, title: `${code} (old edition)`, version: "2024-01-01", editionDate: new Date("2024-01-01T00:00:00Z"), status: "active", activeFlag: true, lastChecked: new Date(0),
      officialPdfUrl: pdfUrl, lifecycle: { provider: "uscis", sourcePdfUrl: pdfUrl, sourcePageUrl: setup.staleUrl ? undefined : pageOf(slug) },
    });
    const clock = makeClock();
    const emails = [];
    let imported = null;
    await withMode(mode, async () => {
      const { svc, runner } = build({ code, clock, emails, mode, executor: importExecutor({ code, pdfUrl, checkPage: setup.checkPage, oldId: old._id, record: (value) => { imported = value; } }) });
      const { job } = await svc.enqueue({ formCode: code, trigger: "catalog_sync", options: { forceCheck: true } });
      const outcomes = await drive({ svc, runner, jobId: job._id, clock });
      result.runs = outcomes.length;
      const saved = await svc.get(job._id);
      result.endState = saved.state === "done" ? "imported" : saved.state;
      result.strategies = (saved.resolutions || []).map((item) => `${item.strategy}:${item.ok ? (item.verified ? "ok" : "ran") : "no"}`);
      result.hold = saved.hold ? { code: saved.hold.reasonCode, stage: saved.hold.stage, detail: String(saved.hold.detail || "").slice(0, 160) } : null;
      result.lastError = saved.lastError ? `${saved.lastError.class}/${saved.lastError.code}: ${String(saved.lastError.message || "").slice(0, 140)}` : null;
      result.stages = Object.fromEntries(Object.entries(saved.stages || {}).map(([name, stage]) => [name, stage.status]));
    });
    result.emails = emails.map((mail) => ({ key: mail.key, to: mail.to }));
    // what the run left behind
    const templates = await USCISFormTemplate.find({ formCode: code }).lean();
    const oldNow = templates.find((item) => String(item._id) === String(old._id));
    const created = templates.filter((item) => String(item._id) !== String(old._id));
    if (oldNow.status !== "active" || oldNow.version !== "2024-01-01") result.defects.push({ step: "live_edition", error: "the live edition was changed by a run that did not release anything" });
    if (result.endState === "imported") {
      const stored = created.find((item) => item.version === "2025-01-01" || item.formFields?.length);
      if (!stored) result.defects.push({ step: "import", error: "the job says imported but no new edition was stored" });
      else if (stored.formFields.length !== pdfs.baseFieldCount) result.defects.push({ step: "import", error: `the stored edition has ${stored.formFields.length} boxes, the PDF has ${pdfs.baseFieldCount}` });
      if (created.length > 1) result.defects.push({ step: "import", error: `${created.length} editions were stored for one run` });
      if (stuckMails(emails).length) result.defects.push({ step: "alert", error: "a 'stuck' e-mail was sent for a form that was fixed automatically" });
      if (setup.checkPage && setup.staleUrl && oldNow.officialPdfUrl === setup.staleUrl) result.defects.push({ step: "remember", error: "the verified address was not remembered on the template (the next sync would fail the same way)" });
    } else if (result.endState === "held" || result.endState === "dead_letter") {
      if (result.endState === "dead_letter") result.defects.push({ step: "dead_letter", error: `the job was dead-lettered instead of held with a documented reason (${result.lastError})` });
      if (created.length) result.defects.push({ step: "import", error: `a held form left ${created.length} half-imported edition(s) behind` });
      const mails = stuckMails(emails);
      if (mails.length !== 1) result.defects.push({ step: "alert", error: `expected exactly one developer e-mail for the hold, got ${mails.length}` });
      else if (mails[0].to !== DEVELOPER) result.defects.push({ step: "alert", error: `the e-mail went to ${mails[0].to}, not the developer address` });
      else if (!JSON.stringify(mails[0].data).includes(code)) result.defects.push({ step: "alert", error: "the developer e-mail does not name the form" });
      if (!result.hold) result.defects.push({ step: "hold", error: "the job is held but no documented reason is recorded" });
      else if (scenario.holdCode && !new RegExp(`^(${scenario.holdCode})$`).test(result.hold.code)) result.defects.push({ step: "hold", error: `the hold is labelled ${result.hold.code}, expected ${scenario.holdCode} (${result.lastError})` });
    }
    result.hits = site.hits.all ? Object.keys(site.hits.all()).length : undefined;
  } catch (error) {
    result.endState = "error:run";
    result.defects.push({ step: "run", error: String(error.stack || error.message).split("\n").slice(0, 3).join(" | ") });
  } finally {
    globalThis.fetch = savedFetch;
    if (savedRetryDelay === undefined) delete process.env.USCIS_PDF_DOWNLOAD_RETRY_DELAY_MS; else process.env.USCIS_PDF_DOWNLOAD_RETRY_DELAY_MS = savedRetryDelay;
    for (const restore of undo.reverse()) await Promise.resolve(restore()).catch(() => null);
    PdfDownload.clearHints();
    await forgetForm(code).catch(() => null);
  }
  return finish(result, started);
}

// ----- the pipeline faults ---------------------------------------------------------------------------------------------------------------------------------------------------------
async function withSite(fn) {
  const pdfs = await sharedPdfs();
  const code = randomCode();
  const slug = slugOf(code);
  const site = createFakeUscis({ [pageOf(slug)]: { html: faultPdfs.page(faultPdfs.link(`/sites/default/files/document/forms/${slug}.pdf`, `Form ${code}`)) }, [pdfOf(slug)]: { pdf: pdfs.base } });
  const savedFetch = globalThis.fetch;
  const savedDelay = process.env.USCIS_PDF_DOWNLOAD_RETRY_DELAY_MS;
  process.env.USCIS_PDF_DOWNLOAD_RETRY_DELAY_MS = "0";
  globalThis.fetch = site.fetchImpl;
  PdfDownload.clearHints();
  try {
    const pdfUrl = pdfOf(slug);
    await forgetForm(code);
    const old = await USCISFormTemplate.create({ formCode: code, title: `${code} (old edition)`, version: "2024-01-01", editionDate: new Date("2024-01-01T00:00:00Z"), status: "active", activeFlag: true, lastChecked: new Date(0), officialPdfUrl: pdfUrl, lifecycle: { provider: "uscis", sourcePdfUrl: pdfUrl, sourcePageUrl: pageOf(slug) } });
    return await fn({ code, pdfUrl, old, pdfs });
  } finally {
    await forgetForm(code).catch(() => null);
    globalThis.fetch = savedFetch;
    if (savedDelay === undefined) delete process.env.USCIS_PDF_DOWNLOAD_RETRY_DELAY_MS; else process.env.USCIS_PDF_DOWNLOAD_RETRY_DELAY_MS = savedDelay;
    PdfDownload.clearHints();
  }
}

/** Removes everything a scenario created for its form code from the throwaway database (a fixed code such as I-485J is reused by the next mode's run). */
async function forgetForm(code) {
  await USCISFormTemplate.deleteMany({ formCode: code });
  await FormPipelineJob.deleteMany({ formCode: code });
}

async function editionsOf(code) { return USCISFormTemplate.find({ formCode: code, version: { $ne: "2024-01-01" } }).lean(); }

async function runLeaseLoss(scenario, { mode = "on" } = {}) {
  const started = Date.now();
  const result = baseResult(scenario, mode);
  try {
    await withSite(async ({ code, pdfUrl }) => {
      await withMode(mode, async () => {
        const clock = makeClock();
        const emails = [];
        let secondWorker = null;
        // worker A: imports, then STALLS (its lease runs out and worker B takes the job and finishes it) before A's next write
        const stalling = async (job, context) => {
          await context.stage(STAGES.DETECT, async () => true);
          const imported = await context.stage(STAGES.IMPORT, async () => {
            const value = await importer.importFromUrl({ formCode: code, formType: code, pdfUrl, provider: "uscis" }, actor, req);
            clock.advance(LIMITS.leaseMs + 5000);
            const { svc, runner } = secondWorker;
            await svc.recoverExpired();
            clock.advance(LIMITS.backoffMaxMs + 1000);
            const claim = await svc.claimNext({ workerId: "worker-B" });
            if (!claim) throw new Error("the second worker could not take over the job");
            result.secondWorker = await runner.run({ ...claim, actor, req });
            return value;
          });
          return { template: imported.template, versionChanged: false, requiresActivation: true, alreadyActive: false };
        };
        const a = build({ code, clock, emails, mode, executor: stalling });
        secondWorker = build({ code, clock, emails, mode, executor: importExecutor({ code, pdfUrl }) });
        const { job } = await a.svc.enqueue({ formCode: code, trigger: "catalog_sync" });
        const claim = await a.svc.claimById(job._id, { workerId: "worker-A" });
        const first = await a.runner.run({ ...claim, actor, req });
        result.runs = 2;
        const saved = await a.svc.get(job._id);
        result.endState = saved.state === "done" ? "imported" : saved.state;
        if (first.state !== "lease_lost") result.defects.push({ step: "lease", error: `the stalled worker ended as "${first.state}", not lease_lost (it must stop without writing)` });
        if (result.secondWorker?.state !== "done") result.defects.push({ step: "takeover", error: `the second worker ended as "${result.secondWorker?.state}"` });
        if (saved.lease?.workerId !== "worker-B") result.defects.push({ step: "lease", error: `the job is owned by ${saved.lease?.workerId}` });
        if (saved.stages?.import?.status !== "done") result.defects.push({ step: "stages", error: `import stage is "${saved.stages?.import?.status}"` });
        const stored = await editionsOf(code);
        if (stored.length !== 1) result.defects.push({ step: "import", error: `${stored.length} editions stored (expected exactly 1: the second worker found the first worker's edition)` });
        if (stuckMails(emails).length) result.defects.push({ step: "alert", error: "a stuck e-mail was sent" });
        result.emails = emails.map((mail) => ({ key: mail.key }));
        result.notes.push(`attempts=${saved.attempts}, fence=${saved.lease?.fence}`);
      });
    });
  } catch (error) {
    result.endState = "error:run";
    result.defects.push({ step: "run", error: String(error.stack || error.message).split("\n").slice(0, 3).join(" | ") });
  }
  return finish(result, started);
}

async function runWorkerKill(scenario, { mode = "on" } = {}) {
  const started = Date.now();
  const result = baseResult(scenario, mode);
  try {
    await withSite(async ({ code, pdfUrl }) => {
      await withMode(mode, async () => {
        const clock = makeClock();
        const emails = [];
        let importedFirst;
        const stored = new Promise((resolve) => { importedFirst = resolve; });
        // worker A: imports (the edition is stored), then the process dies: it never answers, never heartbeats, never writes again
        const dying = async (job, context) => {
          await context.stage(STAGES.DETECT, async () => true);
          await context.stage(STAGES.IMPORT, async () => { await importer.importFromUrl({ formCode: code, formType: code, pdfUrl, provider: "uscis" }, actor, req); importedFirst(); await new Promise(() => {}); });
        };
        const a = build({ code, clock, emails, mode, executor: dying });
        const b = build({ code, clock, emails, mode, executor: importExecutor({ code, pdfUrl }) });
        const { job } = await a.svc.enqueue({ formCode: code, trigger: "catalog_sync" });
        const claim = await a.svc.claimById(job._id, { workerId: "worker-A" });
        a.runner.run({ ...claim, actor, req }).catch(() => null); // never settles: the "process" is gone
        await stored;
        clock.advance(LIMITS.leaseMs + 5000);
        const recovered = await b.svc.recoverExpired();
        if (recovered.requeued !== 1) result.defects.push({ step: "recover", error: `recoverExpired requeued ${recovered.requeued} jobs, expected 1` });
        clock.advance(LIMITS.backoffMaxMs + 1000);
        const take = await b.svc.claimNext({ workerId: "worker-B" });
        if (!take) throw new Error("the job was not claimable after recovery");
        const outcome = await b.runner.run({ ...take, actor, req });
        result.runs = 2;
        const saved = await b.svc.get(job._id);
        result.endState = saved.state === "done" ? "imported" : saved.state;
        if (outcome.state !== "done") result.defects.push({ step: "takeover", error: `the recovering worker ended as "${outcome.state}"` });
        const editions = await editionsOf(code);
        if (editions.length !== 1) result.defects.push({ step: "import", error: `${editions.length} editions stored after the recovery (expected exactly 1)` });
        if (stuckMails(emails).length) result.defects.push({ step: "alert", error: "a stuck e-mail was sent" });
        result.emails = emails.map((mail) => ({ key: mail.key }));
        result.notes.push(`attempts=${saved.attempts}`);
      });
    });
  } catch (error) {
    result.endState = "error:run";
    result.defects.push({ step: "run", error: String(error.stack || error.message).split("\n").slice(0, 3).join(" | ") });
  }
  return finish(result, started);
}

async function runRepeated(scenario, { mode = "on" } = {}) {
  const started = Date.now();
  const result = baseResult(scenario, mode);
  try {
    await withSite(async ({ code, pdfUrl }) => {
      await withMode(mode, async () => {
        const clock = makeClock();
        const emails = [];
        const { svc, runner } = build({ code, clock, emails, mode, executor: importExecutor({ code, pdfUrl }) });
        const snapshot = async () => JSON.stringify((await editionsOf(code)).map((item) => [String(item._id), item.version, item.status, item.formFields.length, String(item.updatedAt)]));
        const first = await svc.enqueue({ formCode: code, trigger: "catalog_sync" });
        await drive({ svc, runner, jobId: first.job._id, clock });
        const after1 = await snapshot();
        const second = await svc.enqueue({ formCode: code, trigger: "catalog_sync" });
        await drive({ svc, runner, jobId: second.job._id, clock });
        const after2 = await snapshot();
        const finalJobs = await FormPipelineJob.find({ formCode: code }).lean();
        result.runs = 2;
        result.endState = finalJobs.every((item) => item.state === "done") ? "imported" : finalJobs.map((item) => item.state).join("+");
        if (String(first.job._id) === String(second.job._id)) result.defects.push({ step: "jobs", error: "the second run reused the finished job" });
        if (after1 !== after2) result.defects.push({ step: "idempotent", error: "the second run changed the stored editions" });
        if (JSON.parse(after2).length !== 1) result.defects.push({ step: "import", error: `${JSON.parse(after2).length} editions stored for one PDF` });
        result.emails = emails.map((mail) => ({ key: mail.key }));
      });
    });
  } catch (error) {
    result.endState = "error:run";
    result.defects.push({ step: "run", error: String(error.stack || error.message).split("\n").slice(0, 3).join(" | ") });
  }
  return finish(result, started);
}

async function runMigrationFault(scenario, { mode = "on", recorder } = {}) {
  const started = Date.now();
  const result = baseResult(scenario, mode);
  const edition = await harness.runEditionScenario(EDITION_SCENARIOS[0], { mode, recorder, migrationFault: scenario.at });
  Object.assign(result, { endState: edition.endState === "released" ? "imported" : edition.endState, loss: edition.loss, corruption: edition.corruption, fault: edition.fault, idempotent: edition.idempotent, defects: edition.defects, notes: edition.notes });
  if (edition.fault && !edition.fault.injected) result.defects.push({ step: "fault", error: "the fault was not injected" });
  if (!edition.idempotent) result.defects.push({ step: "idempotent", error: "a second run changed the case form" });
  if (edition.loss || edition.corruption) result.defects.push({ step: "data", error: `loss ${edition.loss}, corruption ${edition.corruption}` });
  return finish(result, started);
}

const RUNNERS = { import: runImportScenario, lease_loss: runLeaseLoss, worker_kill: runWorkerKill, repeated_run: runRepeated, migration_fault: runMigrationFault };
const FAULT_SCENARIOS = [...IMPORT_SCENARIOS.map((item) => ({ ...item, kind: "import" })), ...PIPELINE_FAULTS, ...MIGRATION_FAULTS];

/** Runs one fault scenario of any kind. Never throws. */
async function runFaultScenario(scenario, options = {}) {
  const run = RUNNERS[scenario.kind || "import"];
  if (!run) return { id: scenario.id, endState: `error:unknown kind ${scenario.kind}`, defects: [{ step: "setup", error: "unknown scenario kind" }], matchesExpectation: false };
  try { return await run(scenario, options); } catch (error) { return { ...baseResult(scenario, options.mode || "on"), endState: "error:run", defects: [{ step: "run", error: String(error.message) }], matchesExpectation: false }; }
}

module.exports = { runFaultScenario, FAULT_SCENARIOS, sharedPdfs, DEVELOPER };
