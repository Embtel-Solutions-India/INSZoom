const USCISScannerService = require("../services/USCISScannerService");

async function runUSCISMonitoringJob(options = {}, user, req) {
  return USCISScannerService.scanAll(options, user, req);
}

function startUSCISMonitoringJob() {
  const configured = process.env.USCIS_MONITORING_ENABLED;
  const enabled = configured === "true" || (configured === undefined && process.env.NODE_ENV === "production");
  if (!enabled) return null;
  const intervalMs = Number(process.env.USCIS_MONITORING_INTERVAL_MS || 24 * 60 * 60 * 1000);
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
  run();
  return setInterval(run, intervalMs);
}

module.exports = { runUSCISMonitoringJob, startUSCISMonitoringJob };
