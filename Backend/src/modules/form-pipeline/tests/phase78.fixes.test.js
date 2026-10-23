// Phase 7.8 fixes found by the edition simulation: (1) a strategy never claims a fix that changes nothing (the longer-timeout retry really waits longer, only for a timeout);
// (2) every dead end the engine could not cure (blocked / held / dead-letter, a programming error included, never the edition-policy hold) is recorded as stuck and the developer is told once;
// (3) a truncated download is diagnosed as a damaged PDF, and two identical cut-off downloads are never accepted. DB-free.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRunner } = require("../FormPipelineRunner");
const { classifyError } = require("../errorClassifier");
const { diagnose } = require("../resolution/Diagnoser");
const { createImportDeps } = require("../resolution/importDeps");
const PdfDownload = require("../../uscis-form-import/services/PdfDownload");

const quiet = { info() {}, warn() {}, error() {} };
const lease = { token: "t", fence: 1 };

function harness({ mode = "on", executor, endState, policyHold = false }) {
  const calls = { marked: [], stuck: 0, announce: 0 };
  const job = { _id: "j1", formCode: "I-212", attempts: 1, maxAttempts: 5 };
  const jobService = {
    heartbeat: async () => {}, stageStart: async () => {}, stageFinish: async () => {}, stageFail: async () => {}, assertLease: async () => {}, setEdition: async () => {}, recordRepair: async () => {},
    get: async () => ({ ...job, repairsTried: [] }),
    fail: async (id, l, args) => ({ state: endState, classification: policyHold ? { class: "held", code: "EDITION_POLICY_HELD" } : classifyError(args.error, args.diagnosis), signature: "s", nextAttemptAt: new Date() }),
    exhaust: async () => ({ state: "held" }), recordResolutions: async () => {}, complete: async () => {},
    markExhausted: async (id, info) => { const first = calls.marked.length === 0; calls.marked.push(info); return first; },
  };
  const resolver = {
    plan: async ({ error, stage }) => ({ diagnosis: diagnose({ error, stage }), planned: [] }),
    // the engine ran, tried what it could, and the job still ends as an ordinary failure (not "exhausted"): the paths this fix covers
    resolve: async ({ error, stage }) => ({ outcome: "not_applicable", retry: false, attempts: [], diagnosis: diagnose({ error, stage }) }),
  };
  const alerter = { announce: async () => { calls.announce += 1; }, announceStuck: async () => { calls.stuck += 1; } };
  const runner = createRunner({ jobService, alerter, executor, resolver, autonomyMode: () => mode, logger: quiet, heartbeatMs: 1e9 });
  return { runner, calls, job };
}

const blockedError = () => Object.assign(new Error("The downloaded PDF has no form fields"), { code: "NORMALIZED_SCAN_EMPTY_FIELDS", status: 422 });

test("on: a job that ends BLOCKED after the engine ran is recorded as stuck and the developer e-mail is requested exactly once", async () => {
  const { runner, calls, job } = harness({ executor: async () => { throw blockedError(); }, endState: "blocked" });
  const out = await runner.run({ job, lease });
  assert.equal(out.state, "blocked");
  assert.equal(calls.marked.length, 1);
  assert.ok(calls.marked[0].signature && calls.marked[0].cause);
  assert.equal(calls.stuck, 1);
  assert.equal(calls.announce, 0, "the stuck e-mail replaces the generic blocked / held e-mail");
});

test("on: a dead-lettered job (a programming error included) is stuck AND keeps its own alert", async () => {
  const { runner, calls, job } = harness({ executor: async () => { throw new TypeError("x is not a function"); }, endState: "dead_letter" });
  const out = await runner.run({ job, lease });
  assert.equal(out.state, "dead_letter");
  assert.equal(calls.stuck, 1);
  assert.equal(calls.announce, 1);
});

test("on: the stuck e-mail is requested once per dead end (a second marking is a no-op)", async () => {
  const first = harness({ executor: async () => { throw blockedError(); }, endState: "blocked" });
  await first.runner.run({ job: first.job, lease });
  await first.runner.run({ job: first.job, lease });
  assert.equal(first.calls.marked.length, 2);
  assert.equal(first.calls.stuck, 1, "only the first marking sends");
});

test("on: a transient failure that is only being retried (pending) is NOT stuck", async () => {
  const { runner, calls, job } = harness({ executor: async () => { throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }); }, endState: "pending" });
  await runner.run({ job, lease });
  assert.equal(calls.marked.length, 0);
  assert.equal(calls.stuck, 0);
});

test("on: the edition-policy hold keeps its own e-mail and is never reported as stuck", async () => {
  const { runner, calls, job } = harness({ executor: async () => { throw Object.assign(new Error("not accepted yet"), { name: "EditionPolicyHeldError", code: "EDITION_POLICY_HELD" }); }, endState: "held", policyHold: true });
  await runner.run({ job, lease });
  assert.equal(calls.marked.length, 0);
  assert.equal(calls.stuck, 0);
  assert.equal(calls.announce, 1);
});

test("off and shadow: no job is recorded as stuck and no stuck e-mail is requested (today's behavior)", async () => {
  for (const mode of ["off", "shadow"]) {
    const { runner, calls, job } = harness({ mode, executor: async () => { throw blockedError(); }, endState: "blocked" });
    await runner.run({ job, lease });
    assert.equal(calls.marked.length, 0, mode);
    assert.equal(calls.stuck, 0, mode);
    assert.equal(calls.announce, 1, mode);
  }
});

// ---- strategies are honest ----
const timeoutError = () => Object.assign(new Error("Failed to download USCIS PDF: no response within 150 ms"), { sourceUrl: "https://www.uscis.gov/sites/default/files/document/forms/i-212.pdf" });
const completePdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\nstartxref\n0\n%%EOF\n");

test("retryWithTimeout: a timeout is retried with a longer wait AND leaves the hint the retry reads", async () => {
  PdfDownload.clearHints();
  const seen = [];
  const deps = createImportDeps({ fetcher: async (url, options) => { seen.push(options.timeoutMs); return { ok: true, bytes: completePdf, status: 200 }; }, loadTemplate: async () => null });
  const out = await deps.retryWithTimeout({ formCode: "I-212", error: timeoutError() });
  assert.equal(out.ok, true);
  assert.equal(out.retry, true);
  assert.equal(seen[0], 3 * PdfDownload.timeoutMs());
  assert.equal(PdfDownload.resolveTimeoutHint(timeoutError().sourceUrl), 3 * PdfDownload.timeoutMs());
  assert.equal(PdfDownload.resolveTimeoutHint(`${timeoutError().sourceUrl}?_dl=1`), 3 * PdfDownload.timeoutMs(), "the cache-busting retry of the same address also waits longer");
});

test("retryWithTimeout: any failure that is not a timeout is answered ok:false (a longer wait would change nothing) and leaves no hint", async () => {
  PdfDownload.clearHints();
  const deps = createImportDeps({ fetcher: async () => ({ ok: true, bytes: completePdf, status: 200 }), loadTemplate: async () => null });
  for (const error of [Object.assign(new Error("The downloaded PDF has no form fields"), { code: "NORMALIZED_SCAN_EMPTY_FIELDS", sourceUrl: "https://www.uscis.gov/x.pdf" }), Object.assign(new Error("password needed"), { sourceUrl: "https://www.uscis.gov/y.pdf" })]) {
    const out = await deps.retryWithTimeout({ formCode: "I-212", error });
    assert.equal(out.ok, false);
    assert.match(out.evidence, /not a timeout/);
    assert.equal(PdfDownload.resolveTimeoutHint(error.sourceUrl), null);
  }
});

test("the download of the retry really uses the longer timeout the hint carries", async () => {
  PdfDownload.clearHints();
  const url = "https://www.uscis.gov/sites/default/files/document/forms/i-212.pdf";
  const timeouts = [];
  const fetcher = async (address, options) => { timeouts.push(options.timeoutMs); return { ok: true, bytes: completePdf, status: 200, contentType: "application/pdf" }; };
  await PdfDownload.fetchPdf(url, { fetcher, env: { USCIS_PDF_TIMEOUT_MS: "150" } });
  PdfDownload.setTimeoutHint(url, 450);
  await PdfDownload.fetchPdf(url, { fetcher, env: { USCIS_PDF_TIMEOUT_MS: "150" } });
  assert.deepEqual(timeouts, [150, 450]);
  PdfDownload.clearHints();
});

// ---- truncated downloads ----
test("a truncated download is diagnosed as a damaged PDF, not a network problem", () => {
  const error = Object.assign(new Error("The downloaded PDF is incomplete (no end-of-file marker) after a second download"), { code: "PDF_TRUNCATED", status: 502 });
  assert.equal(diagnose({ error, stage: "import" }).cause, "pdf_damaged");
});

test("two identical cut-off downloads are an error (PDF_TRUNCATED); identical downloads with an earlier end marker are still accepted", async () => {
  const cutOff = Buffer.concat([Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n"), Buffer.alloc(3000, 0x41)]);
  const fetcher = (bytes) => async () => ({ ok: true, bytes, status: 200, contentType: "application/pdf" });
  await assert.rejects(PdfDownload.fetchPdf("https://www.uscis.gov/a.pdf", { fetcher: fetcher(cutOff) }), (error) => error.code === "PDF_TRUNCATED");
  const withMarkerEarly = Buffer.concat([Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\nstartxref\n0\n%%EOF\n"), Buffer.alloc(3000, 0x20)]);
  const accepted = await PdfDownload.fetchPdf("https://www.uscis.gov/b.pdf", { fetcher: fetcher(withMarkerEarly) });
  assert.equal(accepted.buffer.length, withMarkerEarly.length);
});
