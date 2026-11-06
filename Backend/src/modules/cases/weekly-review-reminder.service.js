// Every Saturday 5:30 AM IST: ONE e-mail (plus the bell and browser notification) to each team lead, admin and super admin, asking them to review their
// case managers' performance for the week. Blocked e-mail addresses are skipped by the e-mail service itself (EMAIL_BLOCKED_RECIPIENTS).
// Strictly once per person per week: the week has ONE record, and each person is marked on it (atomically, $addToSet) BEFORE they are notified, so a
// restart, a second instance or a repeated tick can never send them a second copy. The mark is taken back only when the send itself failed, so that
// person is retried. Fail-safe: nothing here ever throws into the scheduler; turn it off with WEEKLY_REVIEW_EMAILS=false.
const User = require("../../models/User");
const WeeklyReviewRun = require("../../models/WeeklyReviewRun");
const notificationService = require("../notifications/notification.service");
const logger = require("../../utils/logger");

const IST_OFFSET_MS = 330 * 60 * 1000;
const SEND_DAY_IST = 6; // Saturday (0 = Sunday)
const SEND_HOUR_IST = 5;
const SEND_MINUTE_IST = 30;
const REVIEWER_ROLES = ["super_admin", "admin", "team_lead"];

const enabled = () => String(process.env.WEEKLY_REVIEW_EMAILS || "").toLowerCase() !== "false";

// Is it Saturday, 5:30 AM IST or later (the same Saturday)? Returns that Saturday's IST date (the week key) or "".
function dueWeekKey(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  if (ist.getUTCDay() !== SEND_DAY_IST) return "";
  if (ist.getUTCHours() * 60 + ist.getUTCMinutes() < SEND_HOUR_IST * 60 + SEND_MINUTE_IST) return "";
  return ist.toISOString().slice(0, 10);
}

// The unique index on weekKey keeps the week to ONE record even when two instances start it together. It is created here (idempotently) because the
// application does not build indexes by itself; if older duplicate records exist, the earliest per week is kept and the index is built again.
let guardReady = false;
async function ensureGuard() {
  if (guardReady) return;
  const build = () => WeeklyReviewRun.collection.createIndex({ weekKey: 1 }, { unique: true, name: "weekKey_1" });
  try {
    await build();
  } catch (_error) {
    const duplicates = await WeeklyReviewRun.aggregate([{ $sort: { sentAt: 1 } }, { $group: { _id: "$weekKey", ids: { $push: "$_id" }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]);
    for (const row of duplicates) await WeeklyReviewRun.deleteMany({ _id: { $in: row.ids.slice(1) } });
    await build().catch((error) => logger.warn("weekly_review_guard_index_failed", { error: error.message }));
  }
  guardReady = true;
}

// The one record of this week (created on first use).
async function ensureWeek(weekKey) {
  try {
    await WeeklyReviewRun.updateOne({ weekKey }, { $setOnInsert: { weekKey, sentAt: new Date(), notified: [] } }, { upsert: true });
  } catch (error) {
    if (error?.code !== 11000) throw error; // a concurrent instance created it first: fine
  }
}

// Marks this person as notified for the week. true only for the one caller that actually made the mark.
async function claimPerson(weekKey, userId) {
  const result = await WeeklyReviewRun.updateOne({ weekKey, notified: { $ne: userId } }, { $addToSet: { notified: userId }, $inc: { recipients: 1 } });
  return result.modifiedCount === 1;
}

const releasePerson = (weekKey, userId) => WeeklyReviewRun.updateOne({ weekKey }, { $pull: { notified: userId }, $inc: { recipients: -1, failures: 1 } }).catch(() => null);

async function sendWeeklyReviewReminders(now = new Date()) {
  if (!enabled()) return { skipped: "disabled" };
  const weekKey = dueWeekKey(now);
  if (!weekKey) return { skipped: "not_due" };
  await ensureGuard();
  await ensureWeek(weekKey);

  const reviewers = await User.find({ role: { $in: REVIEWER_ROLES }, isActive: { $ne: false }, status: { $ne: "archived" } }).select("name displayName email role").lean();
  let sent = 0;
  let alreadySent = 0;
  let failures = 0;
  for (const person of reviewers) {
    if (!person.email) continue;
    if (!(await claimPerson(weekKey, person._id))) { alreadySent += 1; continue; } // already had this week's reminder
    try {
      await notificationService.createNotification({
        userId: person._id,
        type: "weekly_review_reminder",
        category: "system",
        title: "Review your case managers' week",
        message: "Give feedback on your case managers' performance this week.",
        link: "/case-managers",
        priority: "medium",
        channels: ["in_app", "socket", "push"],
        source: "shared",
        emailTemplate: "weekly-review-reminder",
        emailTo: person.email,
        emailData: { name: person.displayName || person.name },
      }, null, null);
      sent += 1;
    } catch (error) {
      failures += 1;
      await releasePerson(weekKey, person._id); // the send failed: take the mark back so the next tick retries this person
      logger.error("weekly_review_reminder_failed", { userId: String(person._id), error });
    }
  }
  return { weekKey, recipients: sent, alreadySent, failures };
}

module.exports = { sendWeeklyReviewReminders, dueWeekKey, claimPerson, ensureWeek, REVIEWER_ROLES, _markGuardReady: () => { guardReady = true; } };
