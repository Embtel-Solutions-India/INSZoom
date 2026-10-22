// Catalog sync: looks at EVERY standalone form USCIS publishes (the all-forms directory - including forms the software does not have yet), compares each
// form's published edition with the edition installed here, and runs the existing automatic import pipeline for every form that is new or whose edition differs
// (e.g. installed I-589 01/04/2026 vs published 04/09/2026). Pure code, no manual step, no AI.
//
// What "the pipeline" does for each candidate (OnDemandFormAcquisitionService.ensureCurrentUSCISForm -> activateOrPromote): fetch (retried) -> qpdf normalize
// (decrypt / XFA) -> import to storage -> edition-match -> carry the earlier edition's mapping forward, apply authored rules, or infer the filer's identity
// fields -> scope to the visa types the registry assigns -> certification (mapping valid, fillable, filled-not-blank, viewer/download, components slice) ->
// ONLY THEN promote the edition and migrate open cases with every saved value (nothing dropped). If anything fails or certification does not pass, the
// installed edition keeps serving untouched and the form is retried on the next run.
//
// Bounded per run (MAX_FORMS_PER_RUN) so one cycle never runs for hours; edition-changed forms already in the software go first, brand-new forms next. Whatever is
// left over is simply picked up by the next run (the selection is recomputed every time, so nothing is ever forgotten).
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const logger = require("../../../utils/logger");
const autonomyConfig = require("../../../config/formPipelineAutonomy");
const { isStandaloneFormCode } = require("../config/formCodePattern");
const EditionAuthority = require("./EditionAuthority");
const importPolicy = require("../config/importPolicy");

const STANDALONE = /^[A-Z]{1,3}-\d+[A-Z]?$/;
const sameDay = (a, b) => Boolean(a && b) && new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);

// Decides what to do with one published form given what is installed. Pure.
//   published: { formCode, editionDate|null }   installed: the active template (or null)
function classify(published, installed, options = {}) {
  const mode = options.mode || autonomyConfig.mode();
  if (mode === "off") return classifyLegacy(published, installed);
  const next = classifyShared(published, installed);
  if (mode === "shadow") {
    const current = classifyLegacy(published, installed);
    if (current.action !== next.action) logger.warn("uscis_catalog_sync_would_classify_differently", { formCode: published.formCode, current: current.action, would: next.action, reason: next.reason });
    return current;
  }
  return next;
}

/** Phase 7.2 (FORM_PIPELINE_AUTONOMY=on). One code pattern; the edition is "new" only when LATER (an older or future page date never triggers an import); the same edition with a different official PDF file is a "revision". */
function classifyShared(published, installed) {
  if (!isStandaloneFormCode(published.formCode, "sync", "on")) return { action: "skip", reason: "not a standalone form" };
  if (!installed) return { action: "import_new", reason: "not in the software" };
  if (!published.editionDate) return { action: "skip", reason: "published edition unknown" };
  const installedDate = installed.importMetadata?.publishedEditionDate || installed.editionDate;
  if (!installedDate) return { action: "check_edition", reason: "installed edition date unknown" };
  const decided = EditionAuthority.decide({ pageEditionDate: published.editionDate, storedEditionDate: installedDate });
  if (decided.status === "none") return { action: "skip", reason: "published edition date is in the future, so it is not the edition in force" };
  const day = (value) => new Date(value).toISOString().slice(0, 10);
  if (decided.status === "new") return { action: "upgrade", reason: `installed ${day(installedDate)} vs published ${day(published.editionDate)}` };
  const installedSha = installed.lifecycle?.sourceChecksum || installed.importMetadata?.checksum;
  if (published.pdfSha256 && installedSha && published.pdfSha256 !== installedSha) return { action: "revision", reason: "same edition, but the official PDF file differs from the one imported" };
  return decided.status === "older"
    ? { action: "up_to_date", reason: `installed edition ${day(installedDate)} is newer than the ${day(published.editionDate)} the page lists` }
    : { action: "up_to_date", reason: "same edition" };
}

function classifyLegacy(published, installed) {
  if (!STANDALONE.test(published.formCode)) return { action: "skip", reason: "not a standalone form" };
  if (!installed) return { action: "import_new", reason: "not in the software" };
  if (!published.editionDate) return { action: "skip", reason: "published edition unknown" };
  // like with like: the page's date recorded at import (importMetadata.publishedEditionDate) is compared with the page; older records fall back to editionDate
  const installedDate = installed.importMetadata?.publishedEditionDate || installed.editionDate;
  if (!installedDate) return { action: "check_edition", reason: "installed edition date unknown" };
  return sameDay(published.editionDate, installedDate)
    ? { action: "up_to_date", reason: "same edition" }
    : { action: "upgrade", reason: `installed ${new Date(installedDate).toISOString().slice(0, 10)} vs published ${new Date(published.editionDate).toISOString().slice(0, 10)}` };
}

function defaultDeps() {
  const USCISScannerService = require("../../uscis-lifecycle/services/USCISScannerService");
  const Acquisition = require("./OnDemandFormAcquisitionService");
  return {
    // Phase 7.1: the newest job per form that failed or waits (read-only, light projection)
    async recentJobs(formCodes) {
      const FormPipelineJob = require("../../../models/FormPipelineJob");
      const rows = await FormPipelineJob.find({ formCode: { $in: formCodes }, $or: [{ state: { $in: ["blocked", "held", "dead_letter"] } }, { "lastError.at": { $gte: new Date(Date.now() - 2 * DAY_MS) } }] })
        .select("formCode editionKey state lastError.at updatedAt").sort({ updatedAt: -1 }).limit(500).lean();
      return rows.map((row) => ({ formCode: row.formCode, editionKey: row.editionKey, state: row.state, hasError: Boolean(row.lastError?.at), at: row.lastError?.at || row.updatedAt }));
    },
    // every standalone form code the directory lists (all pages), with whatever edition date the listing shows
    async listPublishedForms({ maxPages }) {
      const root = USCISScannerService.OFFICIAL_SOURCES?.formsDirectoryUrl || "https://www.uscis.gov/forms/all-forms";
      const queue = [root];
      const seen = new Set();
      const forms = new Map();
      while (queue.length && seen.size < maxPages) {
        const url = queue.shift();
        if (seen.has(url)) continue;
        seen.add(url);
        const html = await USCISScannerService.fetchPage(url);
        USCISScannerService.directoryPageUrls(html, url).forEach((next) => { if (!seen.has(next)) queue.push(next); });
        for (const item of USCISScannerService.extractDirectoryForms(html, url)) {
          const current = forms.get(item.formCode);
          if (!current || (!current.editionDate && item.editionDate)) forms.set(item.formCode, { formCode: item.formCode, editionDate: item.editionDate || null, pageUrl: item.pageUrl, pdfUrl: item.pdfUrl });
        }
      }
      return [...forms.values()];
    },
    // the form's own page is authoritative for its current edition (the directory listing often omits it)
    async publishedEdition(formCode) {
      // Phase 7.E: the form's real page when USCIS publishes it under another address (I-485J -> /i-485supj); otherwise the code-derived address as before
      const pageUrl = require("../config/formSourceAliases").pageUrlFor(formCode) || `https://www.uscis.gov/${formCode.toLowerCase()}`;
      const html = await USCISScannerService.fetchPage(pageUrl);
      return USCISScannerService.extractFormPageMetadata(html, pageUrl, formCode).editionDate || null;
    },
    async installedTemplate(formCode) {
      const projection = autonomyConfig.mode() === "off" ? "formCode version editionDate importMetadata.publishedEditionDate" : "formCode version editionDate importMetadata.publishedEditionDate importMetadata.checksum lifecycle.sourceChecksum";
      return USCISFormTemplate.findOne({ formCode, status: "active" }).sort({ editionDate: -1 }).select(projection).lean();
    },
    // Phase 7.2: every form code the form registry knows (read-only); only asked for when the import policy needs it
    async registryCodes() {
      const VisaFormMapping = require("../../../models/VisaFormMapping");
      const rows = await VisaFormMapping.find({}).select("formNumber formTemplateFormCode parentForm").lean();
      return new Set(rows.flatMap((row) => [row.formNumber, row.formTemplateFormCode, row.parentForm]).filter(Boolean).map((code) => String(code).toUpperCase().replace(/\s+/g, "")));
    },
    // Phase 7.2: sha256 of the OFFICIAL PDF the form's page links to (same kind as the stored raw-download checksum); null when it cannot be fetched
    async officialPdfFingerprint(formCode) {
      const pageUrl = require("../config/formSourceAliases").pageUrlFor(formCode) || `https://www.uscis.gov/${formCode.toLowerCase()}`;
      const html = await USCISScannerService.fetchPage(pageUrl);
      const meta = USCISScannerService.extractFormPageMetadata(html, pageUrl, formCode);
      if (!meta.pdfUrl) return null;
      return { pdfUrl: meta.pdfUrl, sha256: await USCISScannerService.fetchPdfSha256(meta.pdfUrl) };
    },
    async stampPublishedEdition(formCode, editionDate) {
      await USCISFormTemplate.updateOne({ formCode, status: "active", "importMetadata.publishedEditionDate": { $exists: false } }, { $set: { "importMetadata.publishedEditionDate": editionDate } });
    },
    // through the durable pipeline (Phase 1): recorded as a job; in the default inline mode the caller gets exactly the result it always did
    importForm: (formCode, user, req) => require("../../form-pipeline/FormPipeline").runForm({
      formCode, trigger: "catalog_sync", user, req, options: { forceCheck: true }, direct: () => Acquisition.ensureCurrentUSCISForm(formCode, user, req, { forceCheck: true }),
    }),
  };
}

async function inBatches(items, size, task) {
  const out = [];
  for (let index = 0; index < items.length; index += size) out.push(...await Promise.all(items.slice(index, index + size).map(task)));
  return out;
}

const DAY_MS = 86400000;
const isoDay = (value) => { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : ""; };

/**
 * Pure. Splits candidates into those worth queueing and those that would only repeat a failure (Phase 7.1 failure memory). A candidate is skipped when a pipeline
 * job for the SAME form and edition date is blocked / held / dead-letter, or already failed within `triedWithinMs`. `jobs` are light job rows
 * ({ formCode, editionKey, state, lastErrorAt|updatedAt, hasError }).
 */
function applyFailureMemory(candidates, jobs, { now = Date.now(), triedWithinMs = 6 * 3600000 } = {}) {
  const keep = [];
  const skipped = [];
  for (const item of candidates) {
    const day = isoDay(item.editionDate);
    const match = (jobs || []).find((job) => job.formCode === item.formCode && (!day || String(job.editionKey || "").split("|")[1] === day));
    if (match && ["blocked", "held", "dead_letter"].includes(match.state)) { skipped.push({ formCode: item.formCode, reason: `job ${match.state} for this edition` }); continue; }
    if (match && match.hasError && match.at && now - new Date(match.at).getTime() < triedWithinMs) { skipped.push({ formCode: item.formCode, reason: "this edition failed recently" }); continue; }
    keep.push(item);
  }
  return { keep, skipped };
}

// options: { user, req, dryRun, maxFormsPerRun, maxPages, concurrency, only: [codes], timeBudgetMs }, deps override for tests
async function runCatalogSync(options = {}, deps = defaultDeps()) {
  const maxFormsPerRun = Number(options.maxFormsPerRun || process.env.USCIS_CATALOG_MAX_FORMS_PER_RUN || 15);
  const maxPages = Number(options.maxPages || process.env.USCIS_SYNC_MAX_PAGES || 30);
  const startedAt = Date.now();
  const published = (await deps.listPublishedForms({ maxPages })).filter((form) => !options.only?.length || options.only.includes(form.formCode));

  // classify every form (cheap: one page fetch for forms already installed whose listing shows no edition)
  const classified = await inBatches(published, Number(options.concurrency || 4), async (form) => {
    try {
      const installed = await deps.installedTemplate(form.formCode);
      let edition = form.editionDate;
      if (installed && !edition) edition = await deps.publishedEdition(form.formCode).catch(() => null);
      let published = { ...form, editionDate: edition };
      let decision = classify(published, installed);
      // Phase 7.2: a form on the SAME edition may still have a new official PDF file (a silent revision): compare file fingerprints of the same kind
      if (autonomyConfig.mode() === "on" && decision.action === "up_to_date" && installed && deps.officialPdfFingerprint && options.revisionCheck !== false && String(process.env.FORM_CATALOG_REVISION_CHECK || "true").toLowerCase() !== "false" && (installed.lifecycle?.sourceChecksum || installed.importMetadata?.checksum)) {
        const fingerprint = await deps.officialPdfFingerprint(form.formCode).catch(() => null);
        if (fingerprint?.sha256) { published = { ...published, pdfSha256: fingerprint.sha256 }; decision = classify(published, installed); }
      }
      return { ...form, editionDate: edition, installed, ...decision };
    } catch (error) {
      return { ...form, action: "error", reason: error.message };
    }
  });
  const upgrades = classified.filter((item) => item.action === "upgrade" || item.action === "check_edition");
  let news = classified.filter((item) => item.action === "import_new");
  // Phase 7.2 import policy (FORM_CATALOG_IMPORT_POLICY, default "all" = today's behavior): a form the software never had is imported only when the policy allows it. off: nothing changes; shadow: logged only
  const mode = autonomyConfig.mode();
  let discoveredNotImported = [];
  if (mode !== "off" && news.length && importPolicy.policyOf() !== "all") {
    try {
      const registry = importPolicy.policyOf() === "registry" && deps.registryCodes ? await deps.registryCodes() : null;
      const decisions = news.map((item) => ({ item, ...importPolicy.shouldImport({ formCode: item.formCode, installed: false, registry }) }));
      discoveredNotImported = decisions.filter((entry) => !entry.import).map((entry) => ({ formCode: entry.item.formCode, edition: entry.item.editionDate ? isoDay(entry.item.editionDate) : null, reason: entry.reason }));
      if (discoveredNotImported.length) logger.warn(mode === "on" ? "uscis_catalog_sync_discovered_not_imported" : "uscis_catalog_sync_would_not_import", { mode, policy: importPolicy.policyOf(), forms: discoveredNotImported });
      if (mode === "on") news = decisions.filter((entry) => entry.import).map((entry) => entry.item);
    } catch (error) {
      logger.warn("uscis_catalog_sync_import_policy_unavailable", { error: error.message }); // never blocks the sync: everything stays eligible
      discoveredNotImported = [];
    }
  }
  // same edition, different official PDF file: detected and reported. It is queued only when the import path can act on it (deps.supportsRevisionImport) - until then a queued job would find "no change" every run
  const revisions = classified.filter((item) => item.action === "revision");
  if (revisions.length) logger.warn("uscis_catalog_sync_revisions_detected", { forms: revisions.map((item) => item.formCode) });
  const queuedRevisions = deps.supportsRevisionImport ? revisions : [];
  const candidates = [...upgrades, ...queuedRevisions, ...news];
  // Phase 7.1 failure memory: forms that would only repeat a known failure must not occupy the per-run slots (FORM_PIPELINE_AUTONOMY: off = unchanged, shadow = log only, on = applied)
  const autonomy = require("../../../config/formPipelineAutonomy").mode();
  let memorySkipped = [];
  let queue;
  if (autonomy !== "off" && deps.recentJobs) {
    try {
      const memory = applyFailureMemory(candidates, await deps.recentJobs(candidates.map((item) => item.formCode)), { triedWithinMs: Number(options.triedWithinHours || process.env.FORM_PIPELINE_RETRY_AFTER_HOURS || 6) * 3600000 });
      memorySkipped = memory.skipped;
      if (memorySkipped.length) logger.warn(autonomy === "on" ? "uscis_catalog_sync_skipped_known_failures" : "uscis_catalog_sync_would_skip_known_failures", { mode: autonomy, skipped: memorySkipped });
      queue = (autonomy === "on" ? memory.keep : candidates).slice(0, maxFormsPerRun);
    } catch (error) {
      logger.warn("uscis_catalog_sync_failure_memory_unavailable", { error: error.message }); // never blocks the sync
      queue = candidates.slice(0, maxFormsPerRun);
    }
  } else {
    queue = candidates.slice(0, maxFormsPerRun);
  }
  const summary = {
    published: published.length,
    upToDate: classified.filter((item) => item.action === "up_to_date").length,
    upgradesFound: upgrades.length,
    newFormsFound: news.length,
    ...(mode !== "off" ? { discoveredNotImported, revisionsDetected: revisions.map((item) => item.formCode) } : {}),
    queued: queue.map((item) => `${item.formCode}(${item.action})`),
    deferred: Math.max(upgrades.length + queuedRevisions.length + news.length - queue.length - (autonomy === "on" ? memorySkipped.length : 0), 0),
    skippedKnownFailures: memorySkipped,
    autonomy,
    skipped: classified.filter((item) => item.action === "skip").length,
    // every form already in the software, with both editions side by side
    installedComparison: classified.filter((item) => item.installed).map((item) => ({ formCode: item.formCode, installed: (item.installed.importMetadata?.publishedEditionDate || item.installed.editionDate) ? new Date(item.installed.importMetadata?.publishedEditionDate || item.installed.editionDate).toISOString().slice(0, 10) : item.installed.version || null, published: item.editionDate ? new Date(item.editionDate).toISOString().slice(0, 10) : null, action: item.action, reason: item.reason })),
    errors: classified.filter((item) => item.action === "error").map((item) => `${item.formCode}: ${item.reason}`),
    results: [],
  };
  if (options.dryRun) return { ...summary, dryRun: true, ms: Date.now() - startedAt };

  const req = options.req || { ip: "system", headers: {} };
  const timeBudgetMs = autonomy === "on" ? Number(options.timeBudgetMs || process.env.USCIS_CATALOG_TIME_BUDGET_MS || 45 * 60000) : Infinity;
  for (const item of queue) { // sequential: one form's failure can never affect another
    if (Date.now() - startedAt > timeBudgetMs) { // a run can never go on forever: the rest is picked up by the next run
      summary.results.push({ formCode: item.formCode, action: item.action, outcome: "deferred", detail: "time budget used up" });
      continue;
    }
    try {
      const result = await deps.importForm(item.formCode, options.user, req);
      if (result?.queued) { // FORM_PIPELINE_MODE=queued: the worker does the work; the next run sees the outcome
        summary.results.push({ formCode: item.formCode, action: item.action, outcome: "queued", detail: `job ${result.jobId}` });
        logger.info("uscis_catalog_sync_form", summary.results.at(-1));
        continue;
      }
      // an edition check that found nothing new proves the installed edition IS the published one: record the page's date so it compares normally from now on
      if ((item.action === "check_edition" || item.action === "upgrade") && result?.alreadyActive && !result?.versionChanged && !result?.checkError && item.editionDate && deps.stampPublishedEdition) await deps.stampPublishedEdition(item.formCode, item.editionDate);
      const promoted = Boolean(result?.template && result.template.status === "active" && !result.requiresActivation);
      summary.results.push({ formCode: item.formCode, action: item.action, outcome: result?.checkError ? "uscis_unreachable" : promoted ? "live" : "kept_in_review", detail: result?.checkError || result?.activationBlockedReason || undefined, certified: result?.certification?.passed });
    } catch (error) {
      // the installed edition is untouched by a failed import; the next run retries
      summary.results.push({ formCode: item.formCode, action: item.action, outcome: "error", detail: error.message });
    }
    logger.info("uscis_catalog_sync_form", summary.results.at(-1));
  }
  logger.info("uscis_catalog_sync_completed", { ...summary, results: undefined, ms: Date.now() - startedAt });
  return { ...summary, ms: Date.now() - startedAt };
}

module.exports = { runCatalogSync, classify, classifyLegacy, classifyShared, sameDay, applyFailureMemory };
