// The petition scan worker (Petition AI Review): polls for due scans (cheap indexed claim), runs ONE scan at a time per server, closes scans
// that keep dying, and stops gracefully (the running scan is handed back so a restart resumes it at once). kick() starts a pass right away
// after an upload instead of waiting for the next poll. A pass can never overlap another, and no error escapes a pass.
const os = require("os");

function createScanWorker({ scanService, runScan, workerId = `${os.hostname()}:${process.pid}`, intervalMs = 20000, logger = console, random = Math.random } = {}) {
  if (!scanService || !runScan) throw new Error("createScanWorker needs a scanService and a runScan");
  let timer = null;
  let started = false;
  let stopping = false;
  let running = null; // the current pass (a promise)
  let again = false; // a kick arrived during a pass: run one more pass right after it

  async function pass() {
    const outcomes = [];
    try {
      await scanService.recoverExhausted().catch((error) => logger.warn?.("petition_ai_recover_failed", { error: error.message }));
      // one scan at a time per server, but keep going while scans are waiting (each pass is bounded by the scans that are due)
      for (let i = 0; i < 10 && !stopping; i += 1) {
        const claim = await scanService.claimNext({ workerId });
        if (!claim) break;
        outcomes.push({ scanId: String(claim.scan._id), ...(await runScan(claim)) });
      }
    } catch (error) {
      logger.error?.("petition_ai_worker_pass_failed", { error: error?.message });
    }
    return outcomes;
  }

  /** Runs a pass now unless one is running (then one more runs right after it). Resolves with the pass's outcomes. */
  function tick() {
    if (stopping) return Promise.resolve([]);
    if (running) {
      again = true;
      return running;
    }
    running = pass().finally(() => {
      running = null;
      if (again && !stopping) {
        again = false;
        tick();
      }
    });
    return running;
  }

  /** Called after an upload: start soon, outside the request. Never throws. */
  function kick() {
    if (!started || stopping) return;
    const handle = setImmediate(() => { tick().catch(() => null); });
    handle.unref?.();
  }

  function start() {
    if (started) return;
    started = true;
    stopping = false;
    const loop = async () => {
      await tick().catch(() => null);
      if (!stopping) { timer = setTimeout(loop, intervalMs); timer.unref?.(); }
    };
    timer = setTimeout(loop, Math.round(random() * intervalMs * 0.5) + 1000); // jittered first poll, after start-up settles
    timer.unref?.();
    logger.info?.("petition_ai_worker_started", { workerId, intervalMs });
  }

  /** Graceful stop: no new scan is claimed; the running one hands its lease back at its next step (or its lease expires on its own). */
  async function stop(timeoutMs = 15000) {
    stopping = true;
    started = false;
    if (timer) clearTimeout(timer);
    if (running) await Promise.race([running.catch(() => null), new Promise((resolve) => { const t = setTimeout(resolve, timeoutMs); t.unref?.(); })]);
    logger.info?.("petition_ai_worker_stopped", { workerId });
  }

  return { start, stop, tick, kick, workerId, isStopping: () => stopping, isRunning: () => started };
}

module.exports = { createScanWorker };
