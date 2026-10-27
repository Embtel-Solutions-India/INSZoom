// Client checklist e-mails:
//   - REMINDER: a client who has a checklist they can see but has not pressed SUBMIT is e-mailed every 3 days ("complete your checklist", a login button only) until they do.
//     Save progress never counts - a checklist that is filled in but not submitted is still pending.
//   - RECEIVED: when the client presses Submit (and everything they had to complete is submitted) they are e-mailed once: "your checklist has been received, your case manager will
//     work on your case and will contact you shortly".
//
// Purely additive and fail-safe: nothing in an existing flow changes. A periodic job (server.js) and a fire-and-forget check after each submit (progress-alert.service.js) both call
// evaluateCase(), which reads the case, decides (pure: assess + decide) and writes ONLY Case.checklistReminder with updateOne (never the document save, never touching `updatedAt`).
// It never throws. Switch off with CHECKLIST_REMINDER_EMAILS=false; the interval is CHECKLIST_REMINDER_INTERVAL_DAYS (default 3).
//
// A case seen for the FIRST time by the job starts its 3-day cycle at that moment and is never e-mailed retroactively, so switching the feature on does not mail every older case at once.
const logger = require("../../utils/logger");
const gate = require("../questionnaires/checklist-gate");

const DAY_MS = 24 * 60 * 60 * 1000;
const RECEIVED_COOLDOWN_MS = DAY_MS;

const enabled = (env = process.env) => String(env.CHECKLIST_REMINDER_EMAILS || "true").toLowerCase() !== "false";
const intervalMs = (env = process.env) => Math.max(Number(env.CHECKLIST_REMINDER_INTERVAL_DAYS || 3), 0.0001) * DAY_MS;

const normalizeRole = (role) => String(role || "").toLowerCase().replace(/[\s-]+/g, "_");
// which checklist roles belong to which kind of portal user ("" = the default checklist, the client's own)
const ROLE_TARGETS = {
  client: ["client", "petitioner"],
  petitioner: ["client", "petitioner"],
  employer: ["employer"],
  employee: ["employee"],
  beneficiary: ["beneficiary"],
  joint_sponsor: ["joint_sponsor"],
};
const PARTICIPANT_ROLES = { client: ["client", "petitioner"], petitioner: ["client", "petitioner"], employer: ["employer"], employee: ["employee"], beneficiary: ["beneficiary"], joint_sponsor: ["joint_sponsor"] };
const DONE_REFERENCE = new Set(["submitted", "approved"]);
const DONE_PARTICIPANT = new Set(["submitted", "approved"]);
const GONE_PARTICIPANT = new Set(["deleted", "replaced", "inactive", "declined"]);
// a case that is over, paused or already past the client's part never nudges anyone
const FINISHED_STAGES = new Set(["filing", "filed", "processing", "rfe", "uscis_pending", "approved", "denied", "closed", "archived"]);
const FINISHED_STATUSES = new Set(["completed", "cancelled", "on_hold"]);

const sameId = (a, b) => Boolean(a && b) && String(a) === String(b);

/**
 * Pure. What the client's checklist situation is.
 *   caseData: { questionnaireReferences, participants, checklistApproval }   user: { _id, role }
 *   questionnaireOf(reference) -> { key, checklistRole } (the template of that reference)   intakeSubmitted: the single-party intake record says submitted
 * Returns { eligible, submitted, relevant, pending }. `eligible` = there is at least one checklist the client can see; `submitted` = the client pressed Submit:
 * the participant record says submitted (what "Submit case" writes), or the intake record does, or every visible checklist is submitted / approved.
 */
function assess({ caseData, user, questionnaireOf = () => ({}), intakeSubmitted = false }) {
  const role = normalizeRole(user?.role);
  const targets = ROLE_TARGETS[role];
  if (!targets) return { eligible: false, submitted: false, relevant: 0, pending: 0, reason: "not_a_client_role" };
  const relevant = (caseData?.questionnaireReferences || []).filter((reference) => {
    if (reference.active === false || reference.staffRequest) return false; // staff-requested checklists have their own e-mails
    const template = questionnaireOf(reference) || {};
    const targetRole = reference.targetRole || template.checklistRole || "client";
    if (!targets.includes(targetRole)) return false;
    const entry = { key: template.key || "", targetRole, staffRequest: false };
    return gate.isApproved(caseData, entry) && !gate.isRemoved(caseData, entry); // a checklist still waiting for a case manager is invisible to the client
  });
  const pending = relevant.filter((reference) => !DONE_REFERENCE.has(reference.status));
  const roles = PARTICIPANT_ROLES[role] || [];
  const participant = (caseData?.participants || []).find((item) => sameId(item.userId, user?._id) && roles.includes(item.role) && !GONE_PARTICIPANT.has(item.status));
  const participantSubmitted = Boolean(participant && DONE_PARTICIPANT.has(participant.status));
  const submitted = participantSubmitted || Boolean(intakeSubmitted) || (relevant.length > 0 && pending.length === 0);
  return { eligible: relevant.length > 0, submitted, relevant: relevant.length, pending: pending.length };
}

/**
 * Pure. What to do next. state = Case.checklistReminder (or undefined), assessment = assess(), trigger = "job" | "submit".
 * Returns { action: "none" | "init" | "restart" | "remind" | "received", patch } - patch is what to $set (the caller adds evaluatedAt).
 */
function decide({ state, assessment, now = new Date(), trigger = "job", interval = intervalMs() }) {
  const at = now.getTime();
  const next = (from) => new Date(from + interval);
  if (!assessment.eligible) return { action: "none", patch: { eligible: false } };
  if (assessment.submitted) {
    if (state?.submitted === true) return { action: "none", patch: { eligible: true } };
    // Announce only a submission we watched happen (we were already tracking this case), or one reported by the submit itself - never a case we meet for the first time already submitted.
    const watched = trigger === "submit" || Boolean(state?.startedAt);
    const recentlyAcknowledged = state?.receivedEmailedAt && at - new Date(state.receivedEmailedAt).getTime() < RECEIVED_COOLDOWN_MS;
    if (watched && !recentlyAcknowledged) return { action: "received", patch: { eligible: true, submitted: true, submittedAt: now, receivedEmailedAt: now } };
    return { action: "none", patch: { eligible: true, submitted: true, submittedAt: state?.submittedAt || now } };
  }
  // not submitted
  if (!state?.startedAt) return { action: "init", patch: { eligible: true, submitted: false, startedAt: now, nextDueAt: next(at) } };
  if (state.submitted === true) return { action: "restart", patch: { eligible: true, submitted: false, startedAt: now, nextDueAt: next(at) } }; // returned to the client: a fresh 3 days
  const due = state.nextDueAt ? new Date(state.nextDueAt).getTime() : new Date(state.startedAt).getTime() + interval;
  if (due <= at) return { action: "remind", patch: { eligible: true, submitted: false, lastReminderAt: now, nextDueAt: next(at) } };
  return { action: "none", patch: { eligible: true } };
}

function defaultDeps() {
  return {
    Case: require("../../models/Case"),
    User: require("../../models/User"),
    Client: require("../../models/Client"),
    Questionnaire: require("../../models/Questionnaire"),
    emailService: require("../email/email.service"),
    portalUrl: require("../email/portalUrls").portalUrl,
  };
}

const CASE_FIELDS = "user clientProfile caseNumber stage status questionnaireReferences participants checklistApproval checklistReminder";

/**
 * Looks at one case and does what decide() says. Never throws. trigger "submit" = the client has just pressed Submit.
 * Returns { action, sent?, skipped? } (skipped = a reason the case was left alone).
 */
async function evaluateCase(caseId, { trigger = "job", now = new Date(), deps = defaultDeps() } = {}) {
  try {
    if (!enabled()) return { skipped: "disabled" };
    const { Case } = deps;
    const caseData = await Case.findById(caseId).select(CASE_FIELDS).lean();
    if (!caseData) return { skipped: "case_not_found" };
    const mark = (patch) => Case.updateOne({ _id: caseData._id }, { $set: { ...Object.fromEntries(Object.entries(patch).map(([key, value]) => [`checklistReminder.${key}`, value])), "checklistReminder.evaluatedAt": now } }, { timestamps: false });
    if (FINISHED_STAGES.has(caseData.stage) || FINISHED_STATUSES.has(caseData.status) || !caseData.user) { await mark({ eligible: false }); return { skipped: "case_not_open" }; }
    const user = await deps.User.findById(caseData.user).select("name email role isActive").lean();
    if (!user || user.isActive === false || !user.email) { await mark({ eligible: false }); return { skipped: "no_active_recipient" }; }

    const ids = [...new Set((caseData.questionnaireReferences || []).map((reference) => String(reference.questionnaireId || reference.questionnaireTemplateId || "")).filter(Boolean))];
    const templates = ids.length ? await deps.Questionnaire.find({ _id: { $in: ids } }).select("key checklistRole").lean() : [];
    const byId = new Map(templates.map((template) => [String(template._id), template]));
    const client = caseData.clientProfile ? await deps.Client.findById(caseData.clientProfile).select("intakeSubmission.status").lean().catch(() => null) : null;
    const assessment = assess({
      caseData, user,
      questionnaireOf: (reference) => byId.get(String(reference.questionnaireId || reference.questionnaireTemplateId || "")),
      intakeSubmitted: client?.intakeSubmission?.status === "submitted",
    });
    const state = caseData.checklistReminder || undefined;
    const decision = decide({ state, assessment, now, trigger });

    if (decision.action === "none" || decision.action === "init" || decision.action === "restart") { await mark(decision.patch); return { action: decision.action }; }

    // remind / received: claim the send first (only one evaluator can win the same step), then send, then record how it went
    const claimFilter = decision.action === "remind"
      ? { _id: caseData._id, "checklistReminder.submitted": { $ne: true }, "checklistReminder.nextDueAt": state.nextDueAt || null }
      : { _id: caseData._id, "checklistReminder.receivedEmailedAt": state?.receivedEmailedAt || null };
    const claimed = await Case.updateOne(claimFilter, { $set: { ...Object.fromEntries(Object.entries(decision.patch).map(([key, value]) => [`checklistReminder.${key}`, value])), "checklistReminder.evaluatedAt": now }, ...(decision.action === "remind" ? { $inc: { "checklistReminder.reminderCount": 1 } } : {}) }, { timestamps: false });
    if (!(claimed?.modifiedCount > 0 || claimed?.nModified > 0)) return { skipped: "already_handled" };

    const templateKey = decision.action === "remind" ? "checklist-incomplete-reminder" : "checklist-received-client";
    let outcome = "error";
    try {
      const result = await deps.emailService.sendTemplateEmail(templateKey, {
        to: user.email, recipientRole: user.role, caseId: caseData._id, userId: user._id, source: "shared",
        data: { clientName: user.name, caseNumber: caseData.caseNumber, loginLink: `${deps.portalUrl("client")}/login` },
      });
      outcome = result?.sent ? "sent" : `skipped:${result?.reason || "not_sent"}`;
    } catch (error) {
      outcome = `error:${String(error.message).slice(0, 80)}`;
      logger.error("checklist_reminder_email_failed", { caseId: String(caseData._id), templateKey, error: error.message });
    }
    await Case.updateOne({ _id: caseData._id }, { $set: { "checklistReminder.lastOutcome": outcome } }, { timestamps: false }).catch(() => null);
    return { action: decision.action, sent: outcome === "sent", outcome };
  } catch (error) {
    logger.error("checklist_reminder_evaluate_failed", { caseId: String(caseId), error: error.message });
    return { skipped: "error" };
  }
}

/** Fire-and-forget check right after a Submit has been committed (the caller never waits and can never be affected). */
function evaluateInBackground(caseId, options) {
  try {
    if (!caseId || !enabled()) return;
    const timer = setImmediate(() => { evaluateCase(caseId, { trigger: "submit", ...options }).catch(() => null); });
    timer.unref?.();
  } catch (_error) { /* bookkeeping only */ }
}

/** The periodic pass: cases never looked at, cases whose reminder is due, and cases changed since they were last looked at (e.g. returned to the client). Bounded per run. */
async function runAll({ now = new Date(), limit = Number(process.env.CHECKLIST_REMINDER_BATCH || 400), deps = defaultDeps() } = {}) {
  if (!enabled()) return { skipped: "disabled" };
  const finishedStages = [...FINISHED_STAGES];
  const finishedStatuses = [...FINISHED_STATUSES];
  const rows = await deps.Case.find({
    user: { $exists: true, $ne: null },
    stage: { $nin: finishedStages },
    status: { $nin: finishedStatuses },
    "questionnaireReferences.0": { $exists: true },
    $or: [
      { "checklistReminder.evaluatedAt": { $exists: false } },
      { "checklistReminder.submitted": false, "checklistReminder.nextDueAt": { $lte: now } },
      { $expr: { $gt: ["$updatedAt", "$checklistReminder.evaluatedAt"] } },
    ],
  }).select("_id").sort({ "checklistReminder.evaluatedAt": 1 }).limit(limit).lean();
  const summary = { considered: rows.length, reminded: 0, received: 0, started: 0, skipped: 0 };
  for (const row of rows) {
    const result = await evaluateCase(row._id, { trigger: "job", now, deps });
    if (result.action === "remind" && result.sent) summary.reminded += 1;
    else if (result.action === "received" && result.sent) summary.received += 1;
    else if (result.action === "init" || result.action === "restart") summary.started += 1;
    else if (result.skipped) summary.skipped += 1;
  }
  return summary;
}

module.exports = { assess, decide, evaluateCase, evaluateInBackground, runAll, enabled, intervalMs, ROLE_TARGETS };
