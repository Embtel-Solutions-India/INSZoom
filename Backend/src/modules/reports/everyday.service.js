// "Everyday plan" (today's goals) and "Everyday report" (today's achievements) for the internal team.
//
// The work day follows the team's shift: it STARTS at 21:00 IST and ends at 21:00 IST the next day. Its key (workDate) is the IST date it starts on, so goals written at
// 21:00 IST and achievements written the next morning at 06:30 IST belong to the same day. Everything below that depends on the clock takes `now` as an argument.
const EverydayLog = require("../../models/EverydayLog");
const User = require("../../models/User");
const EODReport = require("../../models/EODReport");
const notificationService = require("../notifications/notification.service");
const logger = require("../../utils/logger");

const IST_OFFSET_MS = 330 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_START_MINUTE = 21 * 60; // 21:00 IST: the work day (and the goals prompt) begins
const REPORT_PROMPT_MINUTE = 6 * 60 + 30; // 06:30 IST: "write what you achieved"
const PLAN_PUSH_MINUTE = 22 * 60 + 45; // 22:45 IST
const REPORT_PUSH_MINUTE = 6 * 60 + 45; // 06:45 IST
const PUSH_GRACE_MINUTES = 6;
// Who WRITES an Everyday plan / report (and gets its reminders and an EOD row): the internal team except the super admin, who has none. The super admin only reads.
const INTERNAL_ROLES = ["admin", "team_lead", "case_manager", "paralegal", "finance", "hr", "reviewer"];
const READER_ROLES = ["super_admin", ...INTERNAL_ROLES];

// Whose EOD a person may see: super admin all; admin everyone but the super admin; team lead the team leads and case managers; everyone else only their own.
function visibleRolesFor(user) {
  const role = String(user?.role || "");
  if (role === "super_admin") return { roles: INTERNAL_ROLES };
  if (role === "admin") return { roles: INTERNAL_ROLES };
  if (role === "team_lead") return { roles: ["team_lead", "case_manager"] };
  return { roles: [], selfOnly: true };
}
// The people one viewer may see, as a User filter (never includes the super admin).
function viewerScope(user, role) {
  const { roles, selfOnly } = visibleRolesFor(user);
  if (selfOnly) return { _id: user._id };
  const allowed = role && roles.includes(role) ? [role] : roles;
  return { role: { $in: allowed } };
}
const MAX_ITEMS = 50;
const MAX_ITEM_LENGTH = 500;

const serviceError = (message, status = 400) => Object.assign(new Error(message), { status });
const istMinute = (now) => {
  const ist = new Date(new Date(now).getTime() + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
};
// The work day a moment belongs to: the IST date of (moment - 21h).
function workDateOf(now = new Date()) {
  return new Date(new Date(now).getTime() + IST_OFFSET_MS - 21 * HOUR_MS).toISOString().slice(0, 10);
}
const isWorkDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

// Accepts an array of strings (or one string, a point per line); trims, drops empties and a leading "1." / "-" / bullet, and bounds count and length.
function cleanItems(value) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\r?\n/) : null;
  if (!list) throw serviceError("Points must be a list of text");
  const items = list
    .map((entry) => String(entry ?? "").replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim().slice(0, MAX_ITEM_LENGTH))
    .filter(Boolean);
  if (items.length > MAX_ITEMS) throw serviceError(`At most ${MAX_ITEMS} points are allowed`);
  return items;
}

// Which sticky boxes this person should see. No time window: the goals box appears at 21:00 IST and the achievements box at 06:30 IST (of the same work day),
// and each stays until it is written or crossed. Crossing is stored on the server, so it holds on every screen / tab and refresh.
function promptsFor(log, now = new Date()) {
  const minute = istMinute(now);
  const planDue = minute >= DAY_START_MINUTE || minute < REPORT_PROMPT_MINUTE; // 21:00 onward; the work day itself rolls over at 21:00
  const planDone = Boolean(log?.planItems?.length) || Boolean(log?.planPromptDismissedAt);
  const reportDue = minute >= REPORT_PROMPT_MINUTE && minute < DAY_START_MINUTE;
  const reportDone = Boolean(log?.reportItems?.length) || Boolean(log?.reportPromptDismissedAt);
  return { plan: planDue && !planDone, report: reportDue && !reportDone };
}

const shape = (log, workDate) => ({
  workDate,
  planItems: log?.planItems || [],
  reportItems: log?.reportItems || [],
  planUpdatedAt: log?.planUpdatedAt || null,
  reportUpdatedAt: log?.reportUpdatedAt || null,
});

let indexReady = null;
const ensureIndex = () => (indexReady = indexReady || EverydayLog.createIndexes().catch(() => null)); // autoIndex is off in this app

async function upsert(staff, workDate, update) {
  await ensureIndex();
  const run = () => EverydayLog.findOneAndUpdate({ staff, workDate }, { ...update, $setOnInsert: { staff, workDate } }, { upsert: true, new: true }).lean();
  try {
    return await run();
  } catch (error) {
    if (error?.code === 11000) return run(); // two requests created it together: the second one just updates
    throw error;
  }
}

async function getMine(user, now = new Date()) {
  const workDate = workDateOf(now);
  const log = await EverydayLog.findOne({ staff: user._id, workDate }).lean();
  return { ...shape(log, workDate), prompts: promptsFor(log, now), serverTime: new Date(now).toISOString() };
}

// Writes ONLY the signed-in person's own current work day. Either field may be sent alone.
async function saveMine(user, body = {}, now = new Date()) {
  const workDate = workDateOf(now);
  const set = {};
  if (body.planItems !== undefined) { set.planItems = cleanItems(body.planItems); set.planUpdatedAt = now; }
  if (body.reportItems !== undefined) { set.reportItems = cleanItems(body.reportItems); set.reportUpdatedAt = now; }
  if (!Object.keys(set).length) throw serviceError("Nothing to save");
  const log = await upsert(user._id, workDate, { $set: set });
  return { ...shape(log, workDate), prompts: promptsFor(log, now) };
}

async function dismissMine(user, kind, now = new Date()) {
  const field = { plan: "planPromptDismissedAt", report: "reportPromptDismissedAt" }[kind];
  if (!field) throw serviceError("Unknown prompt");
  const workDate = workDateOf(now);
  const log = await upsert(user._id, workDate, { $set: { [field]: now } });
  return { ...shape(log, workDate), prompts: promptsFor(log, now) };
}

// Everybody on the internal team can read everybody's points. `date` is a work date (YYYY-MM-DD); `staff` narrows it to one person.
async function listForDate({ date, staff } = {}, user, now = new Date()) {
  const workDate = isWorkDate(date) ? date : workDateOf(now);
  const visible = (await User.find({ ...viewerScope(user), isActive: { $ne: false } }).select("_id").lean()).map((person) => person._id);
  const filter = { workDate, staff: { $in: visible } };
  if (staff) filter.staff = { $in: visible.filter((id) => String(id) === String(staff)) };
  const logs = await EverydayLog.find(filter).populate("staff", "name displayName email role").lean();
  return { workDate, entries: logs.map((log) => ({ staff: log.staff, ...shape(log, workDate) })) };
}

const ROLE_ORDER = { super_admin: 0, admin: 1, team_lead: 2, case_manager: 3 };
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

// The work days a period covers, newest first (never after the current work day).
function daysFor(period, now) {
  const today = workDateOf(now);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  let first = todayMs;
  if (period === "this_week") first = todayMs - (((new Date(todayMs).getUTCDay() + 6) % 7) * 86400000);
  else if (period === "this_month") first = Date.UTC(new Date(todayMs).getUTCFullYear(), new Date(todayMs).getUTCMonth(), 1);
  else if (period !== "today") first = todayMs - 179 * 86400000; // all time: the last 180 days
  const days = [];
  for (let ms = todayMs; ms >= first; ms -= 86400000) days.push(dayKey(ms));
  return days;
}

// The EOD board: one row per person per work day, newest day first. Roles first (super admin, admin, team leads, case managers, the rest), then the most cases worked.
// Everyone on the internal team sees everyone. The current day lists the whole team (so people always find their own row); earlier days only people with something on them.
const DAYS_PER_PAGE = 7;
async function board({ period, role, page } = {}, user, now = new Date()) {
  const allDays = daysFor(period, now);
  const pages = Math.max(1, Math.ceil(allDays.length / DAYS_PER_PAGE));
  const current = Math.min(Math.max(parseInt(page, 10) || 1, 1), pages);
  const days = allDays.slice((current - 1) * DAYS_PER_PAGE, current * DAYS_PER_PAGE);
  const today = workDateOf(now);
  const people = await User.find({ ...viewerScope(user, role), isActive: { $ne: false }, status: { $ne: "archived" } }).select("name displayName email role").lean();
  const ids = people.map((person) => person._id);
  const [logs, counts] = await Promise.all([
    EverydayLog.find({ workDate: { $in: days }, staff: { $in: ids } }).lean(),
    require("./staffActivity").countsForDays(days),
  ]);
  const logOf = new Map(logs.map((log) => [`${log.staff}|${log.workDate}`, log]));
  const legacy = new Map();
  const oldest = Date.parse(`${days[days.length - 1]}T00:00:00Z`) - 86400000;
  for (const report of await EODReport.find({ staff: { $in: ids }, date: { $gte: new Date(oldest) } }).lean()) {
    legacy.set(`${report.staff}|${new Date(new Date(report.date).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)}`, report);
  }
  const name = (person) => (person.name || person.displayName || person.email || "").toLowerCase();
  return {
    today,
    pagination: { page: current, pages, total: allDays.length, perPage: DAYS_PER_PAGE },
    days: days.map((date) => {
      const rows = [];
      for (const person of people) {
        const key = `${person._id}|${date}`;
        const log = logOf.get(key);
        const activity = counts[key];
        const old = legacy.get(key);
        const stats = activity
          ? { casesWorked: activity.case, casesClosed: activity.closed, documentsReviewed: activity.document, messagesReplied: activity.message }
          : { casesWorked: old?.casesWorked || 0, casesClosed: old?.casesClosed || 0, documentsReviewed: old?.documentsReviewed || 0, messagesReplied: old?.messagesReplied || 0 };
        const hasData = Boolean(log?.planItems?.length || log?.reportItems?.length || activity || old);
        if (!hasData && date !== today) continue;
        rows.push({ staff: { _id: person._id, name: person.name, displayName: person.displayName, email: person.email, role: person.role }, date, planItems: log?.planItems || [], reportItems: log?.reportItems || [], stats });
      }
      rows.sort((a, b) => (ROLE_ORDER[a.staff.role] ?? 9) - (ROLE_ORDER[b.staff.role] ?? 9) || b.stats.casesWorked - a.stats.casesWorked || name(a.staff).localeCompare(name(b.staff)));
      return { date, rows };
    }),
  };
}

const enabled = () => String(process.env.EVERYDAY_REMINDERS || "").toLowerCase() !== "false";

const MESSAGES = {
  plan: { type: "everyday_plan_reminder", title: "Write your today's goal", message: "Set your goals for today in the Everyday plan.", link: "/eod-reports?section=plan" },
  report: { type: "everyday_report_reminder", title: "Don't forget your achievements", message: "Write what you achieved today in the Everyday report.", link: "/eod-reports?section=report" },
};

// 22:45 IST (goals) and 06:45 IST (achievements): the bell notification + browser push, NO e-mail, once per person per work day, and only to people who have
// not written by then. The person is marked before they are notified (atomic), so a restart / second instance / repeated tick cannot send twice; the mark is
// taken back only if the send itself failed. Never throws.
async function sendDueReminders(now = new Date()) {
  if (!enabled()) return { skipped: "disabled" };
  const minute = istMinute(now);
  const kinds = [];
  // Exactly at the time: only the few minutes after it (the check runs every 2 minutes), never "any time after".
  const at = (start) => minute >= start && minute < start + PUSH_GRACE_MINUTES;
  if (at(PLAN_PUSH_MINUTE)) kinds.push("plan");
  if (at(REPORT_PUSH_MINUTE)) kinds.push("report");
  if (!kinds.length) return { skipped: "not_due" };
  const workDate = workDateOf(now);
  const people = await User.find({ role: { $in: INTERNAL_ROLES }, isActive: { $ne: false }, status: { $ne: "archived" } }).select("_id").lean();
  const result = { workDate, plan: 0, report: 0, failures: 0 };
  for (const kind of kinds) {
    const itemsField = kind === "plan" ? "planItems" : "reportItems";
    const stamp = kind === "plan" ? "planPushSentAt" : "reportPushSentAt";
    const done = new Set((await EverydayLog.find({ workDate, $or: [{ [`${itemsField}.0`]: { $exists: true } }, { [stamp]: { $exists: true } }] }).select("staff").lean()).map((row) => String(row.staff)));
    for (const person of people) {
      if (done.has(String(person._id))) continue;
      try {
        await upsert(person._id, workDate, {});
        const claim = await EverydayLog.updateOne({ staff: person._id, workDate, [stamp]: { $exists: false }, [`${itemsField}.0`]: { $exists: false } }, { $set: { [stamp]: now } });
        if (claim.modifiedCount !== 1) continue; // written meanwhile, or another instance already sent it
        try {
          await notificationService.createNotification({ userId: person._id, ...MESSAGES[kind], category: "system", priority: "medium", channels: ["in_app", "socket", "push"], source: "Admin", dedupeKey: `${kind}:${person._id}:${workDate}`, data: { tag: `everyday-${kind}-${workDate}` } }, null, null);
          result[kind] += 1;
        } catch (error) {
          result.failures += 1;
          await EverydayLog.updateOne({ staff: person._id, workDate }, { $unset: { [stamp]: 1 } }).catch(() => null);
          logger.error("everyday_reminder_failed", { userId: String(person._id), kind, error });
        }
      } catch (error) {
        result.failures += 1;
        logger.error("everyday_reminder_failed", { userId: String(person._id), kind, error });
      }
    }
  }
  return result;
}

module.exports = { READER_ROLES, visibleRolesFor, board, daysFor, workDateOf, cleanItems, promptsFor, getMine, saveMine, dismissMine, listForDate, sendDueReminders, INTERNAL_ROLES, MAX_ITEMS };
