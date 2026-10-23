// Phase 7.8 simulation: the ERROR and FAULT scenarios. Each import scenario describes what the fake uscis.gov serves; the harness runs the real importer, the real error-resolution
// engine, the real job service / runner and the real alerter against it and checks the END STATE:
//   expect "autonomous": the form was imported with no human step (the engine or the importer's own retries fixed it);
//   expect "held":       no honest automatic fix exists; the job is a documented hold, the live edition is untouched and the developer gets ONE e-mail naming the form.
// A scenario that cannot run here (qpdf missing, ...) is skipped with a reason, never silently passed.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { page, link } = require("./faultPdfs");

const FORMS = "https://www.uscis.gov/sites/default/files/document/forms";
const pdfOf = (slug) => `${FORMS}/${slug}.pdf`;
const pageOf = (slug) => `https://www.uscis.gov/${slug}`;
const slugOf = (code) => String(code).toLowerCase();

/** What every import scenario starts from: the form's own page links its PDF, and the PDF is the good synthetic edition. */
function healthy({ code, base }) {
  const slug = slugOf(code);
  return { [pageOf(slug)]: { html: page(link(`/sites/default/files/document/forms/${slug}.pdf`, `Form ${code}`)) }, [pdfOf(slug)]: { pdf: base } };
}

/** Points the PDF normalizer at a program that does not exist AND hides every other qpdf from PATH / the usual install folders; returns the undo. */
function hideQpdf() {
  const env = require("../../config/env");
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "edition-sim-noqpdf-"));
  const keys = ["PATH", "Path", "ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA", "QPDF_AUTO_INSTALL"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const savedPath = env.qpdfPath;
  for (const key of ["PATH", "ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"]) process.env[key] = empty;
  process.env.QPDF_AUTO_INSTALL = "false";
  env.qpdfPath = path.join(empty, "qpdf-missing.exe");
  return async () => {
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
    env.qpdfPath = savedPath;
    fs.rmSync(empty, { recursive: true, force: true });
    await require("../../utils/ensureQpdf").ensureQpdf({ force: true }).catch(() => null);
  };
}

/** A wrong qpdf path with the real one still on PATH: the normalizer must heal by itself. */
function wrongQpdfPath() {
  const env = require("../../config/env");
  const savedPath = env.qpdfPath;
  env.qpdfPath = path.join(os.tmpdir(), "no-such-folder", "qpdf.exe");
  return async () => { env.qpdfPath = savedPath; await require("../../utils/ensureQpdf").ensureQpdf({ force: true }).catch(() => null); };
}

const withEnv = (vars) => () => {
  const saved = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  Object.assign(process.env, vars);
  return async () => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } };
};


const IMPORT_SCENARIOS = [
  { id: "fetch_503_blip", label: "uscis.gov answers 503 twice, then the PDF", expect: "autonomous",
    setup: (c) => ({ routes: { ...healthy(c), [pdfOf(slugOf(c.code))]: [{ status: 503 }, { status: 503 }, { pdf: c.base }] } }) },
  { id: "fetch_503_persistent", label: "uscis.gov answers 503 for every request (an outage longer than the job's retries)", expect: "held", holdCode: "NETWORK_UNAVAILABLE",
    setup: (c) => ({ routes: { ...healthy(c), [pdfOf(slugOf(c.code))]: { status: 503 } } }) },
  { id: "fetch_www_host_down", label: "the www. host answers 503, the apex host serves the PDF", expect: "autonomous",
    setup: (c) => ({ routes: { ...healthy(c), [pdfOf(slugOf(c.code))]: { status: 503 }, [pdfOf(slugOf(c.code)).replace("www.", "")]: { pdf: c.base } } }) },
  { id: "fetch_timeout_blip", label: "the first download hangs past the timeout, the second is fast", expect: "autonomous",
    prepare: withEnv({ USCIS_PDF_TIMEOUT_MS: "150" }),
    setup: (c) => ({ routes: { ...healthy(c), [pdfOf(slugOf(c.code))]: [{ pdf: c.base, delayMs: 1500 }, { pdf: c.base }] } }) },
  { id: "fetch_slow_server", label: "the server always needs longer than the timeout (the engine's longer-timeout retry)", expect: "autonomous",
    prepare: withEnv({ USCIS_PDF_TIMEOUT_MS: "150" }),
    setup: (c) => ({ routes: { ...healthy(c), [pdfOf(slugOf(c.code))]: { pdf: c.base, delayMs: 400 } } }) },
  { id: "html_instead_of_pdf", label: "the stored PDF address serves an HTML page; the official page links the right file", expect: "autonomous",
    setup: (c) => { const slug = slugOf(c.code); return { routes: {
      [pageOf(slug)]: { html: page(link(`/sites/default/files/document/forms/${slug}.pdf?v=2`, `Form ${c.code}`)) },
      [pdfOf(slug)]: { html: page("Please enable JavaScript to continue") },
      [`${pdfOf(slug)}?v=2`]: { pdf: c.base } } }; } },
  { id: "html_persistent", label: "the PDF address and the official page both serve only HTML", expect: "held", holdCode: "PDF_UNREADABLE",
    setup: (c) => { const slug = slugOf(c.code); return { routes: { [pageOf(slug)]: { html: page(`Form ${c.code} is being updated`) }, [pdfOf(slug)]: { html: page("maintenance") } } }; } },
  { id: "truncated_then_ok", label: "the first download is cut short, the second is complete", expect: "autonomous",
    setup: (c) => ({ routes: { ...healthy(c), [pdfOf(slugOf(c.code))]: [{ pdf: c.truncated }, { pdf: c.base }] } }) },
  { id: "truncated_persistent", label: "the server always sends the same cut-off file", expect: "held", holdCode: "NO_FILLABLE_FIELDS|PDF_UNREADABLE",
    setup: (c) => ({ routes: { ...healthy(c), [pdfOf(slugOf(c.code))]: { pdf: c.truncated } } }) },
  { id: "truncated_never_complete", label: "every download is cut off at a different place (a flaky connection that never completes)", expect: "held", holdCode: "NETWORK_UNAVAILABLE|PDF_UNREADABLE",
    setup: (c) => ({ routes: { ...healthy(c), [pdfOf(slugOf(c.code))]: ({ count }) => ({ pdf: c.truncated.subarray(0, c.truncated.length - 3 * count) }) } }) },
  { id: "xfa_only_with_companion", label: "an XFA-only PDF; the official page also links the fillable version", expect: "autonomous",
    setup: (c) => { const slug = slugOf(c.code); return { routes: {
      [pageOf(slug)]: { html: page(link(`/sites/default/files/document/forms/${slug}.pdf`, `Form ${c.code}`) + link(`/sites/default/files/document/forms/${slug}-fillable.pdf`, "Fillable version")) },
      [pdfOf(slug)]: { pdf: c.xfa }, [pdfOf(`${slug}-fillable`)]: { pdf: c.base } } }; } },
  { id: "xfa_only_no_companion", label: "an XFA-only PDF and no fillable alternative anywhere", expect: "held", holdCode: "NO_FILLABLE_FIELDS",
    setup: (c) => ({ routes: { ...healthy(c), [pdfOf(slugOf(c.code))]: { pdf: c.xfa } } }) },
  { id: "password_pdf", label: "a PDF that needs a password to open", expect: "held", holdCode: "PDF_UNREADABLE", needsPassword: true,
    setup: (c) => ({ routes: { ...healthy(c), [pdfOf(slugOf(c.code))]: { pdf: c.password } } }) },
  { id: "oversize_template", label: "the template would not fit the database document limit", expect: "held", holdCode: "TEMPLATE_TOO_LARGE",
    prepare: withEnv({ TEMPLATE_MAX_BYTES: "20000" }),
    setup: (c) => ({ routes: healthy(c) }) },
  { id: "qpdf_missing", label: "qpdf cannot be started anywhere (the pure-JavaScript normalizer must take over, verified)", expect: "autonomous",
    prepare: hideQpdf, setup: (c) => ({ routes: healthy(c) }) },
  { id: "qpdf_wrong_path", label: "the configured qpdf path is wrong but qpdf is installed (the normalizer heals itself)", expect: "autonomous",
    prepare: wrongQpdfPath, setup: (c) => ({ routes: healthy(c) }) },
  { id: "wrong_page_address_i485j", label: "I-485J: the stored address 404s; the real page is /i-485supj", expect: "autonomous", formCode: "I-485J",
    setup: (c) => ({ staleUrl: pdfOf("i-485j"), checkPage: pageOf("i-485j"), routes: {
      [pageOf("i-485j")]: { status: 404 }, [pdfOf("i-485j")]: { status: 404 },
      [pageOf("i-485supj")]: { html: page(`<h1>Form I-485 Supplement J</h1>` + link("/sites/default/files/document/forms/i-485supj.pdf", "Form I-485J (PDF)")) },
      [pdfOf("i-485supj")]: { pdf: c.base } } }) },
  { id: "wrong_page_address_i539a", label: "I-539A: only a link on the /i-539 page; the stored address 404s", expect: "autonomous", formCode: "I-539A",
    setup: (c) => ({ staleUrl: pdfOf("i-539a-old"), checkPage: pageOf("i-539a"), routes: {
      [pageOf("i-539a")]: { status: 404 }, [pdfOf("i-539a-old")]: { status: 404 },
      [pageOf("i-539")]: { html: page(`<h1>Form I-539</h1>` + link("/sites/default/files/document/forms/i-539a.pdf", "Form I-539A (PDF)")) },
      [pdfOf("i-539a")]: { pdf: c.base } } }) },
  { id: "source_gone_everywhere", label: "every official address for the form answers 404", expect: "held", holdCode: "NO_OFFICIAL_SOURCE",
    setup: (c) => { const slug = slugOf(c.code); return { checkPage: pageOf(slug), routes: { [pageOf(slug)]: { status: 404 }, [pdfOf(slug)]: { status: 404 } } }; } },
];

/** Scenarios that are not "the importer meets a bad download": they have their own runners (faultHarness.js). */
const PIPELINE_FAULTS = [
  { id: "lease_loss_mid_stage", kind: "lease_loss", label: "the worker stalls mid-import, its lease expires and another worker finishes the job", expect: "autonomous" },
  { id: "worker_kill_mid_stage", kind: "worker_kill", label: "the worker dies mid-import (never answers again); the job is recovered and finished by another worker", expect: "autonomous" },
  { id: "repeated_run", kind: "repeated_run", label: "the same edition is run through the pipeline twice", expect: "autonomous" },
];

/** A database error in the middle of the case migration: injected at a checkpoint of the real service; the sweeper and a second run must finish it with nothing lost. */
const MIGRATION_FAULTS = [
  { id: "db_error_mid_migration_planned", kind: "migration_fault", at: "planned", label: "a database error right after the plan, before anything is written", expect: "autonomous" },
  { id: "db_error_mid_migration_snapshotted", kind: "migration_fault", at: "snapshotted", label: "a database error after the safety copy, before the case form is changed", expect: "autonomous" },
  { id: "db_error_mid_migration_saved", kind: "migration_fault", at: "saved", label: "a database error after the case form was written, before it was verified", expect: "autonomous" },
];

module.exports = { IMPORT_SCENARIOS, PIPELINE_FAULTS, MIGRATION_FAULTS, healthy, pdfOf, pageOf, slugOf };
