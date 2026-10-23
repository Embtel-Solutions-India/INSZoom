// Phase 7.6b: moving the open case forms onto a newly released edition is its OWN stage, queued after the release, so the release never depends on it (FORM_PIPELINE_AUTONOMY=on).
//
//   activate() (from ANY caller, a manual admin activation included) -> scheduleCaseMigration():
//     - no open pipeline job for the form  -> a new `case_migration` job (trigger case_migration, options.migrateTemplateId); the worker runs it, retries failed case forms with
//       the job's own backoff, and reports migration_complete / migration_partial / migration_failed;
//     - a pipeline job for the form is open / running (the usual case: the release happened INSIDE it) -> NO second job (one open job per form): the edition is recorded as the
//       job's follow-up and the executor runs the migration as the continuation of that job when its own work is done.
//   off: nothing is scheduled (today: migration runs inline inside the pipeline, and never after a manual activation). shadow: logged, nothing scheduled.
// Frozen case forms never move (the migration itself skips them through the shared isFrozen). Never throws.
const logger = require("../../utils/logger");
const autonomy = require("../../config/formPipelineAutonomy");
const { isSystemActor } = require("./systemActor");

const JOIN_RECHECK_MS = 30 * 1000;

const idOf = (value) => String(value?._id || value || "");

async function scheduleCaseMigration({ template, user = null, source = "activate", mode = autonomy.mode(), deps = {} } = {}) {
  if (mode === "off") return { scheduled: "off" };
  if (!template?._id || !template.formCode) return { scheduled: "skipped", reason: "no_template" };
  if (mode === "shadow") {
    logger.warn("case_migration_schedule_shadow", { formCode: template.formCode, templateId: idOf(template), source });
    return { scheduled: "shadow" };
  }
  try {
    const jobService = deps.jobService || require("./FormPipelineJobService").getService();
    const requestedBy = user && !isSystemActor(user) && (user._id || user.id) ? (user._id || user.id) : undefined;
    const { job, created } = await jobService.enqueue({ formCode: template.formCode, trigger: "case_migration", requestedBy, options: { migrateTemplateId: template._id } });
    if (created) {
      logger.info("case_migration_job_queued", { formCode: template.formCode, templateId: idOf(template), jobId: idOf(job), source });
      return { scheduled: "job", jobId: idOf(job) };
    }
    // an open job exists: this very migration, or a pipeline run of the form. Never a second job.
    if (job.trigger === "case_migration" && idOf(job.options?.migrateTemplateId) === idOf(template)) return { scheduled: "already", jobId: idOf(job) };
    await jobService.setFollowUpMigration(job._id, template._id);
    logger.info("case_migration_joined_open_job", { formCode: template.formCode, templateId: idOf(template), jobId: idOf(job), source });
    armJoinCheck({ jobService, jobId: job._id, template, deps });
    return { scheduled: "joined", jobId: idOf(job) };
  } catch (error) {
    logger.warn("case_migration_schedule_failed", { formCode: template.formCode, error: error.message });
    return { scheduled: "failed", error: error.message };
  }
}

// The open job may finish in the instant between "follow-up recorded" and "executor looked": a short while later, if the job is closed and its follow-up was never consumed,
// a case_migration job is queued for it. (The executor clears the follow-up when it runs it.)
function armJoinCheck({ jobService, jobId, template, deps = {} }) {
  const delay = deps.joinRecheckMs ?? JOIN_RECHECK_MS;
  const timer = setTimeout(async () => {
    try {
      const job = await jobService.get(jobId);
      if (job && !job.open && idOf(job.options?.followUpMigrationTemplateId) === idOf(template)) {
        await jobService.enqueue({ formCode: template.formCode, trigger: "case_migration", options: { migrateTemplateId: template._id } });
        logger.info("case_migration_follow_up_requeued", { formCode: template.formCode, jobId: idOf(jobId) });
      }
    } catch (error) {
      logger.warn("case_migration_join_check_failed", { formCode: template.formCode, error: error.message });
    }
  }, delay);
  timer.unref?.();
  return timer;
}

/**
 * Runs the migration stage of a job: the open case forms of the form's previous editions move onto `template` (frozen ones never do). Never throws for a partial result.
 * Returns { caseMigration } or { caseMigrationError }.
 */
async function runMigrationStage({ template, user, req, context, deps = {} }) {
  const migrate = deps.migrate || require("../form-mapping/services/CaseFormEditionMigrationService").migrateCaseFormsToEdition;
  const run = () => migrate({ newTemplate: template, actor: user, req });
  try {
    const caseMigration = await (context?.stage ? context.stage("migrate_cases", run) : run());
    return { caseMigration };
  } catch (error) {
    if (error?.name === "LeaseLostError" || error?.code === "PIPELINE_LEASE_LOST") throw error;
    logger.warn("case_migration_stage_failed", { formCode: template?.formCode, error: error.message });
    return { caseMigrationError: error.message };
  }
}

module.exports = { scheduleCaseMigration, runMigrationStage, armJoinCheck, JOIN_RECHECK_MS };
