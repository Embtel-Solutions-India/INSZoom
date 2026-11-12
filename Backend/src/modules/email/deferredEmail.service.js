// "Delayed, never skipped": an email for a client who has not set a password yet is held here instead of being dropped, and released when they do.
//
//   enqueue()          the e-mail is stored (status "waiting") - once per identical e-mail (same person, template, case, event and content).
//   releaseForUser()   called when the client sets their password: every waiting e-mail is scheduled, the first for NOW and each next one a minute after the previous
//                      (oldest first), then the worker is nudged.
//   processDue()       sends every scheduled e-mail whose time has come, through the normal e-mail service (same template, same data), one claim at a time so two workers
//                      never send the same one. A failed send is retried a minute later, up to three attempts. The "same email a moment ago" repeat guard is bypassed
//                      for these - they are intentionally close together - every other guard (bad address, case team, provider) still applies.
//   startDeferredEmailWorker()   the timer that calls processDue every 20 seconds (and once shortly after start-up, so a restart never strands a scheduled e-mail).
const crypto = require("crypto");
const DeferredEmail = require("../../models/DeferredEmail");
const logger = require("../../utils/logger");

const SPACING_MS = 60 * 1000;
const MAX_ATTEMPTS = 3;
const STALE_SENDING_MS = 10 * 60 * 1000;

const idOf = (value) => value?._id?.toString?.() || value?.toString?.() || "";

function dedupeKeyFor({ userId, templateKey, caseId, event, data }) {
  const hash = crypto.createHash("sha1").update(JSON.stringify(data || {})).digest("hex").slice(0, 16);
  return `${idOf(userId)}:${templateKey}:${idOf(caseId)}:${event || ""}:${hash}`;
}

// Pure: the times the waiting e-mails go out (oldest first; the first now, each next one a minute later).
function planRelease(items, now = new Date(), spacingMs = SPACING_MS) {
  return [...items]
    .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
    .map((item, index) => ({ id: item._id, sendAfter: new Date(now.getTime() + index * spacingMs) }));
}

async function enqueue({ user, templateKey, data, caseId, triggeredBy, event }) {
  const dedupeKey = dedupeKeyFor({ userId: user._id, templateKey, caseId, event, data });
  const existing = await DeferredEmail.findOne({ dedupeKey, status: { $in: ["waiting", "scheduled"] } }).select("_id").lean();
  if (existing) return { queued: true, duplicate: true, id: existing._id };
  const created = await DeferredEmail.create({
    userId: user._id, to: user.email, templateKey, data, caseId, triggeredBy: triggeredBy?._id || triggeredBy, event, status: "waiting", dedupeKey,
  });
  return { queued: true, id: created._id };
}

async function releaseForUser(userId, now = new Date()) {
  try {
    const waiting = await DeferredEmail.find({ userId, status: "waiting" }).select("_id createdAt").lean();
    if (!waiting.length) return { scheduled: 0 };
    const plan = planRelease(waiting, now);
    await DeferredEmail.bulkWrite(plan.map((entry) => ({
      updateOne: { filter: { _id: entry.id, status: "waiting" }, update: { $set: { status: "scheduled", sendAfter: entry.sendAfter } } },
    })));
    setImmediate(() => processDue().catch(() => null)); // the first one goes at once; the worker sends the rest at their times
    return { scheduled: plan.length };
  } catch (error) {
    logger.error("deferred_email_release_failed", { userId: idOf(userId), error: error.message });
    return { scheduled: 0, error: error.message };
  }
}

async function sendOne(item) {
  const emailService = require("./email.service");
  return emailService.sendTemplateEmail(item.templateKey, {
    to: item.to, data: item.data || {}, caseId: item.caseId, userId: item.userId, triggeredBy: item.triggeredBy, recipientRole: "client", skipRepeatCheck: true,
  });
}

async function processDue(limit = 20) {
  const now = new Date();
  await DeferredEmail.updateMany({ status: "sending", updatedAt: { $lt: new Date(now.getTime() - STALE_SENDING_MS) } }, { $set: { status: "scheduled" } }).catch(() => null);
  let processed = 0;
  for (let i = 0; i < limit; i += 1) {
    const item = await DeferredEmail.findOneAndUpdate(
      { status: "scheduled", sendAfter: { $lte: new Date() } },
      { $set: { status: "sending" }, $inc: { attempts: 1 } },
      { sort: { sendAfter: 1 }, new: true }
    ).lean();
    if (!item) break;
    processed += 1;
    try {
      const result = await sendOne(item);
      if (result?.sent) await DeferredEmail.updateOne({ _id: item._id }, { $set: { status: "sent", sentAt: new Date(), error: undefined } });
      else if (result?.skipped) await DeferredEmail.updateOne({ _id: item._id }, { $set: { status: "skipped", error: String(result.reason || "skipped") } });
      else throw new Error(result?.error?.message || "the e-mail was not sent");
    } catch (error) {
      const retry = item.attempts < MAX_ATTEMPTS;
      await DeferredEmail.updateOne({ _id: item._id }, { $set: retry ? { status: "scheduled", sendAfter: new Date(Date.now() + SPACING_MS), error: error.message } : { status: "failed", error: error.message } }).catch(() => null);
      logger.warn("deferred_email_send_failed", { id: String(item._id), attempt: item.attempts, error: error.message });
    }
  }
  return { processed };
}

function startDeferredEmailWorker() {
  const { withJobLock } = require("../../utils/jobLock");
  const intervalMs = Number(process.env.DEFERRED_EMAIL_INTERVAL_MS || 20 * 1000);
  const run = () => withJobLock("deferred-email-release", intervalMs * 3, async () => { await processDue(); }).catch((error) => logger.error("deferred_email_worker_failed", { error: error?.message }));
  const first = setTimeout(run, 15 * 1000);
  first.unref?.();
  const handle = setInterval(run, intervalMs);
  handle.unref?.();
  return handle;
}

module.exports = { enqueue, releaseForUser, processDue, startDeferredEmailWorker, planRelease, dedupeKeyFor, SPACING_MS };
