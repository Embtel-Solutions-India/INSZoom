// Every operation on a PetitionAiScan (Petition AI Review) - the same lease + fence pattern as form-pipeline/FormPipelineJobService.js.
// A worker claims a scan with a LEASE (token + fence number); every write it makes afterwards is conditional on that token AND fence AND the
// scan still being open, so a worker whose lease expired (or whose scan was cancelled) cannot change anything (ScanLeaseLostError).
//
//   enqueue            -> one open scan per petition (a second request returns the open one)
//   claimNext          -> atomic claim of the next due scan; a scan whose worker died (lease expired) is claimable again and resumes at nextPage
//   recoverExhausted   -> a scan that keeps dying (attempts used up) is closed as failed, with Retry available
//   start / heartbeat / recordProgress / setRetryRanges -> fenced writes while scanning
//   pause / release / yieldLease / complete / close -> leaving the worker (wait for the AI, retry later, hand back on shutdown, finish, stop)
//   cancel / retry / rescan -> what the team can do (Phase 4 API)
const crypto = require("crypto");
const PetitionAiScan = require("../../models/PetitionAiScan");
const PetitionAiFinding = require("../../models/PetitionAiFinding");
const { SCAN_STATUS, OPEN_STATUSES, LIMITS } = require("./constants");

const MINUTE = 60 * 1000;
const TIMING = Object.freeze({
  leaseMs: 2 * MINUTE,
  pauseMs: 30 * MINUTE, // billing / quota / rejected key: the scan re-checks by itself this often
  maxPauseMs: 7 * 24 * 60 * MINUTE, // ... for at most a week, then it is closed as failed (Retry reopens it)
  backoffBaseMs: MINUTE, // temporary errors: 1, 2, 4, 8 ... minutes
  backoffMaxMs: 30 * MINUTE,
});

class ScanLeaseLostError extends Error {
  constructor() {
    super("This scan is no longer held by this worker (cancelled, finished or taken over).");
    this.name = "ScanLeaseLostError";
    this.code = "LEASE_LOST";
  }
}

const backoffMs = (attempts) => Math.min(TIMING.backoffMaxMs, TIMING.backoffBaseMs * 2 ** Math.max(0, attempts - 1));
const message = (value) => String(value || "").slice(0, 500);
const isDuplicateKey = (error) => error?.code === 11000;
const cleared = { "lease.lockedUntil": null, "lease.token": null };
const NO_ERROR = Object.freeze({ code: null, message: "", at: null });

function createScanService({ Scan = PetitionAiScan, Finding = PetitionAiFinding, now = () => new Date(), timing = TIMING } = {}) {
  const leaseFilter = (scanId, lease) => ({ _id: scanId, open: true, status: SCAN_STATUS.SCANNING, "lease.token": lease.token, "lease.fence": lease.fence });

  async function fenced(scanId, lease, update) {
    const result = await Scan.updateOne(leaseFilter(scanId, lease), update);
    if (result.matchedCount !== 1) throw new ScanLeaseLostError();
    return result;
  }

  /** Reads the scan fresh and proves the caller still holds a live lease. Returns the scan. */
  async function assertLease(scanId, lease) {
    const scan = await Scan.findOne(leaseFilter(scanId, lease)).lean();
    if (!scan || !scan.lease?.lockedUntil || new Date(scan.lease.lockedUntil) <= now()) throw new ScanLeaseLostError();
    return scan;
  }

  /** One open scan per petition: returns { scan, created }. */
  async function enqueue({ caseId, documentId, documentName = "", trigger = "upload", requestedBy = null, batchSize, maxAttempts } = {}) {
    const open = await Scan.findOne({ documentId, open: true }).lean();
    if (open) return { scan: open, created: false };
    try {
      const created = await Scan.create({
        caseId, documentId, documentName: String(documentName || "").slice(0, 300), trigger, requestedBy,
        status: SCAN_STATUS.QUEUED, open: true, nextPage: 1, ...(batchSize ? { batchSize } : {}), ...(maxAttempts ? { maxAttempts } : {}),
      });
      return { scan: typeof created.toObject === "function" ? created.toObject() : created, created: true };
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      // two uploads of the same petition at the same moment: the other one won, use its scan
      const existing = await Scan.findOne({ documentId, open: true }).lean();
      if (existing) return { scan: existing, created: false };
      throw error;
    }
  }

  /** Atomically claims the next due scan (queued, or scanning with an expired lease). Returns { scan, lease } or null. */
  async function claimNext({ workerId = "worker" } = {}) {
    const at = now();
    const token = crypto.randomUUID();
    const scan = await Scan.findOneAndUpdate(
      {
        open: true,
        status: { $in: OPEN_STATUSES },
        $and: [
          { $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: at } }] },
          { $or: [{ "lease.lockedUntil": null }, { "lease.lockedUntil": { $lt: at } }] },
        ],
      },
      {
        $set: { status: SCAN_STATUS.SCANNING, "lease.token": token, "lease.lockedUntil": new Date(at.getTime() + timing.leaseMs), "lease.workerId": workerId },
        $inc: { attempts: 1, "lease.fence": 1 },
      },
      { new: true, sort: { nextAttemptAt: 1, createdAt: 1 } }
    ).lean();
    if (!scan) return null;
    return { scan, lease: { token: scan.lease.token, fence: scan.lease.fence } };
  }

  /** Scans whose worker kept dying (lease expired, attempts used up) are closed as failed instead of being claimed forever. */
  async function recoverExhausted() {
    const at = now();
    const stale = await Scan.find({ open: true, "lease.lockedUntil": { $lt: at } }).select("_id attempts maxAttempts").limit(50).lean();
    let closed = 0;
    for (const item of stale) {
      if ((item.attempts || 0) < (item.maxAttempts || 5)) continue;
      const result = await Scan.updateOne(
        { _id: item._id, open: true, "lease.lockedUntil": { $lt: at }, attempts: item.attempts },
        { $set: { status: SCAN_STATUS.FAILED, open: false, finishedAt: at, ...cleared, error: { code: "WORKER_LOST", message: "The scan stopped repeatedly before it could finish. Press Retry to continue from the page it reached.", at } } }
      );
      closed += result.matchedCount || 0;
    }
    return closed;
  }

  async function heartbeat(scanId, lease) {
    await fenced(scanId, lease, { $set: { "lease.lockedUntil": new Date(now().getTime() + timing.leaseMs) } });
  }

  /** First claim of a scan: the page plan. */
  async function start(scanId, lease, { totalPages, lastPage, skippedFrom = null, batchSize, startedAt } = {}) {
    await fenced(scanId, lease, { $set: { totalPages, lastPage, skippedFrom, batchSize, startedAt: startedAt || now(), "lease.lockedUntil": new Date(now().getTime() + timing.leaseMs) } });
  }

  /**
   * Stores one reviewed page range and moves the cursor. Idempotent: the range's earlier findings (from a worker that died before moving
   * the cursor) are replaced, never duplicated.
   */
  async function recordProgress(scan, lease, { from, to, findings = [], gaps = [], retryRanges = [], diagnostics = [], calls = 0, tokens = 0, nextPage, pagesDone, usedFallback = false, modelUsed } = {}) {
    const scanId = scan._id;
    await assertLease(scanId, lease);
    await Finding.deleteMany({ scanId, page: { $gte: from, $lte: to } });
    if (findings.length) await Finding.insertMany(findings.map((finding) => ({ ...finding, scanId, caseId: scan.caseId, documentId: scan.documentId })), { ordered: false });
    const set = { "lease.lockedUntil": new Date(now().getTime() + timing.leaseMs) };
    if (nextPage !== undefined) set.nextPage = nextPage;
    if (pagesDone !== undefined) set.pagesDone = pagesDone;
    if (usedFallback) set.usedFallback = true;
    if (modelUsed) set.modelUsed = modelUsed;
    const push = {};
    if (gaps.length) push.gaps = { $each: gaps.map(({ from: f, to: t, reason }) => ({ from: f, to: t, reason })) };
    if (retryRanges.length) push.retryRanges = { $each: retryRanges };
    if (diagnostics.length) push.diagnostics = { $each: diagnostics, $slice: -LIMITS.maxDiagnostics };
    await fenced(scanId, lease, { $set: set, ...(Object.keys(push).length ? { $push: push } : {}), $inc: { "usage.calls": calls, "usage.tokens": tokens } });
  }

  async function setRetryRanges(scanId, lease, ranges) {
    await fenced(scanId, lease, { $set: { retryRanges: ranges, "lease.lockedUntil": new Date(now().getTime() + timing.leaseMs) } });
  }

  /** Every finding of a scan (for the summary). */
  async function loadFindings(scanId) {
    return Finding.find({ scanId }).select("_id page severity category excerpt found suggestion confidence").sort({ page: 1 }).lean();
  }

  async function deleteFindings(ids = []) {
    if (ids.length) await Finding.deleteMany({ _id: { $in: ids } });
  }

  /** The AI stopped for billing / quota / a rejected key: wait and re-check by itself. After a week of waiting the scan is closed as failed. */
  async function pause(scan, lease, { code, message: text } = {}) {
    const at = now();
    const since = scan.paused?.since ? new Date(scan.paused.since) : at;
    if (at.getTime() - since.getTime() >= timing.maxPauseMs) {
      return close(scan._id, lease, { status: SCAN_STATUS.FAILED, code, message: `${message(text)} The scan waited a week for the AI to work again. Press Retry to continue from page ${scan.nextPage || 1}.` });
    }
    const nextAttemptAt = new Date(at.getTime() + timing.pauseMs);
    await fenced(scan._id, lease, {
      $set: { status: SCAN_STATUS.QUEUED, nextAttemptAt, attempts: 0, ...cleared, paused: { code, message: message(text), since }, error: { code, message: message(text), at } },
    });
    return { state: "paused", nextAttemptAt };
  }

  /** A temporary failure (storage, reader crash, unexpected error): retried with backoff until the attempts run out, then failed. */
  async function release(scan, lease, { code = "TEMPORARY", message: text = "" } = {}) {
    const attempts = scan.attempts || 1;
    if (attempts >= (scan.maxAttempts || 5)) {
      return close(scan._id, lease, { status: SCAN_STATUS.FAILED, code, message: `${message(text)} The scan could not finish after ${attempts} attempts. Press Retry to continue from page ${scan.nextPage || 1}.` });
    }
    const nextAttemptAt = new Date(now().getTime() + backoffMs(attempts));
    await fenced(scan._id, lease, { $set: { status: SCAN_STATUS.QUEUED, nextAttemptAt, ...cleared, error: { code, message: message(text), at: now() } } });
    return { state: "retrying", nextAttemptAt };
  }

  /** The server is shutting down: hand the scan back at once without using up an attempt, so a restart resumes immediately. */
  async function yieldLease(scanId, lease) {
    await fenced(scanId, lease, { $set: { status: SCAN_STATUS.QUEUED, nextAttemptAt: null, ...cleared }, $inc: { attempts: -1 } });
    return { state: "yielded" };
  }

  async function complete(scanId, lease, { status, counts, summary, gaps } = {}) {
    const at = now();
    await fenced(scanId, lease, {
      $set: {
        status, open: false, counts, summary: { ...summary, builtAt: at }, gaps, retryRanges: [], finishedAt: at, nextAttemptAt: null, ...cleared,
        paused: { code: null, message: "", since: null }, error: NO_ERROR,
      },
    });
    return { state: status };
  }

  /** Ends the scan with a reason (failed, cancelled, not_configured). */
  async function close(scanId, lease, { status, code, message: text } = {}) {
    const at = now();
    await fenced(scanId, lease, { $set: { status, open: false, finishedAt: at, nextAttemptAt: null, ...cleared, error: { code, message: message(text), at } } });
    return { state: status };
  }

  // ── what the team can do (Phase 4 API) ────────────────────────────────
  /** Stops an open scan. The worker's next fenced write then fails and it stops without changing anything. */
  async function cancel(scanId) {
    const at = now();
    const result = await Scan.updateOne({ _id: scanId, open: true }, { $set: { status: SCAN_STATUS.CANCELLED, open: false, finishedAt: at, nextAttemptAt: null, ...cleared, paused: { code: null, message: "", since: null } } });
    return result.matchedCount === 1;
  }

  /**
   * Retry: a waiting (paused / retrying) scan is re-checked now; a failed or cancelled scan is reopened and continues from the page it reached.
   * Returns { scan, reopened } or { conflict } when the petition already has another open scan.
   */
  async function retry(scanId) {
    const now_ = await Scan.updateOne({ _id: scanId, open: true, status: SCAN_STATUS.QUEUED }, { $set: { nextAttemptAt: null } });
    if (now_.matchedCount === 1) return { scan: await Scan.findById(scanId).lean(), reopened: false };
    try {
      const result = await Scan.updateOne(
        { _id: scanId, open: false, status: { $in: [SCAN_STATUS.FAILED, SCAN_STATUS.CANCELLED] } },
        { $set: { status: SCAN_STATUS.QUEUED, open: true, attempts: 0, nextAttemptAt: null, finishedAt: null, error: NO_ERROR, ...cleared, paused: { code: null, message: "", since: null } } }
      );
      if (result.matchedCount !== 1) return { scan: await Scan.findById(scanId).lean(), reopened: false, notRetryable: true };
      return { scan: await Scan.findById(scanId).lean(), reopened: true };
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const scan = await Scan.findById(scanId).select("documentId").lean();
      return { conflict: scan ? await Scan.findOne({ documentId: scan.documentId, open: true }).lean() : null };
    }
  }

  /** A fresh scan of the petition from page 1 (returns the open one if a scan is already running). */
  async function rescan({ caseId, documentId, documentName, requestedBy, batchSize }) {
    return enqueue({ caseId, documentId, documentName, trigger: "manual", requestedBy, batchSize });
  }

  return {
    enqueue, claimNext, recoverExhausted, heartbeat, assertLease, start, recordProgress, setRetryRanges, loadFindings, deleteFindings,
    pause, release, yieldLease, complete, close, cancel, retry, rescan,
  };
}

module.exports = { createScanService, ScanLeaseLostError, TIMING, backoffMs };
