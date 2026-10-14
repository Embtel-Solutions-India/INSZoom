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

const STANDALONE = /^[A-Z]{1,3}-\d+[A-Z]?$/;
const sameDay = (a, b) => Boolean(a && b) && new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);

// Decides what to do with one published form given what is installed. Pure.
//   published: { formCode, editionDate|null }   installed: the active template (or null)
function classify(published, installed) {
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
      const pageUrl = `https://www.uscis.gov/${formCode.toLowerCase()}`;
      const html = await USCISScannerService.fetchPage(pageUrl);
      return USCISScannerService.extractFormPageMetadata(html, pageUrl, formCode).editionDate || null;
    },
    async installedTemplate(formCode) {
      return USCISFormTemplate.findOne({ formCode, status: "active" }).sort({ editionDate: -1 }).select("formCode version editionDate importMetadata.publishedEditionDate").lean();
    },
    async stampPublishedEdition(formCode, editionDate) {
      await USCISFormTemplate.updateOne({ formCode, status: "active", "importMetadata.publishedEditionDate": { $exists: false } }, { $set: { "importMetadata.publishedEditionDate": editionDate } });
    },
    importForm: (formCode, user, req) => Acquisition.ensureCurrentUSCISForm(formCode, user, req, { forceCheck: true }),
  };
}

async function inBatches(items, size, task) {
  const out = [];
  for (let index = 0; index < items.length; index += size) out.push(...await Promise.all(items.slice(index, index + size).map(task)));
  return out;
}

// options: { user, req, dryRun, maxFormsPerRun, maxPages, concurrency, only: [codes] }, deps override for tests
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
      return { ...form, editionDate: edition, installed, ...classify({ ...form, editionDate: edition }, installed) };
    } catch (error) {
      return { ...form, action: "error", reason: error.message };
    }
  });
  const upgrades = classified.filter((item) => item.action === "upgrade" || item.action === "check_edition");
  const news = classified.filter((item) => item.action === "import_new");
  const queue = [...upgrades, ...news].slice(0, maxFormsPerRun);
  const summary = {
    published: published.length,
    upToDate: classified.filter((item) => item.action === "up_to_date").length,
    upgradesFound: upgrades.length,
    newFormsFound: news.length,
    queued: queue.map((item) => `${item.formCode}(${item.action})`),
    deferred: Math.max(upgrades.length + news.length - queue.length, 0),
    skipped: classified.filter((item) => item.action === "skip").length,
    // every form already in the software, with both editions side by side
    installedComparison: classified.filter((item) => item.installed).map((item) => ({ formCode: item.formCode, installed: (item.installed.importMetadata?.publishedEditionDate || item.installed.editionDate) ? new Date(item.installed.importMetadata?.publishedEditionDate || item.installed.editionDate).toISOString().slice(0, 10) : item.installed.version || null, published: item.editionDate ? new Date(item.editionDate).toISOString().slice(0, 10) : null, action: item.action, reason: item.reason })),
    errors: classified.filter((item) => item.action === "error").map((item) => `${item.formCode}: ${item.reason}`),
    results: [],
  };
  if (options.dryRun) return { ...summary, dryRun: true, ms: Date.now() - startedAt };

  const req = options.req || { ip: "system", headers: {} };
  for (const item of queue) { // sequential: one form's failure can never affect another
    try {
      const result = await deps.importForm(item.formCode, options.user, req);
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

module.exports = { runCatalogSync, classify, sameDay };
