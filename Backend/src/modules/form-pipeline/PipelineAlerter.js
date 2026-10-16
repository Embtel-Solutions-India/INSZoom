// Phase 1 developer alerts (plan "Developer email notifications", failure / blocked / dead-letter part; success, held and digests arrive in Phase 5).
//   - recipient: FORM_PIPELINE_ALERT_EMAIL (comma-separated), default ishaan@embtelsolutions.com - no address is hard-coded in the logic below;
//   - one alert per job per (kind | stage | error class | error code): a retry loop that fails the same way does not re-email; a new stage / error, or entering
//     dead_letter, does (the dedupe record lives on the job, markAlert is atomic);
//   - FORM_PIPELINE_EMAIL_FAILURE=false switches the emails off (the in-app notification still happens);
//   - email goes through the existing email.service (templates, EmailLog, address guards); when no provider is configured the admins get an in-app notification instead;
//   - an alert failing NEVER blocks or fails the pipeline: everything is caught and logged.
// Content: only the sanitized error class / code / short message - never secrets, tokens, client data or stack traces.
const DEFAULT_RECIPIENT = "ishaan@embtelsolutions.com";

const recipients = (env = process.env) => String(env.FORM_PIPELINE_ALERT_EMAIL || DEFAULT_RECIPIENT).split(",").map((item) => item.trim()).filter(Boolean);
const emailEnabled = (env = process.env) => String(env.FORM_PIPELINE_EMAIL_FAILURE ?? "true").toLowerCase() !== "false";

const KIND_BY_STATE = { pending: "failure", blocked: "blocked", dead_letter: "dead_letter" }; // held / done: Phase 5
// a person asked for this run and already sees the error (e.g. a form that is not on uscis.gov): a BLOCKED result of such a run is not announced to the developer
const QUIET_BLOCKED_TRIGGERS = new Set(["admin_fetch", "case_acquire", "mapping_save"]);

function defaultDeps() {
  return {
    email: require("../email/email.service"),
    notifications: require("../notifications/notification.service"),
    logger: require("../../utils/logger"),
    describeForm: async (formCode) => {
      const USCISFormTemplate = require("../../models/USCISFormTemplate");
      const active = await USCISFormTemplate.findOne({ formCode, status: "active" }).sort({ editionDate: -1 }).select("version editionDate").lean();
      return active ? { activeEdition: active.editionDate ? new Date(active.editionDate).toISOString().slice(0, 10) : active.version } : {};
    },
  };
}

function createAlerter({ jobService, env = process.env, deps = {} } = {}) {
  const { email, notifications, logger, describeForm } = { ...defaultDeps(), ...deps };

  /**
   * `transition` is what jobService.fail returned: { state, classification, signature, nextAttemptAt, message }; `job` is the job AFTER the failure.
   * Resolves { sent, kind, deduped?, channel? } and never throws.
   */
  async function announce({ job, transition, stage }) {
    try {
      const kind = KIND_BY_STATE[transition?.state];
      if (!kind) return { sent: false, reason: "no_alert_for_state" };
      if (kind === "blocked" && QUIET_BLOCKED_TRIGGERS.has(job.trigger)) return { sent: false, kind, reason: "user_visible" };
      const signature = `${kind}|${transition.signature}`;
      if (!(await jobService.markAlert(job._id, signature, kind))) return { sent: false, kind, deduped: true };
      const described = await Promise.resolve(describeForm(job.formCode)).catch(() => ({}));
      const editionDate = String(job.editionKey || "").split("|")[1] || "";
      const data = {
        kind, formCode: job.formCode, editionDate, activeEdition: described.activeEdition, stage: stage || job.lastError?.stage, errorClass: transition.classification.class, errorCode: transition.classification.code,
        message: transition.message, attempts: job.attempts, maxAttempts: job.maxAttempts, state: transition.state, nextAttemptAt: transition.nextAttemptAt ? new Date(transition.nextAttemptAt).toISOString() : "",
        repairs: (job.repairsTried || []).map((item) => ({ strategy: item.strategy, outcome: item.outcome, verification: item.verification })), jobId: String(job._id), adminLink: env.FORM_PIPELINE_ADMIN_URL ? `${String(env.FORM_PIPELINE_ADMIN_URL).replace(/\/+$/, "")}/form-governance` : "",
      };
      const configured = typeof email.isConfigured === "function" ? email.isConfigured() : false;
      if (emailEnabled(env) && configured) {
        for (const to of recipients(env)) {
          await email.sendTemplateEmail("form-pipeline-alert", { to, data, triggeredBy: "form-pipeline", source: "shared", recipientRole: "team_member" });
        }
        return { sent: true, kind, channel: "email", to: recipients(env) };
      }
      // not configured (or emails switched off): the admins still see it in the app
      await notifications.createForRoles(["super_admin", "admin"], {
        source: "shared", category: "system", type: "form_pipeline_alert", title: `Form ${job.formCode}: pipeline ${kind.replace("_", " ")}`,
        message: `Stage ${data.stage || "?"}: ${data.errorClass} ${data.errorCode} - ${data.message}`, metadata: { jobId: data.jobId, formCode: job.formCode, state: transition.state },
      }, null, null);
      return { sent: true, kind, channel: "in_app" };
    } catch (error) {
      logger.warn("form_pipeline_alert_failed", { jobId: String(job?._id), error: error.message });
      return { sent: false, error: error.message };
    }
  }

  /** The queue has waited longer than it should and no worker is alive: one alert (deduped across ticks through the in-memory flag of this process). */
  let workerAlertSent = false;
  async function workerUnavailable({ waiting }) {
    if (!waiting?.length) { workerAlertSent = false; return { sent: false }; }
    if (workerAlertSent) return { sent: false, deduped: true };
    workerAlertSent = true;
    logger.error("form_pipeline_worker_unavailable", { waiting: waiting.length, forms: waiting.slice(0, 10).map((item) => item.formCode) });
    try {
      await notifications.createForRoles(["super_admin", "admin"], {
        source: "shared", category: "system", type: "form_pipeline_alert", title: "Form pipeline worker is not running",
        message: `${waiting.length} form import job(s) have been waiting more than 15 minutes and no worker is picking them up (${waiting.slice(0, 5).map((item) => item.formCode).join(", ")}). Live forms keep working; nothing is processed until the worker runs.`,
        metadata: { waiting: waiting.length },
      }, null, null);
    } catch (error) {
      logger.warn("form_pipeline_alert_failed", { error: error.message });
    }
    return { sent: true };
  }

  return { announce, workerUnavailable };
}

module.exports = { createAlerter, recipients, emailEnabled, DEFAULT_RECIPIENT, KIND_BY_STATE };
