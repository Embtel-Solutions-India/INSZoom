// Petition AI Review - Phase 3 acceptance tests (database-free: an in-memory store built on the real schemas; no network: the AI is a stub).
// Proves: one open scan per petition, atomic claims with lease + fence, a dead worker's scan resumed by another with every page scanned exactly
// once and no stale writes, pause + automatic resume on billing / quota, the backup AI, re-queued pages retried at the end, gaps, cancel,
// retry, graceful shutdown hand-back, every failure path closing the scan with a reason, the upload hook (off by default, never throws,
// < 5 ms), the worker (no overlapping passes) and a 700-page scan with the event loop staying responsive.
const test = require("node:test");
const assert = require("node:assert/strict");
const { monitorEventLoopDelay } = require("node:perf_hooks");
const { Types } = require("mongoose");
const { PDFDocument } = require("pdf-lib");

const PetitionAiScan = require("../../../models/PetitionAiScan");
const PetitionAiFinding = require("../../../models/PetitionAiFinding");
const { createFakeModel, oneOpenScanPerPetition } = require("./fixtures/fakeModel");
const { createScanService, ScanLeaseLostError, TIMING } = require("../scanService");
const { createScanRunner, mergeGaps, MAX_RETRY_TRIES } = require("../scanRunner");
const { createScanWorker } = require("../worker");
const { SCAN_STATUS, AI_ERROR, CATEGORY, PDF_ERROR } = require("../constants");
const { PetitionAiError, createGeminiCaller } = require("../petitionGemini");
const { readConfig } = require("../config");
const { buildFacts, loadCaseFacts } = require("../caseFacts");
const { PdfSlicer, PdfSliceError } = require("../pdfSlicer");

const MIN = 60 * 1000;
const quiet = { info() {}, warn() {}, error() {} };

// ── harness ─────────────────────────────────────────────────────────────
function harness({ start = Date.UTC(2026, 10, 3, 10) } = {}) {
  const clock = { t: start };
  const now = () => new Date(clock.t);
  const Scan = createFakeModel(PetitionAiScan, { unique: oneOpenScanPerPetition });
  const Finding = createFakeModel(PetitionAiFinding);
  const service = createScanService({ Scan, Finding, now });
  return { clock, now, Scan, Finding, service, advance: (ms) => { clock.t += ms; } };
}
const ids = () => ({ caseId: new Types.ObjectId(), documentId: new Types.ObjectId() });

function fakeReader(pages, { mode = "pdf", closed = { count: 0 } } = {}) {
  return {
    pages, mode,
    slice: async (from, to) => Buffer.alloc(100 * (to - from + 1)),
    text: async (from, to) => Array.from({ length: to - from + 1 }, (_, i) => ({ page: from + i, text: `Text of page ${from + i}` })),
    close: async () => { closed.count += 1; },
  };
}
// AI stub: one typo finding per page sent; `fail(entry)` may return an error to throw for that call
function fakeAi({ fail = () => null, model = "gemini-test" } = {}) {
  const calls = [];
  return {
    calls,
    call: async (request) => {
      const pdf = request.parts.find((part) => part.inlineData);
      const promptText = request.parts.map((part) => part.text || "").join("");
      const pageCount = pdf ? Number(/holds (\d+) page/.exec(promptText)?.[1]) : (promptText.match(/=== PAGE/g) || []).length;
      const entry = { pageCount, pdf: Boolean(pdf), promptText, summary: /executive summary/.test(promptText) };
      calls.push(entry);
      if (entry.summary) return { text: '{"summary":"short"}', tokens: 1, model, finishReason: "STOP", attempts: 1 };
      const error = await fail(entry, calls.length);
      if (error) throw error;
      const findings = Array.from({ length: pageCount }, (_, i) => ({ page: i + 1, severity: "warning", category: "typo", excerpt: `w${i + 1}`, found: "typo" }));
      return { text: JSON.stringify({ findings }), tokens: 10, model, finishReason: "STOP", attempts: 1 };
    },
  };
}
const aiError = (code) => new PetitionAiError(code, code);

function runnerFor(h, overrides = {}) {
  const closed = { count: 0 };
  const config = { ...readConfig({}), pagesPerCall: 4, concurrency: 2, batchDelayMs: 0, maxPages: 1500, ...(overrides.config || {}) };
  const pages = overrides.pages || 10;
  const ai = overrides.ai === undefined ? fakeAi() : overrides.ai;
  const deps = {
    scanService: h.service,
    config,
    logger: quiet,
    sleep: async () => {},
    heartbeatMs: 10 ** 9,
    loadDocument: async (id) => ({ _id: id, documentType: "petition_manual_upload", storageKey: "k", originalName: "petition.pdf" }),
    readBuffer: async () => Buffer.from("%PDF-fake"),
    openReader: async () => fakeReader(pages, { closed, mode: overrides.mode }),
    loadFacts: async () => buildFacts({ caseDoc: { caseNumber: "B243-A", visaType: "H-1B" } }),
    loadRules: async () => ({ rules: [], expectedAddresses: [], prohibitedTerms: [] }),
    createCaller: () => ai,
    createFallback: () => overrides.fallback || null,
    ...overrides.deps,
  };
  return { runScan: createScanRunner(deps), ai, closed, config };
}
async function queued(h, extra = {}) {
  return (await h.service.enqueue({ ...ids(), documentName: "petition.pdf", batchSize: 4, ...extra })).scan;
}
async function scanOf(h, scan) { return h.Scan.findById(scan._id); }
async function findingPages(h, scan) { return (await h.Finding.find({ scanId: scan._id })).map((f) => f.page).sort((a, b) => a - b); }
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

// ── scan service ────────────────────────────────────────────────────────
test("service: one open scan per petition, also when two uploads race", async () => {
  const h = harness();
  const target = ids();
  const [a, b] = await Promise.all([h.service.enqueue(target), h.service.enqueue(target)]);
  assert.equal([a, b].filter((r) => r.created).length, 1);
  assert.equal(String(a.scan._id), String(b.scan._id));
  assert.equal(h.Scan.docs.length, 1);
  const again = await h.service.enqueue(target);
  assert.equal(again.created, false);
});

test("service: claims are atomic; the lease blocks a second claim until it expires; the old holder's writes are refused", async () => {
  const h = harness();
  const scan = await queued(h);
  const [one, two] = await Promise.all([h.service.claimNext({ workerId: "A" }), h.service.claimNext({ workerId: "B" })]);
  const winner = one || two;
  assert.ok(winner && !(one && two), "exactly one worker gets the scan");
  assert.equal(winner.lease.fence, 1);
  assert.equal(await h.service.claimNext({ workerId: "C" }), null, "leased scans are not claimable");
  h.advance(TIMING.leaseMs + 1);
  const taken = await h.service.claimNext({ workerId: "C" });
  assert.equal(taken.lease.fence, 2);
  assert.equal(taken.scan.attempts, 2);
  await assert.rejects(h.service.heartbeat(scan._id, winner.lease), ScanLeaseLostError);
  await assert.rejects(h.service.recordProgress(winner.scan, winner.lease, { from: 1, to: 4, nextPage: 5 }), ScanLeaseLostError);
  await h.service.heartbeat(scan._id, taken.lease);
});

test("service: scans waiting for nextAttemptAt are not claimed early; the oldest due scan is claimed first", async () => {
  const h = harness();
  const later = await queued(h);
  await h.Scan.updateOne({ _id: later._id }, { $set: { nextAttemptAt: new Date(h.clock.t + 10 * MIN) } });
  h.advance(1000);
  const first = await queued(h);
  assert.equal(String((await h.service.claimNext()).scan._id), String(first._id));
  assert.equal(await h.service.claimNext(), null);
  await h.service.cancel(first._id); // (otherwise its lease, expired 10 minutes later, would make it claimable again - by design)
  h.advance(10 * MIN);
  assert.equal(String((await h.service.claimNext()).scan._id), String(later._id));
});

test("service: a scan whose worker keeps dying is closed as failed once its attempts are used up", async () => {
  const h = harness();
  const scan = await queued(h, { maxAttempts: 2 });
  for (let i = 0; i < 2; i += 1) { assert.ok(await h.service.claimNext()); h.advance(TIMING.leaseMs + 1); }
  assert.equal(await h.service.recoverExhausted(), 1);
  const closed = await scanOf(h, scan);
  assert.equal(closed.status, SCAN_STATUS.FAILED);
  assert.equal(closed.open, false);
  assert.equal(closed.error.code, "WORKER_LOST");
  assert.equal(await h.service.claimNext(), null);
});

test("service: recordProgress is idempotent - a range written twice keeps one copy of its findings", async () => {
  const h = harness();
  await queued(h);
  const claim = await h.service.claimNext();
  const findings = [{ page: 2, severity: "error", category: "typo", excerpt: "a", found: "b" }];
  await h.service.recordProgress(claim.scan, claim.lease, { from: 1, to: 4, findings, nextPage: 5 });
  await h.service.recordProgress(claim.scan, claim.lease, { from: 1, to: 4, findings, nextPage: 5 });
  assert.equal(h.Finding.docs.length, 1);
  assert.equal((await scanOf(h, claim.scan)).nextPage, 5);
});

test("service: pause waits 30 min without using attempts, keeps when it started, and fails after a week of waiting", async () => {
  const h = harness();
  const scan = await queued(h);
  let claim = await h.service.claimNext();
  const first = await h.service.pause(claim.scan, claim.lease, { code: AI_ERROR.BILLING, message: "billing" });
  assert.equal(first.state, "paused");
  let stored = await scanOf(h, scan);
  assert.equal(stored.status, SCAN_STATUS.QUEUED);
  assert.equal(stored.attempts, 0);
  assert.equal(stored.paused.code, AI_ERROR.BILLING);
  const since = stored.paused.since.getTime();
  assert.equal(await h.service.claimNext(), null, "not re-checked before 30 minutes");
  h.advance(TIMING.pauseMs);
  claim = await h.service.claimNext();
  await h.service.pause(claim.scan, claim.lease, { code: AI_ERROR.BILLING, message: "billing" });
  assert.equal((await scanOf(h, scan)).paused.since.getTime(), since, "the first pause time is kept");
  h.advance(TIMING.maxPauseMs);
  claim = await h.service.claimNext();
  assert.equal((await h.service.pause(claim.scan, claim.lease, { code: AI_ERROR.BILLING, message: "billing" })).state, SCAN_STATUS.FAILED);
  stored = await scanOf(h, scan);
  assert.equal(stored.open, false);
  assert.match(stored.error.message, /waited a week/);
});

test("service: temporary failures back off 1, 2, 4 ... minutes, then fail with Retry available", async () => {
  const h = harness();
  const scan = await queued(h, { maxAttempts: 3 });
  const waits = [];
  for (let i = 0; i < 2; i += 1) {
    const claim = await h.service.claimNext();
    const result = await h.service.release(claim.scan, claim.lease, { code: "STORAGE", message: "down" });
    waits.push(result.nextAttemptAt.getTime() - h.clock.t);
    h.advance(result.nextAttemptAt.getTime() - h.clock.t);
  }
  assert.deepEqual(waits, [MIN, 2 * MIN]);
  const claim = await h.service.claimNext();
  assert.equal((await h.service.release(claim.scan, claim.lease, { code: "STORAGE", message: "down" })).state, SCAN_STATUS.FAILED);
  assert.match((await scanOf(h, scan)).error.message, /Press Retry/);
});

test("service: cancel stops the worker's writes; retry reopens failed / cancelled scans, re-checks waiting ones now, and refuses a second open scan", async () => {
  const h = harness();
  const target = ids();
  const scan = (await h.service.enqueue(target)).scan;
  const claim = await h.service.claimNext();
  assert.equal(await h.service.cancel(scan._id), true);
  await assert.rejects(h.service.recordProgress(claim.scan, claim.lease, { from: 1, to: 4, nextPage: 5 }), ScanLeaseLostError);
  assert.equal(await h.service.cancel(scan._id), false, "already closed");
  const reopened = await h.service.retry(scan._id);
  assert.equal(reopened.reopened, true);
  assert.equal(reopened.scan.status, SCAN_STATUS.QUEUED);
  // a waiting scan is re-checked now
  await h.Scan.updateOne({ _id: scan._id }, { $set: { nextAttemptAt: new Date(h.clock.t + 30 * MIN) } });
  const now_ = await h.service.retry(scan._id);
  assert.equal(now_.reopened, false);
  assert.equal(now_.scan.nextAttemptAt, null);
  // a closed scan cannot be reopened while the petition has another open scan
  await h.service.cancel(scan._id);
  const fresh = await h.service.rescan({ ...target });
  assert.equal(fresh.created, true);
  const conflict = await h.service.retry(scan._id);
  assert.equal(String(conflict.conflict._id), String(fresh.scan._id));
  assert.equal(h.Scan.docs.filter((doc) => doc.open).length, 1);
});

// ── runner ──────────────────────────────────────────────────────────────
test("runner: a 10-page petition is scanned in order, every page once, and completed with a summary matching the stored findings", async () => {
  const h = harness();
  const scan = await queued(h);
  const { runScan, ai, closed } = runnerFor(h, { pages: 10 });
  const outcome = await runScan(await h.service.claimNext());
  assert.equal(outcome.state, SCAN_STATUS.COMPLETED);
  const stored = await scanOf(h, scan);
  assert.deepEqual(await findingPages(h, scan), range(1, 10));
  assert.equal(stored.nextPage, 11);
  assert.equal(stored.pagesDone, 10);
  assert.equal(stored.totalPages, 10);
  assert.equal(stored.open, false);
  assert.equal(stored.counts.warning, 10);
  assert.equal(stored.summary.byPage.length, 10);
  assert.equal(stored.usage.calls, 3); // 3 page batches; the summary is built in code (no AI call)
  assert.equal(ai.calls.filter((c) => !c.summary).map((c) => c.pageCount).join(","), "4,4,2");
  assert.equal(closed.count, 1, "the reader is always closed");
});

test("runner: a worker that dies mid-scan is taken over - every page scanned exactly once, the dead worker writes nothing", async () => {
  const h = harness();
  const scan = await queued(h);
  let release;
  const hang = new Promise((resolve) => { release = resolve; });
  // worker A: batch 5-8 hangs (its process "froze")
  const a = runnerFor(h, { pages: 12, config: { concurrency: 1 }, ai: fakeAi({ fail: async (_entry, n) => { if (n === 2) await hang; return null; } }) });
  const runA = a.runScan(await h.service.claimNext({ workerId: "A" }));
  while ((await scanOf(h, scan)).nextPage < 5) await new Promise((resolve) => setImmediate(resolve));
  // A's lease expires; worker B takes the scan over and finishes it
  h.advance(TIMING.leaseMs + 1);
  const b = runnerFor(h, { pages: 12, config: { concurrency: 1 } });
  const takeover = await h.service.claimNext({ workerId: "B" });
  assert.equal(takeover.scan.nextPage, 5, "B resumes at A's cursor");
  assert.equal((await b.runScan(takeover)).state, SCAN_STATUS.COMPLETED);
  const writesBefore = h.Finding.log.writes;
  release();
  assert.equal((await runA).state, "lease_lost");
  assert.equal(h.Finding.log.writes, writesBefore, "the stale worker wrote no findings");
  assert.deepEqual(await findingPages(h, scan), range(1, 12));
  assert.equal(b.ai.calls.filter((c) => !c.summary).length, 2, "B scanned only pages 5-12");
});

test("runner: billing with no backup pauses at the failing page, and the scan resumes by itself there once the AI works", async () => {
  const h = harness();
  const scan = await queued(h);
  let billing = true;
  const ai = fakeAi({ fail: (entry, n) => (billing && n >= 2 ? aiError(AI_ERROR.BILLING) : null) });
  const { runScan } = runnerFor(h, { pages: 12, config: { concurrency: 1 }, ai });
  assert.equal((await runScan(await h.service.claimNext())).state, "paused");
  let stored = await scanOf(h, scan);
  assert.equal(stored.status, SCAN_STATUS.QUEUED);
  assert.equal(stored.nextPage, 5);
  assert.match(stored.error.message, /prepaid credits/);
  assert.equal(await h.service.claimNext(), null, "it waits");
  billing = false;
  h.advance(TIMING.pauseMs);
  assert.equal((await runScan(await h.service.claimNext())).state, SCAN_STATUS.COMPLETED);
  stored = await scanOf(h, scan);
  assert.deepEqual(await findingPages(h, scan), range(1, 12));
  assert.equal(stored.paused.code, null);
  assert.equal(ai.calls.filter((c) => !c.summary && c.pageCount === 4).length, 4, "pages 1-4 once, the failed 5-8 call, then 5-8 and 9-12");
});

test("runner: quota / rejected key also pause; a missing key (and no backup) is not_configured", async () => {
  for (const code of [AI_ERROR.QUOTA, AI_ERROR.BAD_REQUEST]) {
    const h = harness();
    await queued(h);
    const { runScan } = runnerFor(h, { ai: fakeAi({ fail: () => aiError(code) }) });
    assert.equal((await runScan(await h.service.claimNext())).state, "paused", code);
  }
  const h = harness();
  const scan = await queued(h);
  const { runScan } = runnerFor(h, { ai: null });
  assert.equal((await runScan(await h.service.claimNext())).state, SCAN_STATUS.NOT_CONFIGURED);
  assert.match((await scanOf(h, scan)).error.message, /no AI key/);
});

test("runner: billing WITH a backup AI completes the scan in text mode and records it", async () => {
  const h = harness();
  const scan = await queued(h);
  const backup = fakeAi({ model: "claude-backup" });
  const { runScan } = runnerFor(h, { pages: 8, ai: fakeAi({ fail: () => aiError(AI_ERROR.BILLING) }), fallback: backup });
  assert.equal((await runScan(await h.service.claimNext())).state, SCAN_STATUS.COMPLETED);
  const stored = await scanOf(h, scan);
  assert.equal(stored.usedFallback, true);
  assert.deepEqual(await findingPages(h, scan), range(1, 8));
  assert.ok(backup.calls.every((c) => !c.pdf));
});

test("runner: pages that failed temporarily are retried at the end and the scan completes without gaps", async () => {
  const h = harness();
  const scan = await queued(h);
  const ai = fakeAi({ fail: (_entry, n) => (n === 2 ? aiError(AI_ERROR.UPSTREAM) : null) }); // pages 5-8 fail once
  const { runScan } = runnerFor(h, { pages: 12, config: { concurrency: 1 }, ai });
  assert.equal((await runScan(await h.service.claimNext())).state, SCAN_STATUS.COMPLETED);
  const stored = await scanOf(h, scan);
  assert.deepEqual(await findingPages(h, scan), range(1, 12));
  assert.equal(stored.gaps.length, 0);
  assert.equal(stored.retryRanges.length, 0);
});

test(`runner: pages that keep failing are retried ${MAX_RETRY_TRIES} more times, then flagged unreadable (completed_with_gaps)`, async () => {
  const h = harness();
  const scan = await queued(h);
  // call order with concurrency 1: 1-4 ok, 5-8 fails, 9-12 ok, then every retry of 5-8 fails
  let pdfCall = 0;
  const failing = fakeAi({ fail: (entry) => { if (entry.pdf) { pdfCall += 1; return pdfCall === 2 || pdfCall > 3 ? aiError(AI_ERROR.TIMEOUT) : null; } return null; } });
  const { runScan } = runnerFor(h, { pages: 12, config: { concurrency: 1 }, ai: failing });
  assert.equal((await runScan(await h.service.claimNext())).state, SCAN_STATUS.COMPLETED_WITH_GAPS);
  const stored = await scanOf(h, scan);
  assert.deepEqual(stored.gaps.map((g) => [g.from, g.to]), [[5, 8]]);
  const unreadable = (await h.Finding.find({ scanId: scan._id })).filter((f) => f.category === CATEGORY.UNREADABLE_PAGE).map((f) => f.page);
  assert.deepEqual(unreadable.sort((a, b) => a - b), [5, 6, 7, 8]);
  assert.deepEqual(await findingPages(h, scan), range(1, 12), "no page is silently missing");
  assert.equal(pdfCall, 2 + 1 + MAX_RETRY_TRIES, "1-4, failed 5-8, 9-12, then the retries");
  assert.match(stored.summary.text, /could not be read/);
});

test("runner: deleted petition -> cancelled; locked / damaged / empty PDF -> failed with a plain message; reader always closed", async () => {
  let h = harness();
  let scan = await queued(h);
  let run = runnerFor(h, { deps: { loadDocument: async () => null } });
  assert.equal((await run.runScan(await h.service.claimNext())).state, SCAN_STATUS.CANCELLED);
  assert.match((await scanOf(h, scan)).error.message, /deleted/);
  for (const code of [PDF_ERROR.ENCRYPTED, PDF_ERROR.UNREADABLE, PDF_ERROR.EMPTY]) {
    h = harness();
    scan = await queued(h);
    run = runnerFor(h, { deps: { openReader: async () => { throw new PdfSliceError(code, "x"); } } });
    assert.equal((await run.runScan(await h.service.claimNext())).state, SCAN_STATUS.FAILED, code);
    assert.ok((await scanOf(h, scan)).error.message.length > 10);
  }
});

test("runner: storage error, reader crash and an unexpected error are retried with backoff - the runner never rejects", async () => {
  const failures = [
    { readBuffer: async () => { throw new Error("S3 timeout"); } },
    { openReader: async () => { throw new PdfSliceError(PDF_ERROR.SLICER_CRASHED, "crash"); } },
    { loadFacts: async () => { throw new Error("boom"); } },
  ];
  for (const deps of failures) {
    const h = harness();
    const scan = await queued(h);
    const run = runnerFor(h, { deps });
    const outcome = await run.runScan(await h.service.claimNext());
    assert.equal(outcome.state, "retrying");
    const stored = await scanOf(h, scan);
    assert.equal(stored.status, SCAN_STATUS.QUEUED);
    assert.ok(stored.nextAttemptAt > h.now());
  }
});

test("runner: the page cap scans only the first pages and says so", async () => {
  const h = harness();
  const scan = await queued(h);
  const { runScan } = runnerFor(h, { pages: 10, config: { maxPages: 6 } });
  assert.equal((await runScan(await h.service.claimNext())).state, SCAN_STATUS.COMPLETED);
  const stored = await scanOf(h, scan);
  assert.equal(stored.skippedFrom, 7);
  assert.deepEqual(await findingPages(h, scan), range(1, 6));
  assert.match(stored.summary.text, /Pages 7-10 were not scanned/);
});

test("runner: cancelled while scanning -> stops, writes nothing more, the scan stays cancelled", async () => {
  const h = harness();
  const scan = await queued(h);
  const ai = fakeAi({ fail: async (entry, n) => { if (n === 2) await h.service.cancel(scan._id); return null; } });
  const { runScan } = runnerFor(h, { pages: 12, config: { concurrency: 1 }, ai });
  assert.equal((await runScan(await h.service.claimNext())).state, "lease_lost");
  const stored = await scanOf(h, scan);
  assert.equal(stored.status, SCAN_STATUS.CANCELLED);
  assert.deepEqual(await findingPages(h, scan), range(1, 4));
});

test("runner: on shutdown the scan is handed back without using an attempt and the next start resumes at once", async () => {
  const h = harness();
  const scan = await queued(h);
  let stop = false;
  const ai = fakeAi({ fail: (entry, n) => { if (n === 1) stop = true; return null; } });
  const first = runnerFor(h, { pages: 12, config: { concurrency: 1 }, ai, deps: { shouldStop: () => stop } });
  assert.equal((await first.runScan(await h.service.claimNext())).state, "yielded");
  const stored = await scanOf(h, scan);
  assert.equal(stored.status, SCAN_STATUS.QUEUED);
  assert.equal(stored.attempts, 0);
  assert.equal(stored.nextPage, 5);
  const second = runnerFor(h, { pages: 12 });
  assert.equal((await second.runScan(await h.service.claimNext())).state, SCAN_STATUS.COMPLETED);
  assert.deepEqual(await findingPages(h, scan), range(1, 12));
});

test("runner: duplicate findings across retried ranges are merged; gaps are merged into ranges", async () => {
  assert.deepEqual(mergeGaps([{ from: 3, to: 4, reason: "r" }, { from: 5, to: 5, reason: "r" }, { from: 4, to: 4, reason: "r" }, { from: 9, to: 9, reason: "x" }]), [{ from: 3, to: 5, reason: "r" }, { from: 9, to: 9, reason: "x" }]);
});

test("runner: end to end with the REAL PDF reader and the real Gemini caller on a stubbed network", async () => {
  const h = harness();
  const scan = await queued(h);
  const doc = await PDFDocument.create();
  for (let page = 1; page <= 9; page += 1) doc.addPage([200, 200]).drawText(`Page ${page}`, { x: 5, y: 100, size: 8 });
  const bytes = Buffer.from(await doc.save());
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    const text = body.contents[0].parts.map((p) => p.text || "").join("");
    if (/executive summary/.test(text)) return { status: 200, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"summary":"One small typo needs a look before filing."}' }] } }] }) };
    return { status: 200, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ findings: [{ page: 1, severity: "info", category: "typo", excerpt: "Page", found: "x" }] }) }] } }], usageMetadata: { totalTokenCount: 7 } }) };
  };
  const gemini = createGeminiCaller({ config: readConfig({ PETITION_AI_TIMEOUT_MS: "5000" }), apiKey: "k", fetchImpl, sleep: async () => {} });
  const { runScan } = runnerFor(h, { ai: gemini, deps: { readBuffer: async () => bytes, openReader: (buffer) => PdfSlicer.open(buffer) } });
  assert.equal((await runScan(await h.service.claimNext())).state, SCAN_STATUS.COMPLETED);
  const stored = await scanOf(h, scan);
  assert.equal(stored.totalPages, 9);
  assert.deepEqual(await findingPages(h, scan), [1, 5, 9]);
  assert.match(stored.summary.text, /^3 issues on 3 pages/);
  assert.match(stored.summary.text, /• Page 1 - /);
  assert.equal(stored.usage.tokens, 21);
});

test("runner: a 700-page petition completes with every page once while the event loop stays responsive", async () => {
  const h = harness();
  const scan = await queued(h);
  const lag = monitorEventLoopDelay({ resolution: 10 });
  lag.enable();
  const { runScan } = runnerFor(h, { pages: 700 });
  assert.equal((await runScan(await h.service.claimNext())).state, SCAN_STATUS.COMPLETED);
  lag.disable();
  assert.deepEqual(await findingPages(h, scan), range(1, 700));
  assert.equal((await scanOf(h, scan)).counts.warning, 700);
  assert.ok(lag.max / 1e6 < 250, `event loop lag ${Math.round(lag.max / 1e6)} ms`);
});

// ── worker ──────────────────────────────────────────────────────────────
test("worker: a pass claims and runs every due scan; kicks during a pass never overlap it; errors never escape", async () => {
  const h = harness();
  await queued(h);
  await queued(h);
  let active = 0;
  let maxActive = 0;
  const { runScan } = runnerFor(h, { pages: 4 });
  const worker = createScanWorker({ scanService: h.service, logger: quiet, runScan: async (claim) => { active += 1; maxActive = Math.max(maxActive, active); try { return await runScan(claim); } finally { active -= 1; } } });
  const first = worker.tick();
  const second = worker.tick();
  assert.equal(first, second, "a second tick during a pass joins it");
  const outcomes = await first;
  assert.equal(outcomes.length, 2);
  assert.equal(maxActive, 1, "one scan at a time");
  const broken = createScanWorker({ scanService: { recoverExhausted: async () => { throw new Error("db down"); }, claimNext: async () => { throw new Error("db down"); } }, runScan: async () => ({}), logger: quiet });
  assert.deepEqual(await broken.tick(), []);
});

test("worker: stop waits for the running scan to finish its pass and claims nothing afterwards", async () => {
  const h = harness();
  await queued(h);
  const { runScan } = runnerFor(h, { pages: 4 });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const worker = createScanWorker({ scanService: h.service, logger: quiet, intervalMs: 10 ** 7, runScan: async (claim) => { await gate; return runScan(claim); } });
  worker.start();
  const pass = worker.tick();
  while (!h.Scan.docs.some((d) => d.status === SCAN_STATUS.SCANNING)) await new Promise((resolve) => setImmediate(resolve));
  const stopped = worker.stop(5000);
  release();
  await stopped;
  assert.equal((await pass).length, 1, "the scan that was running was allowed to finish");
  await queued(h);
  assert.deepEqual(await worker.tick(), [], "nothing is claimed after stop");
  assert.equal(h.Scan.docs.filter((d) => d.open && d.status === SCAN_STATUS.QUEUED).length, 1, "the new scan stays queued for the next start");
});

// ── upload hook + start-up ──────────────────────────────────────────────
test("upload hook: off by default; ignores other documents and duplicates; < 5 ms; never throws, even when queueing fails", async () => {
  const index = require("../index");
  const previous = process.env.PETITION_AI_REVIEW;
  try {
    delete process.env.PETITION_AI_REVIEW;
    assert.equal(index.startPetitionAiReview(), null, "the switch is off unless set");
    const document = { _id: new Types.ObjectId(), documentType: "petition_manual_upload", originalName: "p.pdf", $locals: {} };
    assert.equal(index.onPetitionUploaded({ document, caseData: { _id: new Types.ObjectId() } }), false, "no worker started -> nothing queued");

    const h = harness();
    let kicks = 0;
    index._setHandleForTests({ scanService: h.service, worker: { kick: () => { kicks += 1; } } });
    assert.equal(index.onPetitionUploaded({ document: { ...document, documentType: "passport" } }), false);
    assert.equal(index.onPetitionUploaded({ document: { ...document, $locals: { wasDuplicate: true } } }), false);
    assert.equal(index.onPetitionUploaded({}), false);
    assert.equal(index.onPetitionUploaded(), false);
    const started = process.hrtime.bigint();
    assert.equal(index.onPetitionUploaded({ document, caseData: { _id: new Types.ObjectId() }, user: { _id: new Types.ObjectId() } }), true);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(elapsedMs < 5, `hook took ${elapsedMs} ms`);
    assert.equal(h.Scan.docs.length, 0, "nothing is written during the upload request itself");
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(h.Scan.docs.length, 1);
    assert.equal(h.Scan.docs[0].trigger, "upload");
    assert.equal(kicks, 1);

    index._setHandleForTests({ scanService: { enqueue: async () => { throw new Error("db down"); } }, worker: { kick() {} } });
    assert.equal(index.onPetitionUploaded({ document, caseData: {} }), true);
    await new Promise((resolve) => setTimeout(resolve, 10)); // the failure is logged, never thrown
    index._setHandleForTests({ get scanService() { throw new Error("broken"); } });
    assert.doesNotThrow(() => index.onPetitionUploaded({ document, caseData: {} }));
  } finally {
    index._setHandleForTests(null);
    if (previous === undefined) delete process.env.PETITION_AI_REVIEW;
    else process.env.PETITION_AI_REVIEW = previous;
  }
});

test("case facts: names of the people and companies on the case, de-duplicated; any read failure gives empty facts, never an error", async () => {
  const user = (id, name) => ({ _id: id, name });
  const [b, p, c] = [new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId()];
  const facts = buildFacts({ caseDoc: { caseNumber: "B243-A", visaType: "H-1B", beneficiaryUser: b, petitionerUser: p, user: c, clientName: "Dylan Zhang", petitionerName: "Ana Corp" }, usersById: new Map([[String(b), user(b, "Dylan Zhang")], [String(p), user(p, "Jo Smith")], [String(c), user(c, "Dylan Zhang")]]), company: { legalName: "Ana Corporation Inc", name: "Ana Corp" } });
  assert.deepEqual(facts.people, [{ role: "Beneficiary", name: "Dylan Zhang" }, { role: "Petitioner", name: "Jo Smith" }]);
  assert.deepEqual(facts.companies.map((x) => x.name), ["Ana Corporation Inc", "Ana Corp"]);
  const broken = { findById: () => { throw new Error("db down"); } };
  assert.deepEqual(await loadCaseFacts(new Types.ObjectId(), { Case: broken, User: broken }), { caseNumber: "", visaType: "", people: [], companies: [] });
});
