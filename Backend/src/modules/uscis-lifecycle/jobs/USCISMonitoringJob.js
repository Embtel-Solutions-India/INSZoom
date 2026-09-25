const USCISScannerService = require("../services/USCISScannerService");

async function runUSCISMonitoringJob(options = {}, user, req) {
  return USCISScannerService.scanAll(options, user, req);
}

function startUSCISMonitoringJob() {
  // Confirmed empirically (this ran, unattended, against real uscis.gov):
  // scanAll()'s full crawl walks the ENTIRE "all-forms" directory (up to
  // USCIS_SYNC_MAX_PAGES pages) and attempts to import every form code it
  // finds there - not just the forms this system already knows about - and
  // each import can take 100+ seconds for a complex hybrid PDF (measured:
  // I-129 alone). That is real, sustained external load against a
  // government site plus many new DB writes/notifications, not something to
  // default on for every developer's machine just because the manual
  // "Sync Now" timeout bug (fixed separately - see beginScanRun/
  // executeScanRun) is unrelated to this gate. Left as the original
  // opt-in-outside-production behavior: explicit USCIS_MONITORING_ENABLED=
  // true still enables it anywhere, including localhost.
  const configured = process.env.USCIS_MONITORING_ENABLED;
  const enabled = configured === "true" || (configured === undefined && process.env.NODE_ENV === "production");
  if (!enabled) return null;
  const intervalMs = Number(process.env.USCIS_MONITORING_INTERVAL_MS || 24 * 60 * 60 * 1000);
  const initialDelayMs = Number(process.env.USCIS_MONITORING_INITIAL_DELAY_MS || 60 * 1000);
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runUSCISMonitoringJob({ trigger: "scheduled" });
    } catch (error) {
      console.error("USCIS monitoring failed:", error.message);
    } finally {
      running = false;
    }
  };
  const initialRun = setTimeout(run, Math.max(initialDelayMs, 0));
  initialRun.unref?.();
  return setInterval(run, intervalMs);
}

module.exports = { runUSCISMonitoringJob, startUSCISMonitoringJob };
