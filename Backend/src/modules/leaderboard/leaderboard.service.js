// Live leaderboards, computed from the same case/task/feedback data the
// dashboard reads - nothing is stored or snapshotted, so a board can never
// disagree with the dashboard because it was last "calculated" yesterday.
//
// Definitions (shared with the dashboard's case analytics):
//   closed case = status closed | approved | completed
//   open case   = anything not closed and not ended without a result
//                 (rejected, cancelled, archived, removed)
// Cases have no dedicated "closed on" date, so "closed in the period" uses the
// case's last-updated time for cases that are currently closed.
const Case = require("../../models/Case");
const Task = require("../../models/Task");
const User = require("../../models/User");
const Feedback = require("../../models/Feedback");

const CLOSED_STATUSES = ["closed", "approved", "completed"];
const ENDED_STATUSES = ["rejected", "cancelled", "archived", "removed"];
const NOT_OPEN_STATUSES = [...CLOSED_STATUSES, ...ENDED_STATUSES];
const BOARDS = ["case_managers", "team_leads", "attorneys", "clients"];
const PERIODS = ["today", "this_week", "this_month", "all_time"];

// today = since midnight; this_week = since Monday; this_month = since the 1st.
function periodStart(period, now = new Date()) {
  const start = new Date(now);
  if (period === "today") {
    start.setHours(0, 0, 0, 0);
  } else if (period === "this_week") {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    start.setHours(0, 0, 0, 0);
  } else if (period === "this_month") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  } else {
    return null;
  }
  return start;
}

const displayName = (user) => user.name || user.displayName || user.email || "Unknown";
const toMap = (rows, valueKey = "n") => new Map(rows.map((row) => [String(row._id), row[valueKey]]));
const count = (map, id) => map.get(String(id)) || 0;

function rank(rows) {
  return rows
    .sort((a, b) => b.score - a.score || (b.closedCases || 0) - (a.closedCases || 0) || String(a.name).localeCompare(String(b.name)))
    .map((row, index) => ({ rank: index + 1, ...row }));
}

// Case managers and team leads share one shape: cases assigned to them via
// `field`, plus the tasks assigned to them.
async function staffBoard({ role, field }, period, now) {
  const users = await User.find({ role, isActive: true }).select("name displayName email").lean();
  if (!users.length) return [];
  const ids = users.map((user) => user._id);
  const start = periodStart(period, now);
  const closedMatch = { [field]: { $in: ids }, status: { $in: CLOSED_STATUSES }, ...(start ? { updatedAt: { $gte: start } } : {}) };
  const taskDoneMatch = { assignedTo: { $in: ids }, status: "completed", ...(start ? { updatedAt: { $gte: start } } : {}) };

  const [open, closed, totalClosed, tasksDone, overdue] = await Promise.all([
    Case.aggregate([{ $match: { [field]: { $in: ids }, status: { $nin: NOT_OPEN_STATUSES } } }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }]),
    Case.aggregate([{ $match: closedMatch }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }]),
    Case.aggregate([{ $match: { [field]: { $in: ids }, status: { $in: CLOSED_STATUSES } } }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }]),
    Task.aggregate([{ $match: taskDoneMatch }, { $group: { _id: "$assignedTo", n: { $sum: 1 } } }]),
    Task.aggregate([{ $match: { assignedTo: { $in: ids }, status: { $nin: ["completed", "cancelled"] }, dueDate: { $lt: now } } }, { $group: { _id: "$assignedTo", n: { $sum: 1 } } }]),
  ]);
  const [openMap, closedMap, totalClosedMap, tasksMap, overdueMap] = [open, closed, totalClosed, tasksDone, overdue].map((rows) => toMap(rows));

  return rank(users.map((user) => {
    const openCases = count(openMap, user._id);
    const closedCases = count(closedMap, user._id);
    const tasksCompleted = count(tasksMap, user._id);
    return {
      id: String(user._id),
      name: displayName(user),
      email: user.email,
      openCases,
      closedCases,
      totalClosedCases: count(totalClosedMap, user._id),
      tasksCompleted,
      overdueTasks: count(overdueMap, user._id),
      score: closedCases * 10 + tasksCompleted * 3 + openCases,
    };
  }));
}

// Attorneys: cases they are working on (active access on an open case), cases
// closed, and the feedback they have given the case team.
async function attorneyBoard(period, now) {
  const users = await User.find({ role: "attorney", isActive: true }).select("name displayName email").lean();
  if (!users.length) return [];
  const ids = users.map((user) => user._id);
  const start = periodStart(period, now);
  const accessPipeline = (statusMatch) => [
    { $match: { attorneyAccess: { $elemMatch: { attorneyId: { $in: ids }, status: "active" } }, ...statusMatch } },
    { $unwind: "$attorneyAccess" },
    { $match: { "attorneyAccess.status": "active", "attorneyAccess.attorneyId": { $in: ids } } },
    { $group: { _id: "$attorneyAccess.attorneyId", n: { $sum: 1 } } },
  ];
  const feedbackMatch = { authorId: { $in: ids }, ...(start ? { createdAt: { $gte: start } } : {}) };

  const [working, closed, feedbackRows] = await Promise.all([
    Case.aggregate(accessPipeline({ status: { $nin: NOT_OPEN_STATUSES } })),
    Case.aggregate(accessPipeline({ status: { $in: CLOSED_STATUSES }, ...(start ? { updatedAt: { $gte: start } } : {}) })),
    Feedback.aggregate([
      { $match: feedbackMatch },
      { $group: { _id: "$authorId", messages: { $sum: 1 }, caseIds: { $addToSet: "$caseId" } } },
    ]),
  ]);
  const allFeedbackCaseIds = [...new Set(feedbackRows.flatMap((row) => row.caseIds.map(String)))];
  const closedFeedbackCases = allFeedbackCaseIds.length
    ? new Set((await Case.find({ _id: { $in: allFeedbackCaseIds }, status: { $in: CLOSED_STATUSES } }).select("_id").lean()).map((c) => String(c._id)))
    : new Set();
  const workingMap = toMap(working);
  const closedMap = toMap(closed);
  const feedbackByAttorney = new Map(feedbackRows.map((row) => [String(row._id), row]));

  return rank(users.map((user) => {
    const feedback = feedbackByAttorney.get(String(user._id));
    const feedbackCases = feedback ? feedback.caseIds.length : 0;
    const workingCases = count(workingMap, user._id);
    const closedCases = count(closedMap, user._id);
    return {
      id: String(user._id),
      name: displayName(user),
      email: user.email,
      workingCases,
      closedCases,
      feedbackMessages: feedback?.messages || 0,
      feedbackCases,
      feedbackAndClosed: feedback ? feedback.caseIds.filter((id) => closedFeedbackCases.has(String(id))).length : 0,
      score: closedCases * 10 + feedbackCases * 3 + workingCases,
    };
  }));
}

// Clients: who brings in the most work. One row per client; a client's
// matter (principal / single case) counts once - the employee and
// beneficiary child cases hanging off it are not separate "cases brought in".
async function clientBoard(period, now) {
  const start = periodStart(period, now);
  const rows = await Case.aggregate([
    { $match: { parentCase: null, caseRole: { $nin: ["employee", "beneficiary"] }, status: { $ne: "removed" } } },
    {
      $group: {
        _id: { $ifNull: ["$user", { $toLower: { $ifNull: ["$clientEmail", "unknown"] } }] },
        clientName: { $first: "$clientName" },
        clientEmail: { $first: "$clientEmail" },
        totalCases: { $sum: 1 },
        casesInPeriod: { $sum: start ? { $cond: [{ $gte: ["$createdAt", start] }, 1, 0] } : 1 },
        openCases: { $sum: { $cond: [{ $in: ["$status", NOT_OPEN_STATUSES] }, 0, 1] } },
        closedCases: { $sum: { $cond: [{ $in: ["$status", CLOSED_STATUSES] }, 1, 0] } },
        lastCaseAt: { $max: "$createdAt" },
      },
    },
  ]);
  const userIds = rows.map((row) => row._id).filter((id) => typeof id !== "string");
  const users = userIds.length ? await User.find({ _id: { $in: userIds } }).select("name displayName email").lean() : [];
  const byId = new Map(users.map((user) => [String(user._id), user]));

  return rank(
    rows
      .filter((row) => row.casesInPeriod > 0 || !start)
      .map((row) => {
        const user = byId.get(String(row._id));
        return {
          id: String(row._id),
          name: user ? displayName(user) : row.clientName || row.clientEmail || "Unknown client",
          email: user?.email || row.clientEmail || "",
          totalCases: row.totalCases,
          casesInPeriod: row.casesInPeriod,
          openCases: row.openCases,
          closedCases: row.closedCases,
          lastCaseAt: row.lastCaseAt,
          score: row.casesInPeriod,
        };
      })
  );
}

async function getLeaderboard({ board = "case_managers", period = "this_month", limit = 50 } = {}) {
  const resolvedBoard = BOARDS.includes(board) ? board : "case_managers";
  const resolvedPeriod = PERIODS.includes(period) ? period : "this_month";
  const now = new Date();
  let rows;
  if (resolvedBoard === "case_managers") rows = await staffBoard({ role: "case_manager", field: "assignedCaseManager" }, resolvedPeriod, now);
  else if (resolvedBoard === "team_leads") rows = await staffBoard({ role: "team_lead", field: "assignedTeamLead" }, resolvedPeriod, now);
  else if (resolvedBoard === "attorneys") rows = await attorneyBoard(resolvedPeriod, now);
  else rows = await clientBoard(resolvedPeriod, now);
  return { board: resolvedBoard, period: resolvedPeriod, generatedAt: now, rows: rows.slice(0, limit) };
}

// Shape the dashboard's team-performance summary has always used.
async function topCaseManagersForDashboard(period = "this_month", limit = 10) {
  const { rows } = await getLeaderboard({ board: "case_managers", period, limit });
  return rows.map((row) => ({
    role: "case_manager",
    staff: { _id: row.id, name: row.name, displayName: row.name, email: row.email, role: "case_manager" },
    activeCases: row.openCases,
    closedCases: row.closedCases,
    metrics: { tasksCompleted: row.tasksCompleted },
    score: row.score,
  }));
}

module.exports = { getLeaderboard, topCaseManagersForDashboard, periodStart, CLOSED_STATUSES, NOT_OPEN_STATUSES, BOARDS, PERIODS };
