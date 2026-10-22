// Phase 7.0 - the stage ladder. One finished pipeline run is described as a list of separate, honest stage answers instead of one "activated" flag:
//
//   detected -> fetched -> imported -> mapped -> certified -> release_eligible -> released -> migration_pending -> migration_complete | migration_partial
//
// and five distinct questions are answered on their own:
//   1. is the edition in the registry            (imported)
//   2. is it approved for NEW cases              (released)
//   3. is it eligible for EXISTING cases         (release_eligible)
//   4. did a given case migrate                  (migration counts, with every parked case listed by the migration itself)
//   5. did a filing artifact pass final checks   (decided when the artifact is built; reported by the filing path, not here)
// A migration failure is never hidden behind a successful release: it has its own state and reason.
//
// Pure functions; they read the pipeline's own result object and change nothing.

const STAGE_ORDER = Object.freeze(["detected", "fetched", "imported", "mapped", "certified", "release_eligible", "released", "migration_pending", "migration_complete", "migration_partial"]);

const count = (value) => (Array.isArray(value) ? value.length : Number(value) || 0);

/**
 * What the case migration achieved, as { state, counts, reason? }.
 *   not_applicable    the edition was not released, so no case was due to move
 *   migration_failed  the migration itself threw (nothing is known about the cases: they all stay on the old edition and a re-run is needed)
 *   migration_complete every considered case form moved, was already there, or is frozen by design
 *   migration_partial  some case forms failed, are unresolved/parked, need reconciliation, or are mid-way
 */
function summarizeMigration({ released, caseMigration, error }) {
  if (!released) return { state: "not_applicable" };
  if (error) return { state: "migration_failed", reason: String(error).slice(0, 300) };
  if (!caseMigration) return { state: "migration_pending", reason: "the case migration did not run for this edition" };
  const counts = {
    considered: count(caseMigration.considered), migrated: count(caseMigration.migrated), verified: count(caseMigration.verified), skippedFrozen: count(caseMigration.skippedFrozen),
    failed: count(caseMigration.failed), unresolved: count(caseMigration.unresolved), reconciliationRequired: count(caseMigration.reconciliationRequired), restored: count(caseMigration.restored), inProgress: count(caseMigration.inProgress),
  };
  const open = counts.failed + counts.unresolved + counts.reconciliationRequired + counts.restored + counts.inProgress;
  return open ? { state: "migration_partial", counts, reason: `${open} case form(s) are not on the new edition yet (failed ${counts.failed}, unresolved ${counts.unresolved}, reconciliation ${counts.reconciliationRequired}, restored ${counts.restored}, in progress ${counts.inProgress})` } : { state: "migration_complete", counts };
}

const stage = (status, reason) => (reason ? { status, reason: String(reason).slice(0, 300) } : { status });

/** The ladder for one finished run. `result` is what activateOrPromote / ensureCurrentUSCISForm returned (may be partial or null). Never throws. */
function buildLadder(result) {
  try {
    if (!result || typeof result !== "object") return { stages: {}, migration: { state: "not_applicable" }, levels: {} };
    const template = result.template || null;
    // released = the pipeline PROMOTED an edition in this run (result.template is the edition live afterwards, which is the OLD one when promotion did not happen)
    const released = Boolean(template && template.status === "active" && !result.requiresActivation && (result.versionChanged || result.alreadyActive === false));
    const imported = Boolean(template);
    const certification = result.certification;
    const certified = Boolean(certification?.passed);
    const blocked = result.activationBlockedReason;
    const migration = summarizeMigration({ released, caseMigration: result.caseMigration, error: result.caseMigrationError });
    const stages = {
      detected: stage(result.checkError ? "failed" : result.checked === false ? "skipped" : "done", result.checkError),
      fetched: stage(imported ? "done" : result.checkError ? "failed" : "skipped"),
      imported: stage(imported ? "done" : "skipped"),
      mapped: stage(result.migration || result.ruleMapping || template?.mappingStatus === "active" ? "done" : imported ? "held" : "skipped", imported && template?.mappingStatus !== "active" && !result.migration ? "no active mapping yet" : undefined),
      certified: stage(certification ? (certified ? "done" : "failed") : "skipped", certified ? undefined : (certification?.checks || []).filter((check) => check && check.passed === false).map((check) => check.name).join(", ") || undefined),
      release_eligible: stage(certified && !blocked ? "done" : blocked ? "held" : "skipped", blocked),
      released: stage(released ? "done" : blocked ? "held" : "skipped", blocked),
      migration_pending: stage(migration.state === "migration_pending" || migration.state === "migration_failed" ? (migration.state === "migration_failed" ? "failed" : "pending") : migration.state === "not_applicable" ? "skipped" : "done", migration.reason),
      migration_complete: stage(migration.state === "migration_complete" ? "done" : "skipped"),
      migration_partial: stage(migration.state === "migration_partial" || migration.state === "migration_failed" ? "failed" : "skipped", migration.state === "migration_partial" || migration.state === "migration_failed" ? migration.reason : undefined),
    };
    // components: a discovery error after activation is its own visible answer (the edition stays released; the components need a re-run)
    const components = result.componentDiscovery ? { discovered: Number(result.componentDiscovery.componentsDiscovered) || 0, ...(result.componentDiscovery.error ? { error: String(result.componentDiscovery.error).slice(0, 300) } : {}) } : null;
    return {
      stages,
      migration,
      ...(components ? { components } : {}),
      levels: { inRegistry: imported, approvedForNewCases: released, eligibleForExistingCases: Boolean(certified && !blocked) },
    };
  } catch {
    return { stages: {}, migration: { state: "unknown" }, levels: {} };
  }
}

module.exports = { STAGE_ORDER, summarizeMigration, buildLadder };
