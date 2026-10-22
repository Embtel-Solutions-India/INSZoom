// Developer alerts of the form pipeline (plan "Developer email notifications"). Phase 1: failure / blocked / dead-letter. Phase 5E: held / approval-required, success, digest.
//   - recipient: FORM_PIPELINE_ALERT_EMAIL (comma-separated), default ishaan@embtelsolutions.com - no address is hard-coded in the logic below;
//   - one alert per job per (kind | stage | error class | error code): a retry loop that fails the same way does not re-email; a new stage / error, or entering
//     dead_letter, does (the dedupe record lives on the job, markAlert is atomic). A success is announced once per job and edition, a hold once per job and reason;
//   - noise control (alerts/alertConfig.js): FORM_PIPELINE_EMAIL_FAILURE | HELD | SUCCESS, FORM_PIPELINE_EMAIL_MODE=auto|individual|digest, a per-run cap of individual
//     success e-mails, and ONE digest per scheduled / catalog-wide run (failures, holds and dead-letters are always individual);
//   - e-mail goes through the existing email.service (templates, EmailLog, address guards); when no provider is configured (or a send fails) the admins get an in-app
//     notification instead - one notification PER admin with its own dedupeKey (a shared dedupeKey would collapse the whole fan-out into the first admin's notification);
//   - every delivery leaves one audit record (action FORM_PIPELINE_ALERT_SENT / _DIGEST_SENT, entityType FormPipelineJob);
//   - an alert failing NEVER blocks or fails the pipeline: everything is caught and logged.
// Content: only the sanitized error class / code / short message, form codes, edition dates and counts - never secrets, tokens, client data or stack traces.
const alertConfig = require("./alerts/alertConfig");
const outcomeData = require("./alerts/outcomeData");
const { createDigestStore, createMemoryDigestStore } = require("./alerts/digestStore");

const DEFAULT_RECIPIENT = "ishaan@embtelsolutions.com";
const ADMIN_ROLES = ["super_admin", "admin"];

const recipients = (env = process.env) => String(env.FORM_PIPELINE_ALERT_EMAIL || DEFAULT_RECIPIENT).split(",").map((item) => item.trim()).filter(Boolean);
const emailEnabled = (env = process.env) => alertConfig.emailFlags(env).failure;

const KIND_BY_STATE = { pending: "failure", blocked: "blocked", dead_letter: "dead_letter", held: "held" };
// a person asked for this run and already sees the error (e.g. a form that is not on uscis.gov): a BLOCKED result of such a run is not announced to the developer
const QUIET_BLOCKED_TRIGGERS = new Set(["admin_fetch", "case_acquire", "mapping_save"]);

// the audit vocabulary of the pipeline's alerts (one action per delivery, one entity type)
const AUDIT = Object.freeze({ entityType: "FormPipelineJob", alert: "FORM_PIPELINE_ALERT_SENT", digest: "FORM_PIPELINE_DIGEST_SENT" });

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

/** The staff who get in-app notices. Default: every active admin / super admin (read from the users collection). */
async function defaultListAdmins() {
  const User = require("../../models/User");
  return User.find({ role: { $in: ADMIN_ROLES }, isActive: { $ne: false } }).select("_id role").lean();
}

async function defaultAudit(entry) {
  return require("../audit/audit.service").recordAuditEvent({ ...entry, source: "form-pipeline" });
}

function createAlerter({ jobService, env = process.env, deps = {} } = {}) {
  const injected = Boolean(deps.email || deps.notifications); // a test replaced the senders: nothing may fall through to the real database / audit log
  const { email, notifications, logger, describeForm } = { ...defaultDeps(), ...deps };
  const listAdmins = "listAdmins" in deps ? deps.listAdmins : (injected ? null : defaultListAdmins);
  const audit = "audit" in deps ? deps.audit : (injected ? null : defaultAudit);
  const digestStore = deps.digestStore || (injected ? createMemoryDigestStore() : createDigestStore());
  const outcomeLookups = deps.outcomeLookups || {};
  const adminLink = () => (env.FORM_PIPELINE_ADMIN_URL ? `${String(env.FORM_PIPELINE_ADMIN_URL).replace(/\/+$/, "")}/form-governance` : "");

  /** One in-app notification PER admin, each with its own dedupeKey (the key is `${dedupeBase}:${userId}`). Without a user list (tests) it falls back to the role fan-out. */
  async function notifyAdmins(payload, dedupeBase) {
    const users = listAdmins && typeof notifications.createNotification === "function" ? await Promise.resolve(listAdmins()).catch(() => []) : [];
    if (users?.length) {
      for (const user of users) {
        await notifications.createNotification({ ...payload, userId: user._id, recipientRole: user.role, dedupeKey: dedupeBase ? `${dedupeBase}:${user._id}` : undefined }, null, null);
      }
      return;
    }
    // no per-user path available: the role fan-out WITHOUT a dedupeKey (one shared key would suppress every admin after the first); the job-level dedupe already ran
    await notifications.createForRoles(ADMIN_ROLES, payload, null, null);
  }

  async function writeAudit(action, job, details, metadata = {}) {
    if (!audit) return;
    try {
      await audit({ action, entityType: AUDIT.entityType, entityId: job?._id ? String(job._id) : undefined, details, severity: "low", metadata });
    } catch (error) {
      logger.warn("form_pipeline_alert_audit_failed", { jobId: String(job?._id || ""), error: error.message });
    }
  }

  /**
   * E-mail (every recipient) when the toggle is on and a provider is configured; otherwise - or when no recipient could be sent to - the in-app notice.
   * `notice` = { title, message, metadata, type, priority }. Resolves { channel }.
   */
  async function deliver({ template, data, enabled, notice, dedupeBase }) {
    const configured = typeof email.isConfigured === "function" ? email.isConfigured() : false;
    if (enabled && configured) {
      const to = recipients(env);
      let delivered = 0;
      for (const address of to) {
        try {
          await email.sendTemplateEmail(template, { to: address, data, triggeredBy: "form-pipeline", source: "shared", recipientRole: "team_member" });
          delivered += 1;
        } catch (error) {
          logger.warn("form_pipeline_alert_email_failed", { template, error: error.message });
        }
      }
      if (delivered) return { channel: "email", to };
    }
    // not configured, switched off, or the provider rejected every send: the admins still see it in the app
    await notifyAdmins({ source: "shared", category: "system", priority: "high", type: "form_pipeline_alert", ...notice }, dedupeBase);
    return { channel: "in_app" };
  }

  /**
   * `transition` is what jobService.fail returned: { state, classification, signature, nextAttemptAt, message }; `job` is the job AFTER the failure.
   * Failure / blocked / dead_letter use the alert template; a HELD job (edition policy hold) uses the held template.
   * Resolves { sent, kind, deduped?, channel? } and never throws.
   */
  async function announce({ job, transition, stage, result }) {
    try {
      const kind = KIND_BY_STATE[transition?.state];
      if (!kind) return { sent: false, reason: "no_alert_for_state" };
      if (kind === "blocked" && QUIET_BLOCKED_TRIGGERS.has(job.trigger)) return { sent: false, kind, reason: "user_visible" };
      const signature = `${kind}|${transition.signature}`;
      if (!(await jobService.markAlert(job._id, signature, kind))) return { sent: false, kind, deduped: true };
      const described = await Promise.resolve(describeForm(job.formCode)).catch(() => ({}));
      const flags = alertConfig.emailFlags(env);
      if (kind === "held") {
        const data = { ...outcomeData.buildHeldData({ job, result, transition, reasonKind: "policy_hold", describe: described }), adminLink: adminLink() };
        const delivery = await deliver({
          template: "form-pipeline-held", data, enabled: flags.held, dedupeBase: `form-pipeline:${job._id}:${signature}`,
          notice: { title: `Form ${job.formCode}: edition held`, message: `${data.reason}. ${data.action}`, metadata: { jobId: data.jobId, formCode: job.formCode, state: "held", reason: "policy_hold" } },
        });
        await writeAudit(AUDIT.alert, job, `Held alert for ${job.formCode} sent by ${delivery.channel}`, { kind, channel: delivery.channel, signature, formCode: job.formCode });
        return { sent: true, kind, ...delivery };
      }
      const editionDate = String(job.editionKey || "").split("|")[1] || "";
      const data = {
        kind, formCode: job.formCode, editionDate, activeEdition: described.activeEdition, stage: stage || job.lastError?.stage, errorClass: transition.classification.class, errorCode: transition.classification.code,
        message: transition.message, attempts: job.attempts, maxAttempts: job.maxAttempts, state: transition.state, nextAttemptAt: transition.nextAttemptAt ? new Date(transition.nextAttemptAt).toISOString() : "",
        repairs: (job.repairsTried || []).map((item) => ({ strategy: item.strategy, outcome: item.outcome, verification: item.verification })), jobId: String(job._id), adminLink: adminLink(),
      };
      const delivery = await deliver({
        template: "form-pipeline-alert", data, enabled: flags.failure, dedupeBase: `form-pipeline:${job._id}:${signature}`,
        notice: { title: `Form ${job.formCode}: pipeline ${kind.replace("_", " ")}`, message: `Stage ${data.stage || "?"}: ${data.errorClass} ${data.errorCode} - ${data.message}`, metadata: { jobId: data.jobId, formCode: job.formCode, state: transition.state } },
      });
      await writeAudit(AUDIT.alert, job, `${kind} alert for ${job.formCode} sent by ${delivery.channel}`, { kind, channel: delivery.channel, signature, formCode: job.formCode, stage: data.stage });
      return { sent: true, kind, ...delivery };
    } catch (error) {
      logger.warn("form_pipeline_alert_failed", { jobId: String(job?._id), error: error.message });
      return { sent: false, error: error.message };
    }
  }

  /**
   * A run FINISHED without failing. `outcome` is summarizeResult(result), `result` the pipeline's own result.
   *   activated / acquired  -> an "edition promoted" success (one e-mail, or an entry in the run's digest - see alertConfig.successRoute);
   *   kept_in_review        -> "imported but not promoted": approval required (the policy-hold case arrives through announce() as a held transition).
   * Resolves { sent, kind?, route?, deduped? } and never throws.
   */
  async function announceOutcome({ job, outcome, result }) {
    try {
      const status = outcome?.status;
      if (status === "activated" || status === "acquired") return await announceSuccess({ job, outcome, result });
      if (status === "kept_in_review") return await announceApproval({ job, outcome, result });
      return { sent: false, reason: "no_alert_for_outcome" };
    } catch (error) {
      logger.warn("form_pipeline_alert_failed", { jobId: String(job?._id), error: error.message });
      return { sent: false, error: error.message };
    }
  }

  async function announceSuccess({ job, outcome, result }) {
    const flags = alertConfig.emailFlags(env);
    if (!flags.success) return { sent: false, kind: "success", reason: "switched_off" };
    const edition = outcomeData.editionOf(result?.template) || String(outcome?.version || "");
    if (!(await jobService.markAlert(job._id, `success|${edition}`, "success"))) return { sent: false, kind: "success", deduped: true };
    const trigger = job.trigger || "unknown";
    const key = alertConfig.digestKey(trigger);
    let route = alertConfig.successRoute({ trigger, env });
    if (route === "individual" && !(await digestStore.reserveIndividual(key, alertConfig.runCap(env)))) route = "digest"; // the per-run cap is spent
    if (route === "digest") {
      await digestStore.addEntry(key, {
        formCode: job.formCode, fromEdition: outcomeData.editionOf(result?.previousTemplate), toEdition: edition, release: outcomeData.describeRelease(result?.template).mode, jobId: String(job._id), trigger,
      });
      return { sent: false, kind: "success", route: "digest", queued: true };
    }
    const data = { ...(await outcomeData.buildSuccessData({ job, result, lookups: outcomeLookups })), adminLink: adminLink() };
    const delivery = await deliver({
      template: "form-pipeline-success", data, enabled: true, dedupeBase: `form-pipeline:${job._id}:success|${edition}`,
      notice: {
        type: "form_pipeline_update", priority: "medium", title: `Form ${job.formCode}: edition ${edition} is live`,
        message: `${data.previousEdition ? `Updated from edition ${data.previousEdition} to ${edition}` : `Added at edition ${edition}`}. Release: ${data.release.mode}.`, metadata: { jobId: data.jobId, formCode: job.formCode, state: "done" },
      },
    });
    await writeAudit(AUDIT.alert, job, `Success alert for ${job.formCode} sent by ${delivery.channel}`, { kind: "success", channel: delivery.channel, formCode: job.formCode, edition });
    return { sent: true, kind: "success", route: "individual", ...delivery };
  }

  async function announceApproval({ job, outcome, result }) {
    const reasonKey = String(outcome?.activationBlockedReason || "approval_required").slice(0, 80);
    const edition = String(job.editionKey || "").split("|")[1] || outcomeData.editionOf(result?.template);
    if (!(await jobService.markAlert(job._id, `held|approval_required|${edition}|${reasonKey}`, "held"))) return { sent: false, kind: "held", deduped: true };
    const described = await Promise.resolve(describeForm(job.formCode)).catch(() => ({}));
    const data = { ...outcomeData.buildHeldData({ job, result, reasonKind: "approval_required", describe: described }), adminLink: adminLink() };
    const delivery = await deliver({
      template: "form-pipeline-held", data, enabled: alertConfig.emailFlags(env).held, dedupeBase: `form-pipeline:${job._id}:held|approval_required|${edition}`,
      notice: { title: `Form ${job.formCode}: approval needed`, message: `${data.reason}. ${data.action}`, metadata: { jobId: data.jobId, formCode: job.formCode, state: "done", reason: "approval_required" } },
    });
    await writeAudit(AUDIT.alert, job, `Approval-required alert for ${job.formCode} sent by ${delivery.channel}`, { kind: "held", reason: "approval_required", channel: delivery.channel, formCode: job.formCode, edition });
    return { sent: true, kind: "held", reason: "approval_required", ...delivery };
  }

  /** Sends the digest of every run window that has been quiet long enough. Safe to call from several processes (a window is claimed atomically). Never throws. */
  async function flushDigests({ now = new Date(), quietMs = alertConfig.digestQuietMs(env) } = {}) {
    let flushed = 0;
    try {
      const due = await digestStore.claimDue({ quietMs, now });
      for (const window of due) {
        try {
          const trigger = String(window.key || "").replace(/^success:/, "") || "unknown";
          const data = { trigger, count: window.count, individualSent: window.individualSent || 0, entries: (window.entries || []).map((item) => ({ formCode: item.formCode, fromEdition: item.fromEdition, toEdition: item.toEdition, release: item.release })), adminLink: adminLink() };
          const delivery = await deliver({
            template: "form-pipeline-digest", data, enabled: alertConfig.emailFlags(env).success, dedupeBase: `form-pipeline-digest:${window._id}`,
            notice: {
              type: "form_pipeline_update", priority: "medium", title: `Form pipeline: ${window.count} edition${window.count === 1 ? "" : "s"} promoted`,
              message: data.entries.slice(0, 10).map((item) => `${item.formCode} ${item.fromEdition ? `${item.fromEdition} -> ` : ""}${item.toEdition}`).join("; ") + (window.count > 10 ? ` and ${window.count - 10} more` : ""), metadata: { trigger, count: window.count },
            },
          });
          await digestStore.markSent(window._id);
          await writeAudit(AUDIT.digest, null, `Digest of ${window.count} promoted edition(s) sent by ${delivery.channel}`, { trigger, count: window.count, channel: delivery.channel, forms: data.entries.slice(0, 50).map((item) => item.formCode) });
          flushed += 1;
        } catch (error) {
          logger.warn("form_pipeline_digest_failed", { key: window.key, error: error.message });
          await Promise.resolve(digestStore.release(window._id)).catch(() => null); // put it back: the next tick tries again
        }
      }
    } catch (error) {
      logger.warn("form_pipeline_digest_failed", { error: error.message });
    }
    return { flushed };
  }

  /** Runs flushDigests every `intervalMs` (default 2 minutes); the timer never keeps the process alive. Returns { stop }. Off with FORM_PIPELINE_DIGEST_FLUSHER=false. */
  function startDigestFlusher({ intervalMs = 2 * 60 * 1000 } = {}) {
    if (!alertConfig.flusherEnabled(env)) return { stop() {}, disabled: true };
    const timer = setInterval(() => { flushDigests().catch(() => null); }, intervalMs);
    timer.unref?.();
    return { stop() { clearInterval(timer); } };
  }

  /** The queue has waited longer than it should and no worker is alive: one alert (deduped across ticks through the in-memory flag of this process). */
  let workerAlertSent = false;
  async function workerUnavailable({ waiting }) {
    if (!waiting?.length) { workerAlertSent = false; return { sent: false }; }
    if (workerAlertSent) return { sent: false, deduped: true };
    workerAlertSent = true;
    logger.error("form_pipeline_worker_unavailable", { waiting: waiting.length, forms: waiting.slice(0, 10).map((item) => item.formCode) });
    try {
      await notifyAdmins({
        source: "shared", category: "system", priority: "high", type: "form_pipeline_alert", title: "Form pipeline worker is not running",
        message: `${waiting.length} form import job(s) have been waiting more than 15 minutes and no worker is picking them up (${waiting.slice(0, 5).map((item) => item.formCode).join(", ")}). Live forms keep working; nothing is processed until the worker runs.`,
        metadata: { waiting: waiting.length },
      }, `form-pipeline-worker:${new Date().toISOString().slice(0, 13)}`); // once per admin per hour
    } catch (error) {
      logger.warn("form_pipeline_alert_failed", { error: error.message });
    }
    return { sent: true };
  }

  /**
   * Phase 7.0: a released edition whose case migration did not finish (failed, partial, or never ran) is raised once per job and migration state - the release status
   * never hides it. In-app notice for the admins (every admin separately) plus an audit record; never throws.
   */
  async function announceMigrationGap({ job, outcome }) {
    try {
      const migration = outcome?.migration;
      if (!migration || !["migration_failed", "migration_partial", "migration_pending"].includes(migration.state)) return { sent: false, reason: "no_gap" };
      const signature = `migration_gap|${migration.state}`;
      if (!(await jobService.markAlert(job._id, signature, "migration_gap"))) return { sent: false, deduped: true };
      await notifyAdmins({
        source: "shared", category: "system", priority: "high", type: "form_pipeline_alert", title: `Form ${job.formCode}: new edition released, case migration incomplete`,
        message: `${migration.reason || migration.state}. Open cases stay on the previous edition and keep working; the migration is retried automatically.`,
        metadata: { jobId: String(job._id), formCode: job.formCode, migrationState: migration.state, counts: migration.counts || null },
      }, `form-pipeline:${job._id}:${signature}`);
      await writeAudit(AUDIT.alert, job, `Migration gap alert for ${job.formCode}`, { kind: "migration_gap", state: migration.state, formCode: job.formCode });
      return { sent: true, kind: "migration_gap", channel: "in_app" };
    } catch (error) {
      logger.warn("form_pipeline_alert_failed", { jobId: String(job?._id), error: error.message });
      return { sent: false, error: error.message };
    }
  }

  /** Phase 7.0: a hold that has lasted past the escalation period is raised ONCE (the job records it). The notice says why and what would release it; it decides nothing. */
  async function announceEscalation({ job }) {
    try {
      const hold = job?.hold || {};
      if (!(await jobService.markEscalated(job._id))) return { sent: false, deduped: true };
      await notifyAdmins({
        source: "shared", category: "system", priority: "high", type: "form_pipeline_alert", title: `Form ${job.formCode}: held for a long time`,
        message: `${hold.detail || hold.reasonCode || "held"}. It would be released when: ${(hold.releaseConditions || []).join("; ") || "the condition clears"}. The previous edition keeps serving; nothing is promoted until it can be proven safe.`,
        metadata: { jobId: String(job._id), formCode: job.formCode, state: job.state, reasonCode: hold.reasonCode || null, firstHeldAt: hold.firstHeldAt || null },
      }, `form-pipeline:${job._id}:escalation`);
      await writeAudit(AUDIT.alert, job, `Persistent hold escalated for ${job.formCode}`, { kind: "escalation", reasonCode: hold.reasonCode, formCode: job.formCode });
      return { sent: true, kind: "escalation", channel: "in_app" };
    } catch (error) {
      logger.warn("form_pipeline_alert_failed", { jobId: String(job?._id), error: error.message });
      return { sent: false, error: error.message };
    }
  }

  return { announce, announceOutcome, announceMigrationGap, announceEscalation, flushDigests, startDigestFlusher, workerUnavailable };
}

module.exports = { createAlerter, recipients, emailEnabled, DEFAULT_RECIPIENT, KIND_BY_STATE, AUDIT };
