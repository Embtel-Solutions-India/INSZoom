// The default executor of a pipeline job: the EXISTING import pipeline, unchanged. OnDemandFormAcquisitionService.ensureCurrentUSCISForm does the work
// (detect -> fetch/normalize/import -> map -> certify -> promote through the gate -> migrate cases); the context only lets it report each stage and prove the lease
// before it commits. Nothing about what the pipeline does is decided here.
//
// Phase 7.6b (FORM_PIPELINE_AUTONOMY=on only; off / shadow run exactly the code above):
//   - a `case_migration` job runs ONLY the case migration of an edition that is already released (the release never depends on it) and retries its failed case forms;
//   - a normal job whose form got an edition released while it was open (activate() recorded a follow-up on it) runs that migration as its LAST stage, as its continuation.
const logger = require("../../utils/logger");
const autonomy = require("../../config/formPipelineAutonomy");

/** The user a background run acts as: whoever asked, else the oldest admin, else a system admin (the same fallback the 12-hour catalog sync already used). */
async function resolveActor(requestedBy, { User = require("../../models/User") } = {}) {
  try {
    if (requestedBy) {
      const user = await User.findById(requestedBy);
      if (user) return user;
    }
    const admin = await User.findOne({ role: { $in: ["super_admin", "admin"] } }).sort({ createdAt: 1 });
    if (admin) return admin;
  } catch (error) {
    logger.warn("form_pipeline_actor_lookup_failed", { error: error.message });
  }
  return { role: "super_admin" };
}

const RETRY_DEFER_MS = 10 * 1000;

/** The failed case forms of a migration result (the ones worth another attempt; parked / unresolved ones wait for a rule change, not a retry). */
const failedCount = (caseMigration) => (Array.isArray(caseMigration?.failed) ? caseMigration.failed.length : 0);

async function loadTemplate(id, { Template = require("../../models/USCISFormTemplate") } = {}) {
  if (!id) return null;
  return Template.findById(id);
}

/** A `case_migration` job: move the open case forms onto its (already released, still live) edition. */
async function runMigrationJob(job, context, user, req, { queue = require("./caseMigrationQueue"), loadTemplateFn = loadTemplate, record = defaultRecord } = {}) {
  const template = await loadTemplateFn(job.options?.migrateTemplateId);
  if (!template) return { kind: "case_migration", checked: false, caseMigrationError: "the edition to migrate no longer exists" };
  // a newer edition may have replaced it since: never move cases onto an edition that is no longer the live one
  if (template.status !== "active") return { kind: "case_migration", template, checked: false, versionChanged: false, requiresActivation: false, skipped: "edition_no_longer_active" };
  const outcome = await queue.runMigrationStage({ template, user, req, context });
  await record({ template, caseMigration: outcome.caseMigration, actor: user });
  const result = { kind: "case_migration", template, versionChanged: true, requiresActivation: false, certification: { passed: true }, ...outcome };
  const last = Number(job.attempts || 1) >= Number(job.maxAttempts || 5);
  if (failedCount(outcome.caseMigration) > 0 && !last) {
    // the job's own backoff retries it; every retry re-plans only the case forms that are not on the new edition yet
    throw Object.assign(new Error(`case migration incomplete: ${failedCount(outcome.caseMigration)} case form(s) failed and will be retried`), { code: "CASE_MIGRATION_INCOMPLETE" });
  }
  return result;
}

async function defaultRecord({ template, caseMigration, actor }) {
  try {
    await require("../form-governance/GovernanceRecorder").recordMigrationOutcome({ template, caseMigration, lostEdges: undefined, actor });
  } catch (error) {
    logger.warn("case_migration_record_failed", { error: error.message });
  }
}

/** A normal run finished: if an edition was released while it was open, its case migration is this job's last stage. */
async function withFollowUpMigration(result, job, context, user, req, { queue = require("./caseMigrationQueue"), JobModel = require("../../models/FormPipelineJob"), loadTemplateFn = loadTemplate, record = defaultRecord, defer = deferRetry } = {}) {
  let fresh = null;
  try {
    fresh = await JobModel.findById(job._id).select("options").lean();
  } catch (error) {
    logger.warn("case_migration_follow_up_read_failed", { error: error.message });
    return result;
  }
  const followUpId = fresh?.options?.followUpMigrationTemplateId;
  if (!followUpId) return result;
  const template = await loadTemplateFn(followUpId);
  await JobModel.updateOne({ _id: job._id }, { $unset: { "options.followUpMigrationTemplateId": "" } }).catch(() => null); // consumed (see caseMigrationQueue.armJoinCheck)
  if (!template || template.status !== "active") return result;
  const outcome = await queue.runMigrationStage({ template, user, req, context });
  await record({ template, caseMigration: outcome.caseMigration, actor: user });
  if (failedCount(outcome.caseMigration) > 0) defer({ template });
  const releasedHere = Boolean(result && (result.versionChanged || result.alreadyActive === false));
  return releasedHere
    ? { ...result, ...outcome }
    : { kind: "case_migration", template, versionChanged: true, requiresActivation: false, certification: { passed: true }, ...outcome };
}

// Failed case forms of a follow-up are retried by a case_migration job queued a moment after this job closes (its own backoff then takes over).
function deferRetry({ template, queue = require("./caseMigrationQueue"), delayMs = RETRY_DEFER_MS }) {
  const timer = setTimeout(() => {
    queue.scheduleCaseMigration({ template, source: "follow_up_retry", mode: autonomy.mode() }).catch(() => null);
  }, delayMs);
  timer.unref?.();
  return timer;
}

function createDefaultExecutor({ acquisition = () => require("../uscis-form-import/services/OnDemandFormAcquisitionService"), actorFor = resolveActor, mode = () => autonomy.mode(), migration = {} } = {}) {
  return async function execute(job, context) {
    const user = context.actor || await actorFor(job.requestedBy);
    const req = context.req || { ip: "form-pipeline", headers: {}, requestId: `pipeline-${job._id}`, user };
    const on = mode() === "on";
    if (on && job.trigger === "case_migration") return runMigrationJob(job, context, user, req, migration);
    const result = await acquisition().ensureCurrentUSCISForm(job.formCode, user, req, { forceCheck: Boolean(job.options?.forceCheck), pipeline: context });
    return on ? withFollowUpMigration(result, job, context, user, req, migration) : result;
  };
}

module.exports = { createDefaultExecutor, resolveActor, runMigrationJob, withFollowUpMigration, deferRetry };
