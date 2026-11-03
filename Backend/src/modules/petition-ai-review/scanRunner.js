// Runs ONE claimed petition scan from its saved page to the end (Petition AI Review). Used by the worker.
//
//   const runScan = createScanRunner(deps);
//   const outcome = await runScan({ scan, lease });   // never rejects
//
// Order: read the petition (cached buffer) -> open the page reader (separate process) -> plan pages (first claim only) -> review batches in
// rounds of `concurrency`, storing each range and moving the cursor -> re-review the ranges that failed for a temporary reason (at most twice)
// -> summary -> completed / completed_with_gaps.
// Every way out is decided here, in code:
//   petition deleted                      -> closed as cancelled with the reason
//   no AI key and no backup AI            -> not_configured (a message, never an error)
//   PDF locked with a password / unreadable / empty -> failed with a plain message (the same file would fail again)
//   storage error, reader crash, anything unexpected -> retried with backoff (attempts), then failed with Retry available
//   AI billing / quota / rejected key     -> paused; re-checked automatically every 30 minutes from the same page
//   cancelled or taken over by another worker (lease lost) -> stops at once, writes nothing more
//   server shutting down                  -> hands the scan back unchanged so the restart resumes at once
const { SCAN_STATUS, AI_ERROR, PDF_ERROR } = require("./constants");
const { planBatches } = require("./batchPlanner");
const { createBatchReviewer } = require("./batchReviewer");
const { buildSystemInstruction } = require("./prompt");
const { dedupeFindings, unreadableFinding } = require("./findingValidator");
const { buildSummary, withAiSummary } = require("./summaryBuilder");
const { ScanLeaseLostError } = require("./scanService");
const { PetitionAiError } = require("./petitionGemini");

const MAX_RETRY_TRIES = 2;
const PERMANENT_PDF_ERRORS = new Set([PDF_ERROR.ENCRYPTED, PDF_ERROR.UNREADABLE, PDF_ERROR.EMPTY]);
const PDF_MESSAGES = Object.freeze({
  [PDF_ERROR.ENCRYPTED]: "The petition PDF is locked with a password, so it cannot be read. Upload an unprotected copy to scan it.",
  [PDF_ERROR.UNREADABLE]: "The petition PDF is damaged or not a real PDF, so it cannot be read. Upload a fresh copy to scan it.",
  [PDF_ERROR.EMPTY]: "The petition PDF has no pages.",
});
const PAUSE_MESSAGES = Object.freeze({
  [AI_ERROR.BILLING]: "AI billing: the prepaid credits are used up. Top up in Google AI Studio - the scan resumes by itself (checked every 30 minutes), or press Retry.",
  [AI_ERROR.QUOTA]: "AI quota reached for now. The scan resumes by itself (checked every 30 minutes), or press Retry.",
  [AI_ERROR.BAD_REQUEST]: "The AI rejected the request (API key or model setting). The scan re-checks every 30 minutes and resumes once it is fixed, or press Retry.",
});
const NOT_CONFIGURED_MESSAGE = "AI review is not set up: no AI key is configured on the server (GEMINI_API_KEY or PETITION_AI_API_KEY).";

const defaultSleep = (ms) => new Promise((resolve) => { const timer = setTimeout(resolve, ms); timer.unref?.(); });

/**
 * deps: { scanService, config, loadDocument(id), readBuffer(document), openReader(buffer), loadFacts(caseId), loadRules(), createCaller(), createFallback(),
 *         sleep, logger, shouldStop(), onFinished(scanId, outcome), heartbeatMs }
 */
function createScanRunner(deps) {
  const { scanService, config, logger = console } = deps;
  const sleep = deps.sleep || defaultSleep;
  const shouldStop = deps.shouldStop || (() => false);
  const heartbeatMs = deps.heartbeatMs || 40 * 1000;

  return async function runScan({ scan, lease }) {
    let reader = null;
    let heartbeat = null;
    let leaseLost = false;
    try {
      // keep the lease alive during long AI calls; a lost lease (cancel / take-over) makes the next step stop
      heartbeat = setInterval(() => {
        scanService.heartbeat(scan._id, lease).catch((error) => { if (error instanceof ScanLeaseLostError) leaseLost = true; });
      }, heartbeatMs);
      heartbeat.unref?.();
      const checkLease = () => { if (leaseLost) throw new ScanLeaseLostError(); };

      const document = await deps.loadDocument(scan.documentId);
      if (!document || document.deletedAt) return finish(await scanService.close(scan._id, lease, { status: SCAN_STATUS.CANCELLED, code: "DOCUMENT_GONE", message: "The petition was deleted, so there is nothing to scan." }));

      const caller = deps.createCaller();
      const fallback = deps.createFallback();
      if (!caller && !fallback) return finish(await scanService.close(scan._id, lease, { status: SCAN_STATUS.NOT_CONFIGURED, code: AI_ERROR.NOT_CONFIGURED, message: NOT_CONFIGURED_MESSAGE }));

      let buffer;
      try {
        buffer = await deps.readBuffer(document);
      } catch (error) {
        return finish(await scanService.release(scan, lease, { code: "STORAGE", message: `The petition file could not be read from storage (${error?.message || "error"}).` }));
      }
      try {
        reader = await deps.openReader(buffer);
      } catch (error) {
        if (PERMANENT_PDF_ERRORS.has(error?.code)) return finish(await scanService.close(scan._id, lease, { status: SCAN_STATUS.FAILED, code: error.code, message: PDF_MESSAGES[error.code] }));
        return finish(await scanService.release(scan, lease, { code: error?.code || "PDF_READER", message: `The PDF reader could not open the petition (${error?.message || "error"}).` }));
      }
      buffer = null; // the reader process has its own copy

      // first claim: the page plan (a resumed scan keeps the plan it started with)
      let lastPage = scan.lastPage;
      let skippedFrom = scan.skippedFrom ?? null;
      const batchSize = scan.totalPages ? scan.batchSize || config.pagesPerCall : config.pagesPerCall;
      if (!scan.totalPages) {
        const plan = planBatches({ totalPages: reader.pages, batchSize, startPage: 1, maxPages: config.maxPages });
        lastPage = plan.lastPage;
        skippedFrom = plan.skippedFrom;
        await scanService.start(scan._id, lease, { totalPages: reader.pages, lastPage, skippedFrom, batchSize, startedAt: scan.startedAt });
      }
      const totalPages = scan.totalPages || reader.pages;

      const [facts, ruleSet] = await Promise.all([deps.loadFacts(scan.caseId), deps.loadRules()]);
      const reviewer = createBatchReviewer({ reader, caller: caller || fallback, fallbackCaller: caller ? fallback : null, systemInstruction: buildSystemInstruction({ facts, ruleSet }) });
      const gapsSoFar = (scan.gaps || []).map((gap) => ({ from: gap.from, to: gap.to, reason: gap.reason }));
      let retryRanges = (scan.retryRanges || []).map((range) => ({ from: range.from, to: range.to, tries: range.tries || 0, reason: range.reason }));

      // ── main pass, from the saved cursor ──
      let next = Math.max(1, scan.nextPage || 1);
      while (next <= lastPage) {
        checkLease();
        if (shouldStop()) return finish(await scanService.yieldLease(scan._id, lease));
        const round = planBatches({ totalPages: lastPage, batchSize, startPage: next }).batches.slice(0, Math.max(1, config.concurrency));
        const results = await Promise.allSettled(round.map((batch) => reviewer.review(batch)));
        for (let index = 0; index < round.length; index += 1) {
          const result = results[index];
          if (result.status === "rejected") return finish(await stopped(result.reason, scan, lease, next)); // later batches of the round are re-done on resume
          const batch = round[index];
          const { kept, retry } = splitGaps(result.value.gaps);
          gapsSoFar.push(...kept);
          retryRanges.push(...retry);
          await scanService.recordProgress(scan, lease, {
            from: batch.from, to: batch.to, findings: result.value.findings, gaps: kept, retryRanges: retry, diagnostics: result.value.diagnostics,
            calls: result.value.calls, tokens: result.value.tokens, nextPage: batch.to + 1, pagesDone: batch.to, usedFallback: result.value.usedFallback, modelUsed: result.value.models[0],
          });
          next = batch.to + 1;
        }
        if (next <= lastPage && config.batchDelayMs) await sleep(config.batchDelayMs);
      }

      // ── pages whose AI call failed for a temporary reason, at most MAX_RETRY_TRIES more times each ──
      while (retryRanges.some((range) => range.tries < MAX_RETRY_TRIES)) {
        checkLease();
        if (shouldStop()) return finish(await scanService.yieldLease(scan._id, lease));
        const range = retryRanges.find((item) => item.tries < MAX_RETRY_TRIES);
        let result;
        try {
          result = await reviewer.review({ from: range.from, to: range.to });
        } catch (error) {
          return finish(await stopped(error, scan, lease, next));
        }
        const { kept, retry } = splitGaps(result.gaps);
        const remaining = retryRanges.filter((item) => item !== range);
        if (retry.length) remaining.push(...retry.map((item) => ({ ...item, tries: range.tries + 1 })));
        gapsSoFar.push(...kept);
        await scanService.recordProgress(scan, lease, { from: range.from, to: range.to, findings: result.findings, gaps: kept, diagnostics: result.diagnostics, calls: result.calls, tokens: result.tokens, usedFallback: result.usedFallback });
        retryRanges = remaining;
        await scanService.setRetryRanges(scan._id, lease, retryRanges);
        if (config.batchDelayMs) await sleep(config.batchDelayMs * 4);
      }
      // still failing after the retries: flagged page by page so nobody assumes they were checked
      for (const range of retryRanges) {
        const reason = "the AI service kept failing for this page";
        const findings = [];
        for (let page = range.from; page <= range.to; page += 1) findings.push(unreadableFinding(page, reason));
        gapsSoFar.push({ from: range.from, to: range.to, reason });
        await scanService.recordProgress(scan, lease, { from: range.from, to: range.to, findings, gaps: [{ from: range.from, to: range.to, reason }] });
      }
      if (retryRanges.length) await scanService.setRetryRanges(scan._id, lease, []);

      // ── summary ──
      checkLease();
      const stored = await scanService.loadFindings(scan._id);
      const unique = dedupeFindings(stored.map((item) => ({ ...item })));
      const keep = new Set(unique.map((item) => String(item._id)));
      await scanService.deleteFindings(stored.filter((item) => !keep.has(String(item._id))).map((item) => item._id));
      const gaps = mergeGaps(gapsSoFar);
      let summary = buildSummary({ findings: unique, gaps, totalPages, lastPage, skippedFrom });
      summary = await withAiSummary({ summary, findings: unique, caller: reviewer.usingFallback ? null : caller });
      const status = gaps.length ? SCAN_STATUS.COMPLETED_WITH_GAPS : SCAN_STATUS.COMPLETED;
      const { counts, byPage, byCategory, text } = summary;
      return finish(await scanService.complete(scan._id, lease, { status, counts, summary: { text, byPage, byCategory }, gaps }));
    } catch (error) {
      if (error instanceof ScanLeaseLostError || leaseLost) return { state: "lease_lost" };
      logger.error?.("petition_ai_scan_unexpected", { scanId: String(scan._id), error: error?.message });
      try {
        return finish(await scanService.release(scan, lease, { code: "UNEXPECTED", message: `Unexpected error: ${error?.message || error}` }));
      } catch (releaseError) {
        // lease already lost or the database is unreachable: the lease expires and another pass resumes the scan
        return { state: "abandoned", error: releaseError?.message };
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (reader) await Promise.resolve().then(() => reader.close()).catch(() => null);
    }

    function finish(outcome) {
      if (outcome?.state && deps.onFinished) Promise.resolve().then(() => deps.onFinished(scan._id, outcome)).catch(() => null);
      return outcome;
    }
  };

  async function stopped(error, scan, lease, nextPage) {
    if (error instanceof ScanLeaseLostError) throw error;
    if (error instanceof PetitionAiError && error.stopsRun) {
      if (error.code === AI_ERROR.NOT_CONFIGURED) return scanService.close(scan._id, lease, { status: SCAN_STATUS.NOT_CONFIGURED, code: error.code, message: NOT_CONFIGURED_MESSAGE });
      return scanService.pause({ ...scan, nextPage }, lease, { code: error.code, message: PAUSE_MESSAGES[error.code] || error.note });
    }
    throw error; // unexpected: handled by the runner's catch (release with backoff)
  }
}

/** The reviewer's gaps: pages that cannot be read (kept) vs. pages to review again later (retry). */
function splitGaps(gaps = []) {
  const kept = [];
  const retry = [];
  for (const gap of gaps) {
    if (gap.retry) retry.push({ from: gap.from, to: gap.to, tries: 0, reason: gap.reason });
    else kept.push({ from: gap.from, to: gap.to, reason: gap.reason });
  }
  return { kept, retry };
}

/** Sorted, de-duplicated gaps (the same page can be reported by a retried range). */
function mergeGaps(gaps) {
  const seen = new Map();
  for (const gap of gaps) {
    for (let page = gap.from; page <= gap.to; page += 1) if (!seen.has(page)) seen.set(page, gap.reason);
  }
  const pages = [...seen.keys()].sort((a, b) => a - b);
  const merged = [];
  for (const page of pages) {
    const last = merged[merged.length - 1];
    if (last && last.to === page - 1 && last.reason === seen.get(page)) last.to = page;
    else merged.push({ from: page, to: page, reason: seen.get(page) });
  }
  return merged;
}

module.exports = { createScanRunner, splitGaps, mergeGaps, MAX_RETRY_TRIES, PAUSE_MESSAGES, PDF_MESSAGES, NOT_CONFIGURED_MESSAGE };
