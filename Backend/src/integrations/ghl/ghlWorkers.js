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

  setTimeout(tick, Number(process.env.GHL_WORKER_INITIAL_DELAY_MS || 10000));
  logger.info("ghl_workers_started", { intervalMs });
  return setInterval(tick, intervalMs);
}

module.exports = { startGhlWorkers };
