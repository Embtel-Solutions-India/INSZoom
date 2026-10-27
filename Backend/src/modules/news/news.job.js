// The scheduled side of the USCIS news synchronisation. A one-minute ticker (so it can be cleared like the other jobs' timers at shutdown) decides whether a run is due:
// every NEWS_SYNC_INTERVAL_MS (default 30 min), or NEWS_SYNC_BACKLOG_INTERVAL_MS (default 2 min) while imported-but-waiting articles remain (the first backfill of the feed).
// A restart simply starts the clock again after NEWS_SYNC_INITIAL_DELAY_MS; nothing is lost because waiting articles live in MongoDB. The run itself is lease-locked
// (NewsSyncService), so overlapping ticks or a second server instance cannot run it twice. NEWS_SYNC_ENABLED=false turns the schedule off. It never throws.
const logger = require("../../utils/logger");
const { getConfig } = require("./news.config");
const { createSyncService } = require("./NewsSyncService");

let service = null;
const syncService = () => {
  if (!service) service = createSyncService();
  return service;
};

function startNewsSyncJob({ tickMs = 60 * 1000 } = {}) {
  const config = getConfig();
  if (!config.enabled) return null;
  let nextDueAt = Date.now() + config.initialDelayMs;
  let busy = false;
  const tick = async () => {
    if (busy || Date.now() < nextDueAt) return;
    busy = true;
    try {
      const result = await syncService().runSync({ trigger: "schedule" });
      // hurry only while there is work USCIS can be asked for; an unreachable feed is retried at the normal pace, not every two minutes
      const waiting = Number(result?.backlog) > 0 && !result?.skipped && !result?.feedError;
      nextDueAt = Date.now() + (waiting ? config.backlogIntervalMs : config.intervalMs);
    } catch (error) {
      logger.error("news_sync_tick_failed", { error: error?.message });
      nextDueAt = Date.now() + config.intervalMs;
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, tickMs);
  timer.unref?.();
  return timer;
}

module.exports = { startNewsSyncJob, syncService };
