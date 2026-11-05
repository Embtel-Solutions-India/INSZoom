// Every Friday 5:30 AM IST: ONE e-mail (plus the bell and browser notification) to each team lead, admin and super admin, asking them to review their
// case managers' performance for the week. Blocked e-mail addresses are skipped by the e-mail service itself (EMAIL_BLOCKED_RECIPIENTS).
// Fail-safe: nothing here ever throws into the scheduler; turn it off with WEEKLY_REVIEW_EMAILS=false.
const User = require("../../models/User");
const WeeklyReviewRun = require("../../models/WeeklyReviewRun");
const notificationService = require("../notifications/notification.service");
const logger = require("../../utils/logger");

const IST_OFFSET_MS = 330 * 60 * 1000;
const SEND_HOUR_IST = 5;
const SEND_MINUTE_IST = 30;
const REVIEWER_ROLES = ["super_admin", "admin", "team_lead"];

const enabled = () => String(process.env.WEEKLY_REVIEW_EMAILS || "").toLowerCase() !== "false";

// Is it Friday, 5:30 AM IST or later (the same Friday)? Returns that Friday's IST date (the week key) or "".
function dueWeekKey(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  if (ist.getUTCDay() !== 5) return "";
  if (ist.getUTCHours() * 60 + ist.getUTCMinutes() < SEND_HOUR_IST * 60 + SEND_MINUTE_IST) return "";
  return ist.toISOString().slice(0, 10);
}

async function claimWeek(weekKey) {
  try {
    await WeeklyReviewRun.create({ weekKey });
    return true;
  } catch (error) {
    if (error?.code === 11000) return false; // already sent for this Friday
    throw error;
  }
}

async function sendWeeklyReviewReminders(now = new Date()) {
  if (!enabled()) return { skipped: "disabled" };
  const weekKey = dueWeekKey(now);
  if (!weekKey) return { skipped: "not_due" };
  if (!(await claimWeek(weekKey))) return { skipped: "already_sent", weekKey };

  const reviewers = await User.find({ role: { $in: REVIEWER_ROLES }, isActive: { $ne: false }, status: { $ne: "archived" } }).select("name displayName email role").lean();
  let sent = 0;
  let failures = 0;
  for (const person of reviewers) {
    if (!person.email) continue;
    try {
      await notificationService.createNotification({
        userId: person._id,
        type: "weekly_review_reminder",
        category: "system",
        title: "It's Friday: review your case managers",
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
      logger.error("weekly_review_reminder_failed", { userId: String(person._id), error });
    }
  }
  await WeeklyReviewRun.updateOne({ weekKey }, { $set: { recipients: sent, failures } }).catch(() => null);
  return { weekKey, recipients: sent, failures };
}

module.exports = { sendWeeklyReviewReminders, dueWeekKey, REVIEWER_ROLES };
