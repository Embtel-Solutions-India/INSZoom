// Phase 3 release maintenance: the recovery sweeps that finish what a crash interrupted. Started by the API process at start-up (server.js), idempotent, per-item isolated.
//   reconcilePromotions            an edition that went live but whose predecessor was never retired (or the reverse): finished, or reverted when the acceptance gate no longer holds
//   reconcileIncompleteMigrations  a case form interrupted between "saved on the new edition" and "verified": resumed from its recorded step
// Both only ever RESUME or RECOVER; neither starts a promotion or a migration. FORM_RELEASE_RECONCILE_ENABLED=false turns the timer off (recovery then needs a person); the
// acceptance gate itself has no switch.
const logger = require("../../utils/logger");

async function runReconcileOnce() {
  const VersionManagementService = require("../uscis-lifecycle/services/VersionManagementService");
  const { reconcileIncompleteMigrations } = require("../form-mapping/services/CaseFormEditionMigrationService");
  const promotions = await VersionManagementService.reconcilePromotions();
  const migrations = await reconcileIncompleteMigrations({ limit: Number(process.env.FORM_RELEASE_RECONCILE_BATCH || 25) });
  if (promotions.length || migrations.resumed || migrations.reconciliationRequired || migrations.failed) logger.info("form_release_reconciled", { promotions, migrations });
  return { promotions, migrations };
}

function startFormReleaseMaintenance({ withJobLock } = {}) {
  if (String(process.env.FORM_RELEASE_RECONCILE_ENABLED || "true").toLowerCase() === "false") return null;
  const intervalMs = Number(process.env.FORM_RELEASE_RECONCILE_INTERVAL_MS || 5 * 60 * 1000);
  const run = () => (withJobLock ? withJobLock("form-release-reconcile", intervalMs * 3, runReconcileOnce) : runReconcileOnce())
    .catch((error) => logger.error("form_release_reconcile_failed", { error: error.message }));
  const first = setTimeout(run, Number(process.env.FORM_RELEASE_RECONCILE_INITIAL_DELAY_MS || 45 * 1000));
  first.unref?.();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = { startFormReleaseMaintenance, runReconcileOnce };
