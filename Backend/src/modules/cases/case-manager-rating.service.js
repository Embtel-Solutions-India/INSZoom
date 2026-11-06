const CaseManagerRating = require("../../models/CaseManagerRating");
const Case = require("../../models/Case");
const Task = require("../../models/Task");
const User = require("../../models/User");
const { normalizeRole } = require("../authorization/roleHierarchy");
const { caseManagerMatch, completedCaseMatch } = require("./caseManagerAccess");

// Weekly performance ratings for case managers. A week runs Monday 00:00 to the next Monday 00:00 (server time).
const DAY = 24 * 60 * 60 * 1000;
const RATER_ROLES = ["super_admin", "admin", "team_lead"];
const CLOSED_CASE_STATUSES = ["completed", "closed", "approved"];

function weekStartOf(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const sinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - sinceMonday);
  return d;
}
const weekEndOf = (start) => new Date(new Date(start).getTime() + 7 * DAY);

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

const average = (ratings) => (ratings.length ? Math.round((ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length) * 10) / 10 : null);
// A team lead "has" a case manager when they share a team, or when the team lead is the assigned team lead on any of that manager's cases.
async function teamLeadOwns(user, manager) {
  if (user.teamId && String(user.teamId) === String(manager.teamId || "")) return true;
  return Boolean(await Case.exists({ assignedTeamLead: user._id, ...caseManagerMatch(manager._id) }));
}

// Who may rate this case manager: admins and super admins any; a team lead only a case manager of their own team.
async function assertCanRate(user, caseManager) {
  const role = normalizeRole(user.role);
  if (!RATER_ROLES.includes(role)) throw httpError(403, "Only admins and team leads can rate a case manager");
  if (role === "team_lead" && !(await teamLeadOwns(user, caseManager))) throw httpError(403, "A team lead can rate only the case managers of their own team");
}

async function loadCaseManager(id) {
  const manager = await User.findById(id).select("name displayName email role teamId");
  if (!manager || normalizeRole(manager.role) !== "case_manager") throw httpError(404, "Case manager not found");
  return manager;
}

// What each viewer sees of the individual ratings: the super admin everything (with the rater's name), the case manager their own received
// ratings (rater's role only), an admin / team lead just their own rating (the week's average and count are always shown).
// (2026-11-06) Every review is shown separately to everyone who may open this page - the case manager, admins, super admins and the team lead of the
// case manager's team - each with who gave it (name and role), its stars and its paragraph: "Admin 3/5", "Team Lead 4/5 - excellent ...".
function visibleRatings(viewer, managerId, ratings, raterNames) {
  const shape = (r, extra = {}) => ({ _id: r._id, rating: r.rating, review: r.review, ratedByRole: r.ratedByRole, updatedAt: r.updatedAt, ...extra });
  return ratings.map((r) => shape(r, { ratedByName: raterNames.get(String(r.ratedBy)) || "", mine: String(r.ratedBy) === String(viewer._id) }));
}

// The overall performance: the average of every review ever given to this case manager (one decimal), recalculated from the stored reviews on every read,
// so a new or changed review moves it at once.
async function overallSummary(managerId) {
  const [row] = await CaseManagerRating.aggregate([
    { $match: { caseManager: managerId } },
    { $group: { _id: null, average: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);
  return { average: row ? Math.round(row.average * 10) / 10 : null, count: row?.count || 0 };
}

async function weekAnalytics(managerId, start) {
  const end = weekEndOf(start);
  const [completedCases, completedTasks] = await Promise.all([
    Case.countDocuments({ $and: [caseManagerMatch(managerId), completedCaseMatch(), { updatedAt: { $gte: start, $lt: end } }] }), // completed = GoHighLevel stage Submitted (FedEx) or later
    Task.countDocuments({ assignedTo: managerId, status: "completed", updatedAt: { $gte: start, $lt: end } }),
  ]);
  return { completedCases, completedTasks };
}

async function getRatings(viewer, managerId, { historyWeeks = 12 } = {}) {
  const manager = await loadCaseManager(managerId);
  const role = normalizeRole(viewer.role);
  const isSelf = String(viewer._id) === String(manager._id);
  if (!isSelf && !RATER_ROLES.includes(role)) throw httpError(403, "Not authorized to view these ratings");
  const owns = role === "team_lead" && !isSelf ? await teamLeadOwns(viewer, manager) : true;
  if (!owns) throw httpError(403, "Not authorized to view this case manager's ratings");

  const thisWeek = weekStartOf();
  const earliest = new Date(thisWeek.getTime() - historyWeeks * 7 * DAY);
  const ratings = await CaseManagerRating.find({ caseManager: manager._id, weekStart: { $gte: earliest } }).sort({ weekStart: -1, updatedAt: -1 }).lean();
  const raterIds = [...new Set(ratings.map((r) => String(r.ratedBy)))];
  const raters = raterIds.length ? await User.find({ _id: { $in: raterIds } }).select("name displayName").lean() : [];
  const raterNames = new Map(raters.map((r) => [String(r._id), r.displayName || r.name || ""]));

  const byWeek = new Map();
  ratings.forEach((r) => {
    const key = new Date(r.weekStart).getTime();
    if (!byWeek.has(key)) byWeek.set(key, []);
    byWeek.get(key).push(r);
  });
  const shape = async (start) => {
    const weekRatings = byWeek.get(new Date(start).getTime()) || [];
    return {
      weekStart: start,
      weekEnd: new Date(weekEndOf(start).getTime() - 1),
      average: average(weekRatings),
      ratingCount: weekRatings.length,
      ratings: visibleRatings(viewer, manager._id, weekRatings, raterNames),
      analytics: await weekAnalytics(manager._id, start),
    };
  };
  const overall = await overallSummary(manager._id);
  const currentWeek = await shape(thisWeek);
  const pastStarts = [...byWeek.keys()].filter((time) => time < thisWeek.getTime()).sort((a, b) => b - a).map((time) => new Date(time));
  const history = await Promise.all(pastStarts.map(shape));
  return {
    caseManager: { _id: manager._id, name: manager.displayName || manager.name, email: manager.email },
    isSelf,
    canRate: !isSelf && RATER_ROLES.includes(role) && owns,
    overall,
    currentWeek,
    history,
  };
}

async function rateCurrentWeek(user, managerId, { rating, review } = {}) {
  const manager = await loadCaseManager(managerId);
  await assertCanRate(user, manager);
  const value = Number(rating);
  if (!Number.isInteger(value) || value < 1 || value > 5) throw httpError(400, "Rating must be a whole number from 1 to 5");
  const text = String(review || "").trim().slice(0, 2000);
  const saved = await CaseManagerRating.findOneAndUpdate(
    { caseManager: manager._id, weekStart: weekStartOf(), ratedBy: user._id },
    { $set: { rating: value, review: text, ratedByRole: normalizeRole(user.role) } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  // after the save, never failing it: tell the case manager (e-mail + bell + browser) and refresh their open page
  Promise.resolve().then(() => notifyReviewReceived(manager, user, saved)).catch((error) => console.error("[review] notify failed (non-fatal):", error.message));
  return saved;
}

// The case manager is told they received a review for their week; the Performance page they may have open refreshes at once.
async function notifyReviewReceived(manager, rater, saved) {
  const roleLabel = { super_admin: "Super Admin", admin: "Admin", team_lead: "Team Lead" }[normalizeRole(rater.role)] || "A reviewer";
  try { require("../realtime/realtime.gateway").emitToUser(manager._id, "rating:updated", { caseManagerId: String(manager._id) }); } catch (_error) { /* live refresh only */ }
  if (String(process.env.WEEKLY_REVIEW_EMAILS || "").toLowerCase() === "false") return;
  await require("../notifications/notification.service").createNotification({
    userId: manager._id,
    type: "performance_review_received",
    category: "system",
    title: "You received feedback on your performance",
    message: `${roleLabel} rated your performance this week ${saved.rating}/5.`,
    link: "/my-performance",
    priority: "medium",
    channels: ["in_app", "socket", "push"],
    source: "shared",
    emailTemplate: "performance-review-received",
    emailTo: manager.email,
    emailData: { name: manager.displayName || manager.name, reviewerRole: roleLabel, rating: saved.rating },
  }, rater, null);
}

// This week's average + count per case manager, and the viewer's own rating, for the case managers list (one grouped query).
async function currentWeekSummaries(viewer) {
  const rows = await CaseManagerRating.aggregate([
    { $match: { weekStart: weekStartOf() } },
    { $group: { _id: "$caseManager", average: { $avg: "$rating" }, count: { $sum: 1 }, mine: { $max: { $cond: [{ $eq: ["$ratedBy", viewer._id] }, "$rating", null] } } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), { average: Math.round(row.average * 10) / 10, count: row.count, mine: row.mine }]));
}

module.exports = { getRatings, rateCurrentWeek, currentWeekSummaries, weekStartOf, RATER_ROLES };
