const env = require("../../config/env");
const logger = require("../../utils/logger");

// Background loops for the GHL integration. Returns the interval handle (so
// shutdown can clear it) or null when the integration is off, in which case
// nothing at all is scheduled. Every unit of work is claimed atomically in
// Mongo, so running this on several backend instances is safe.
function startGhlWorkers() {
  if (!env.ghl.enabled || !env.ghl.token || !env.ghl.locationId) return null;

  const { processDueEvents } = require("./ghlWebhookService");
  const { processDueJobs } = require("./ghlOutboundService");
  const intervalMs = Number(process.env.GHL_WORKER_INTERVAL_MS || 5000);
  let running = false;

  const tick = async () => {
    if (running) return; // never overlap ticks within one process
    running = true;
    // Independent: a failure in one loop never starves the other.
    try {
      await processDueEvents();
    } catch (error) {
      logger.error("ghl_worker_events_failed", { error: error.message });
    }
    try {
      await processDueJobs();
    } catch (error) {
      logger.error("ghl_worker_jobs_failed", { error: error.message });
    } finally {
      running = false;
    }
  };

  // Safety net for the employee sync: finds employees whose hook never fired (for example one the employer named
  // through their own data entry). Cheap when nothing changed; one instance at a time via the shared job lock.
  const { withJobLock } = require("../../utils/jobLock");
  const sweepMs = Number(process.env.GHL_EMPLOYEE_SWEEP_MS || 5 * 60 * 1000);
  const sweep = () =>
    withJobLock("ghl-employee-sweep", sweepMs * 2, async () => {
      await require("./ghlAuxOutbound").sweep();
      await require("./ghlCaseOutbound").sweep();
    }).catch((error) => logger.error("ghl_employee_sweep_failed", { error: error.message }));
  // The sweep rides on the same interval (one handle for server.js to clear): at most once per sweepMs, first run after a delay.
  let lastSweep = Date.now() - sweepMs + Number(process.env.GHL_SWEEP_INITIAL_DELAY_MS || 60000);
  // Reconciliation: the safety net under the webhooks (and the only inbound sync if webhooks never arrive). Every
  // GHL_RECONCILE_MS (default 30 s, so a stage moved in GHL shows on the board within about half a minute), one instance at a time; the first run shortly after start.
  const reconcileMs = Number(process.env.GHL_RECONCILE_MS || 30 * 1000);
  const reconcile = () =>
    withJobLock("ghl-reconcile", Math.max(reconcileMs * 4, 5 * 60 * 1000), async () => {
      await require("./ghlReconcileService").reconcile();
    }).catch((error) => logger.error("ghl_reconcile_failed", { error: error.message }));
  let lastReconcile = Date.now() - reconcileMs + Number(process.env.GHL_RECONCILE_INITIAL_DELAY_MS || 20 * 1000);
  setTimeout(tick, Number(process.env.GHL_WORKER_INITIAL_DELAY_MS || 10000));
  logger.info("ghl_workers_started", { intervalMs, sweepMs });
  return setInterval(() => {
    tick();
    if (Date.now() - lastSweep >= sweepMs) {
      lastSweep = Date.now();
      sweep();
    }
    if (Date.now() - lastReconcile >= reconcileMs) {
      lastReconcile = Date.now();
      reconcile();
    }
  }, intervalMs);
}

module.exports = { startGhlWorkers };
