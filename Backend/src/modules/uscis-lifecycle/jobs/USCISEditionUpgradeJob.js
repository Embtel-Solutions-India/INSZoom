const User = require("../../../models/User");
const logger = require("../../../utils/logger");
const { upgradeTrackedForms } = require("../../uscis-form-import/services/FormEditionUpgradeService");

// Daily, off by default outside production (same gate as the monitoring job); USCIS_EDITION_UPGRADE_ENABLED=true turns it on anywhere.
// withJobLock (utils/jobLock) makes a tick skip when another instance - or the catalog sync - already holds the lock; without it (tests) the job just runs.
function startUSCISEditionUpgradeJob(withJobLock) {
  const configured = process.env.USCIS_EDITION_UPGRADE_ENABLED;
  const enabled = configured === "true" || (configured === undefined && process.env.NODE_ENV === "production");
  if (!enabled) return null;
  const intervalMs = Number(process.env.USCIS_EDITION_UPGRADE_INTERVAL_MS || 24 * 60 * 60 * 1000);
  const initialDelayMs = Number(process.env.USCIS_EDITION_UPGRADE_INITIAL_DELAY_MS || 5 * 60 * 1000);
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const task = async () => {
        const actor = await User.findOne({ role: { $in: ["super_admin", "admin"] } }).sort({ createdAt: 1 });
        const upgrade = () => upgradeTrackedForms({ user: actor || { role: "super_admin" } });
        // Phase 5: recorded for the governance overview AFTER the run; recording is fail-safe and never changes the run or its result
        let governance = null;
        try { governance = require("../../form-governance/GovernanceRecorder"); } catch { /* governance bookkeeping is optional */ }
        return governance ? governance.timedRun("edition_upgrade", upgrade, require("../../form-governance/summaries").summarizeUpgrade) : upgrade();
      };
      await (withJobLock ? withJobLock("uscis-edition-upgrade", 3 * 60 * 60 * 1000, task) : task());
    } catch (error) {
      logger.error("uscis_edition_upgrade_failed", { error: error.message });
    } finally {
      running = false;
    }
  };
  const initial = setTimeout(run, Math.max(initialDelayMs, 0));
  initial.unref?.();
  return setInterval(run, intervalMs);
}

module.exports = { startUSCISEditionUpgradeJob };
