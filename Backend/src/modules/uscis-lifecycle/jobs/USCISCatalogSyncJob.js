const User = require("../../../models/User");
const logger = require("../../../utils/logger");
const { runCatalogSync } = require("../../uscis-form-import/services/FormCatalogSyncService");
const { runScheduledEditionChecks } = require("../../form-edition-policy/EditionPolicyScheduler");

// Every 12 hours (USCIS_CATALOG_SYNC_INTERVAL_MS): check EVERY form on uscis.gov - installed or not - and import the new / changed editions through the automatic
// pipeline (see FormCatalogSyncService). On by default; USCIS_CATALOG_SYNC=false turns it off. Lock-guarded across instances through the caller's withJobLock.
function startUSCISCatalogSyncJob(withJobLock) {
  if (String(process.env.USCIS_CATALOG_SYNC || "true").toLowerCase() === "false") return null;
  const intervalMs = Number(process.env.USCIS_CATALOG_SYNC_INTERVAL_MS || 12 * 60 * 60 * 1000);
  const initialDelayMs = Number(process.env.USCIS_CATALOG_SYNC_INITIAL_DELAY_MS || 10 * 60 * 1000);
  const run = () => withJobLock("uscis-catalog-sync", 3 * 60 * 60 * 1000, async () => {
    const actor = await User.findOne({ role: { $in: ["super_admin", "admin"] } }).sort({ createdAt: 1 });
    // Phase 5: the run is recorded for the governance overview AFTER it finishes; recording is fail-safe and never changes the run or its result
    const task = async () => {
      const synced = await runCatalogSync({ user: actor || { role: "super_admin" } });
      // leftover non-live copies of forms that are now live are cleared away - only after the open cases have moved onto the live edition and only when nothing references them
      // (StaleEditionCleanupService; USCIS_STALE_CLEANUP=false switches it off; it never throws)
      if (String(process.env.USCIS_STALE_CLEANUP || "true").toLowerCase() !== "false") await require("../../uscis-form-import/services/StaleEditionCleanupService").cleanupAll().catch(() => null);
      // the owner's decided parties are applied to the live forms, a finished-but-never-activated draft mapping is activated, a form with nothing to map reads "Fully mapped"
      // (MappingMaintenanceService; FORM_MAPPING_MAINTENANCE=false switches it off; it never throws)
      await require("../../form-mapping/services/MappingMaintenanceService").runAll().catch(() => null);
      // then the edition-acceptance check for every edition on file - owned by the form-edition-policy subsystem (default off, never throws)
      await runScheduledEditionChecks();
      return synced;
    };
    let governance = null;
    try { governance = require("../../form-governance/GovernanceRecorder"); } catch { /* governance bookkeeping is optional */ }
    return governance ? governance.timedRun("catalog_sync", task, require("../../form-governance/summaries").summarizeCatalogSync) : task();
  }).catch((error) => logger.error("uscis_catalog_sync_failed", { error: error.message }));
  const initial = setTimeout(run, Math.max(initialDelayMs, 0));
  initial.unref?.();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = { startUSCISCatalogSyncJob };
