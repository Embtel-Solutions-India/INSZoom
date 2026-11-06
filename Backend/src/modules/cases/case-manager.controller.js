const mongoose = require("mongoose");
const { withCountable } = require("./countableCase");
const Case = require("../../models/Case");
const Payment = require("../../models/Payment");
const Task = require("../../models/Task");
const User = require("../../models/User");
const caseService = require("./case.service");
const { caseManagerMatch, teamLeadMatch, COMPLETED_STAGE_KEYS, isCompletedCase } = require("./caseManagerAccess");
const caseManagerAnalyticsService = require("./case-manager-analytics.service");
const ratingService = require("./case-manager-rating.service");
const { normalizeRole } = require("../authorization/roleHierarchy");

const CLOSED_CASE_STATUSES = ["completed", "closed", "approved"];
const ACTIVE_CASE_STATUSES = ["active", "assigned", "in_review", "under_review", "document_collection", "questionnaire", "form_preparation", "ready_to_file", "ready_for_filing", "filed", "processing", "rfe", "pending_approval"];
const ATTENTION_TASK_STATUSES = ["pending", "assigned", "in_progress", "waiting", "blocked"];

function asObject(item) {
  return typeof item?.toObject === "function" ? item.toObject() : item;
}

function monthKey(date) {
  const value = date ? new Date(date) : new Date();
  if (Number.isNaN(value.getTime())) return "";
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key) {
  const [year, month] = String(key).split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleString("en-US", { month: "short" });
}

function lastMonths(count = 6) {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (count - 1 - index), 1);
    return monthKey(date);
  });
}

function increment(map, key, amount = 1) {
  const normalized = key || "Uncategorized";
  map.set(normalized, (map.get(normalized) || 0) + amount);
}

function mapToSeries(map, keyName = "name") {
  return Array.from(map.entries())
    .map(([key, value]) => ({ [keyName]: key, count: value }))
    .sort((a, b) => b.count - a.count);
}

function money(value) {
  return Number(value || 0);
}

function objectId(value) {
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
}

// The Case Managers page lists case managers AND team leads (2026-11-06). A team lead's cases are the ones they lead (assignedTeamLead) or manage;
// a case manager's figures are computed exactly as before.
const PAGE_ROLES = ["case_manager", "team_lead"];

// Mongo case filter for one person on the page, by that person's role.
async function casesMatchFor(personId) {
  const person = await User.findById(personId).select("role").lean().catch(() => null);
  return normalizeRole(person?.role) === "team_lead" ? teamLeadMatch(personId) : caseManagerMatch(personId);
}

// One row per person: an employee case is its own row (an employer matter itself has none: countable filter), a family or single case is one row.
// The name / e-mail shown are the person's own, including an employee who has not been invited yet.
function rowIdentity(caseData) {
  const c = asObject(caseData) || {};
  const pending = c.pendingEmployee || {};
  const identity = c.employeeIdentity || {};
  const isEmployee = c.caseRole === "employee";
  return {
    listName: (isEmployee ? pending.name || identity.name : "") || c.clientName || pending.name || identity.name || "",
    listEmail: (isEmployee ? pending.email || identity.email : "") || c.clientEmail || pending.email || identity.email || "",
  };
}

const LIST_SORT_FIELDS = ["name", "activeCasesCount", "completedCasesCount", "totalRevenue", "currentWorkload", "performanceRating", "status"];
const NOT_ACTIVE_CASE_STATUSES = ["closed", "archived", "approved", "denied", "completed"];
const PENDING_CASE_STATUSES = ["pending_assignment", "assigned", "pending_approval"];

// Per-manager case, task and payment figures in three grouped queries (no N+1).
async function buildManagerMetrics() {
  const [caseRows, taskRows, paymentRows] = await Promise.all([
    Case.aggregate([
      { $match: withCountable({ $or: [{ assignedCaseManager: { $ne: null } }, { assignedTeamLead: { $ne: null } }] }) },
      // A case counts toward every case manager on it (primary + additional) and toward its team lead.
      { $project: { status: 1, done: { $in: [{ $ifNull: ["$integrations.ghl.unifiedStageKey", ""] }, COMPLETED_STAGE_KEYS] }, hold: { $regexMatch: { input: { $ifNull: ["$integrations.ghl.unifiedStageKey", ""] }, regex: "hold", options: "i" } }, managers: { $filter: { input: { $setUnion: [["$assignedCaseManager"], { $ifNull: ["$additionalCaseManagers", []] }, ["$assignedTeamLead"]] }, as: "m", cond: { $ne: ["$$m", null] } } } } },
      { $unwind: "$managers" },
      { $group: { _id: { manager: "$managers", status: "$status", done: "$done", hold: "$hold" }, count: { $sum: 1 } } },
    ]),
    Task.aggregate([
      { $match: { status: { $nin: ["completed", "cancelled"] }, assignedTo: { $ne: null } } },
      { $group: { _id: "$assignedTo", open: { $sum: 1 }, overdue: { $sum: { $cond: [{ $lt: ["$dueDate", new Date()] }, 1, 0] } } } },
    ]),
    // revenue = QB Amount Paid on the person's cases (GoHighLevel), US dollars; a case counts for every case manager on it and for its team lead
    Case.aggregate([
      { $match: withCountable({ "finance.source": { $in: ["ghl", "crm"] }, $or: [{ assignedCaseManager: { $ne: null } }, { assignedTeamLead: { $ne: null } }] }) },
      { $project: { paid: { $ifNull: ["$finance.amountPaid", 0] }, managers: { $filter: { input: { $setUnion: [["$assignedCaseManager"], { $ifNull: ["$additionalCaseManagers", []] }, ["$assignedTeamLead"]] }, as: "m", cond: { $ne: ["$$m", null] } } } } },
      { $unwind: "$managers" },
      { $group: { _id: "$managers", total: { $sum: "$paid" } } },
    ]),
  ]);
  const metrics = new Map();
  const entry = (id) => {
    const key = String(id);
    if (!metrics.has(key)) metrics.set(key, { active: 0, completed: 0, pending: 0, onHold: 0, totalCases: 0, openTasks: 0, overdueTasks: 0, revenue: 0 });
    return metrics.get(key);
  };
  caseRows.forEach(({ _id, count }) => {
    const m = entry(_id.manager);
    m.totalCases += count;
    // completed = the GoHighLevel pipeline stage is Submitted (FedEx) or later; those are no longer "active" work
    if (_id.done) m.completed += count;
    else if (_id.hold) m.onHold += count; // a case in the On Hold stage is not active work
    else if (!NOT_ACTIVE_CASE_STATUSES.includes(_id.status)) m.active += count;
    if (PENDING_CASE_STATUSES.includes(_id.status)) m.pending += count;
  });
  taskRows.forEach((row) => { const m = entry(row._id); m.openTasks = row.open; m.overdueTasks = row.overdue; });
  paymentRows.forEach((row) => { entry(row._id).revenue = money(row.total); }); // dollars
  return metrics;
}

async function getCaseManagers(req, res, next) {
  try {
    const { search = "", status = "", sortBy = "name", sortOrder = "asc" } = req.query;
    const paginate = req.query.page !== undefined || req.query.limit !== undefined;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

    const [managers, metrics, ratingSummaries] = await Promise.all([
      User.find({ role: { $in: PAGE_ROLES }, status: { $ne: "archived" } }).select("-password").lean(),
      buildManagerMetrics(),
      ratingService.currentWeekSummaries(req.user),
    ]);

    const all = managers.map((manager) => {
      const m = metrics.get(String(manager._id)) || { active: 0, completed: 0, pending: 0, onHold: 0, totalCases: 0, openTasks: 0, overdueTasks: 0, revenue: 0 };
      return {
        ...manager,
        status: manager.isActive === false ? "Inactive" : "Active",
        activeCasesCount: m.active,
        assignedClientsCount: m.active,
        completedCasesCount: m.completed,
        pendingCasesCount: m.pending,
        onHoldCasesCount: m.onHold,
        totalCasesCount: m.totalCases,
        openTasksCount: m.openTasks,
        overdueTasksCount: m.overdueTasks,
        currentWorkload: m.active + m.openTasks,
        totalRevenue: m.revenue,
        totalPayments: m.revenue,
        // completionRate = share of the manager's assigned cases that are completed (automatic, from the database). It is NOT a rating:
        // the weekly star rating below is given by admins / team leads.
        performanceRating: m.totalCases ? (m.completed / m.totalCases) * 100 : 0,
        completionRate: m.totalCases ? (m.completed / m.totalCases) * 100 : 0,
        weeklyRating: ratingSummaries.get(String(manager._id))?.average ?? null,
        weeklyRatingCount: ratingSummaries.get(String(manager._id))?.count || 0,
        myWeeklyRating: ratingSummaries.get(String(manager._id))?.mine ?? null,
      };
    });

    // the headline totals stay the case managers' own (a case counted for both its case manager and its team lead must not be added twice)
    const managersOnly = all.filter((cm) => normalizeRole(cm.role) !== "team_lead");
    const stats = {
      totalCaseManagers: managersOnly.length,
      activeCaseManagers: managersOnly.filter((cm) => cm.status === "Active").length,
      totalTeamLeads: all.length - managersOnly.length,
      totalActiveCases: managersOnly.reduce((sum, cm) => sum + cm.activeCasesCount, 0),
      totalCompletedCases: managersOnly.reduce((sum, cm) => sum + cm.completedCasesCount, 0),
      totalRevenueManaged: managersOnly.reduce((sum, cm) => sum + cm.totalRevenue, 0),
    };

    const term = String(search).trim().toLowerCase();
    let rows = all.filter((cm) => {
      if (status && cm.status.toLowerCase() !== String(status).toLowerCase()) return false;
      if (!term) return true;
      return [cm.name, cm.displayName, cm.email].some((v) => String(v || "").toLowerCase().includes(term));
    });

    const field = LIST_SORT_FIELDS.includes(sortBy) ? sortBy : "name";
    const dir = sortOrder === "desc" ? -1 : 1;
    rows.sort((a, b) => {
      const x = a[field];
      const y = b[field];
      const cmp = typeof x === "string" || typeof y === "string"
        ? String(x || "").localeCompare(String(y || ""), undefined, { sensitivity: "base" })
        : (x || 0) - (y || 0);
      return (cmp || String(a.name || "").localeCompare(String(b.name || ""))) * dir;
    });

    const totalCount = rows.length;
    if (paginate) rows = rows.slice((page - 1) * limit, page * limit);
    const pagination = { page, limit: paginate ? limit : totalCount, totalCount, totalPages: Math.max(Math.ceil(totalCount / limit), 1) };
    res.json({ success: true, count: rows.length, data: rows, caseManagers: rows, stats, pagination });
  } catch (error) {
    next(error);
  }
}

// GET /case-managers/:id/ratings and /case-managers/me/ratings: this week's rating(s) and past weeks, as far as the viewer may see them.
async function getCaseManagerRatings(req, res, next) {
  try {
    const id = req.params.id === "me" || !req.params.id ? req.user._id : req.params.id;
    res.json({ success: true, data: await ratingService.getRatings(req.user, id) });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    next(error);
  }
}

// PUT /case-managers/:id/ratings: rate (or re-rate) the case manager for the CURRENT week.
async function rateCaseManager(req, res, next) {
  try {
    await ratingService.rateCurrentWeek(req.user, req.params.id, req.body || {});
    res.json({ success: true, data: await ratingService.getRatings(req.user, req.params.id) });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    next(error);
  }
}

// The columns a case row needs (never the whole document: populating 100 whole cases used to take minutes).
const CASE_ROW_FIELDS = "caseNumber clientName clientEmail visaType petitionSubType visaCategory stage status priority caseRole pendingEmployee employeeIdentity pipelineCategory integrations.ghl.unifiedStageKey integrations.ghl.opportunityId integrations.ghl.pipelineId integrations.ghl.category createdAt updatedAt";

async function getCaseManagerDetails(req, res, next) {
  try {
    const manager = await User.findById(req.params.id).select("-password");
    if (!manager || !PAGE_ROLES.includes(normalizeRole(manager.role))) return res.status(404).json({ success: false, message: "Case manager not found" });
    const ownCases = normalizeRole(manager.role) === "team_lead" ? teamLeadMatch(manager._id) : caseManagerMatch(manager._id);
    const finance = require("../finance/caseFinance.service");
    const [recentCases, tasks, counts, money$] = await Promise.all([
      Case.find(withCountable(ownCases)).select(CASE_ROW_FIELDS).sort({ updatedAt: -1 }).limit(10).lean(),
      Task.find({ assignedTo: manager._id }).sort({ dueDate: 1 }).limit(100).lean(),
      // every figure counted in the database over ALL of the person's cases (not just the latest 100)
      Case.aggregate([
        { $match: withCountable(ownCases) },
        { $group: {
          _id: null,
          total: { $sum: 1 },
          done: { $sum: { $cond: [{ $in: [{ $ifNull: ["$integrations.ghl.unifiedStageKey", ""] }, COMPLETED_STAGE_KEYS] }, 1, 0] } },
          hold: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ["$integrations.ghl.unifiedStageKey", ""] }, regex: "hold", options: "i" } }, 1, 0] } },
          closedStatus: { $sum: { $cond: [{ $in: ["$status", CLOSED_CASE_STATUSES] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $in: ["$status", ["pending_assignment", "assigned", "pending_approval"]] }, 1, 0] } },
          doneDays: { $sum: { $cond: [{ $in: [{ $ifNull: ["$integrations.ghl.unifiedStageKey", ""] }, COMPLETED_STAGE_KEYS] }, { $max: [0, { $divide: [{ $subtract: ["$updatedAt", "$createdAt"] }, 86400000] }] }, 0] } },
        } },
      ]),
      finance.totals(finance.financeMatch({}, ownCases)),
    ]);
    const c = counts[0] || { total: 0, done: 0, hold: 0, closedStatus: 0, pending: 0, doneDays: 0 };
    const activeCases = Math.max(c.total - c.done - c.hold - Math.max(c.closedStatus - c.done, 0), 0);
    const stats = {
      totalAssignedCases: c.total,
      activeCases,
      completedCases: c.done,
      pendingCases: c.pending,
      onHoldCases: c.hold,
      totalRevenue: money$.total,
      collectedRevenue: money$.revenue,
      uscisFees: money$.uscisFees,
      outstandingRevenue: money$.outstanding,
      collectionPercentage: money$.total ? Math.round((money$.revenue / money$.total) * 100) : 0,
      avgProcessingTime: c.done ? Math.round((c.doneDays / c.done) * 10) / 10 : 0,
    };
    const cases = recentCases.map((caseData) => ({ ...caseData, ...rowIdentity(caseData) }));
    res.json({ success: true, data: { caseManager: manager, cases, tasks, stats }, caseManager: manager, cases, tasks, stats });
  } catch (error) {
    next(error);
  }
}

async function getCaseManagerCases(req, res, next) {
  try {
    const match = await casesMatchFor(req.params.id);
    const filter = caseService.buildCaseFilter({ ...req.query, page: undefined, limit: undefined }, req.user);
    filter.$and = [...(filter.$and || []), match];
    // one row per person: an employer matter itself is only a container (its employees are the rows)
    const countable = withCountable(filter);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const [total, found] = await Promise.all([
      Case.countDocuments(countable),
      Case.find(countable).select(CASE_ROW_FIELDS).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);
    const rows = found.map((caseData) => ({ ...caseData, ...rowIdentity(caseData), completed: isCompletedCase(caseData) }));
    await require("../../integrations/ghl/ghlStageNames").attachStageNames(found, rows); // rows[i].pipelineStage = the GoHighLevel stage name (display only)
    res.json({ success: true, count: rows.length, data: rows, cases: rows, pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) } });
  } catch (error) {
    next(error);
  }
}

// The person's OWN activity (what they did, with times): logins, cases created, form work, petitions, messages, assignments ... (personActivity.service.js)
async function getCaseManagerActivities(req, res, next) {
  try {
    const result = await require("./personActivity.service").buildActivities(req.params.id, { dateRange: req.query.dateRange, page: req.query.page, limit: req.query.limit });
    res.json({ success: true, count: result.activities.length, data: result.activities, activities: result.activities, pagination: result.pagination });
  } catch (error) {
    next(error);
  }
}

async function getCaseManagerPayments(req, res, next) {
  try {
    const finance = require("../finance/caseFinance.service");
    const match = await casesMatchFor(req.params.id);
    const rows = await Case.find(finance.financeMatch({}, match))
      .select("caseNumber clientName clientEmail visaType finance createdAt updatedAt").sort({ "finance.updatedAt": -1 }).limit(500).lean();
    // payment-shaped rows (what the tab reads), every amount in US dollars from the case's GoHighLevel figures
    const payments = rows.map((row) => {
      const total = Number(row.finance?.totalAmount) || 0;
      const paid = Number(row.finance?.amountPaid) || 0;
      const status = total > 0 && paid >= total ? "paid" : paid > 0 ? "partially_paid" : total > 0 ? "pending" : "no_fee";
      return {
        _id: row._id,
        caseId: { _id: row._id, caseNumber: row.caseNumber, clientName: row.clientName },
        totalFee: total, totalAmount: total, amountPaid: paid, paidAmount: paid, remainingAmount: Math.max(total - paid, 0), uscisFee: Number(row.finance?.uscisFee) || 0,
        invoiceNo: row.finance?.invoiceNo || "", status, paymentStatus: status, updatedAt: row.finance?.updatedAt || row.updatedAt, createdAt: row.createdAt,
      };
    });
    const sums = await finance.totals(finance.financeMatch({}, match));
    const summary = { totalRevenueAssigned: sums.total, totalRevenueCollected: sums.revenue, outstandingRevenue: sums.outstanding, uscisFees: sums.uscisFees, collectionRate: sums.total ? Math.round((sums.revenue / sums.total) * 100) : 0 };
    res.json({ success: true, count: payments.length, data: payments, payments, summary });
  } catch (error) {
    next(error);
  }
}

async function getCaseManagerAnalytics(req, res, next) {
  try {
    const caseFilter = await casesMatchFor(req.params.id);
    const isTeamLeadTarget = Boolean(caseFilter.$or.find((clause) => clause.assignedTeamLead));
    const [caseRows, tasks, payments] = await Promise.all([
      Case.find(caseFilter).select("caseNumber clientName status stage priority visaType visaCategory category createdAt updatedAt dueDate keyDates integrations.ghl.unifiedStageKey").lean(),
      Task.find({ assignedTo: req.params.id }).select("status priority category dueDate createdAt updatedAt completedAt").lean(),
      // one payment-like row per case with GoHighLevel figures (US dollars): paid = QB Amount Paid, total = Value
      Case.aggregate([
        { $match: withCountable({ $and: [caseFilter, { "finance.source": { $in: ["ghl", "crm"] } }] }) },
        { $project: {
          totalAmount: { $ifNull: ["$finance.totalAmount", 0] },
          amountPaid: { $ifNull: ["$finance.amountPaid", 0] },
          remainingAmount: { $max: [{ $subtract: [{ $ifNull: ["$finance.totalAmount", 0] }, { $ifNull: ["$finance.amountPaid", 0] }] }, 0] },
          paymentStatus: { $switch: { branches: [{ case: { $and: [{ $gt: [{ $ifNull: ["$finance.totalAmount", 0] }, 0] }, { $gte: [{ $ifNull: ["$finance.amountPaid", 0] }, "$finance.totalAmount"] }] }, then: "paid" }, { case: { $gt: [{ $ifNull: ["$finance.amountPaid", 0] }, 0] }, then: "partially_paid" }], default: "pending" } },
          paymentDate: "$finance.lastPaymentAt", updatedAt: 1, createdAt: 1,
        } },
      ]),
    ]);

    const months = lastMonths(6);
    const monthly = months.map((key) => ({ key, month: monthLabel(key), active: 0, attention: 0, closed: 0, payments: 0, activity: 0 }));
    const monthIndex = new Map(monthly.map((item, index) => [item.key, index]));

    const activeCases = caseRows.filter((item) => ACTIVE_CASE_STATUSES.includes(item.status) && !CLOSED_CASE_STATUSES.includes(item.status) && !isCompletedCase(item));
    const closedCases = caseRows.filter((item) => isCompletedCase(item));
    const activeByStage = new Map();
    const activeByPriority = new Map();
    const casesByStatus = new Map();
    const casesByStage = new Map();
    const categoryMap = new Map();
    const visaMap = new Map();
    const attentionMap = new Map();
    const now = new Date();

    caseRows.forEach((item) => {
      increment(casesByStatus, item.status || "active");
      increment(casesByStage, item.stage || item.status || "intake");
      increment(categoryMap, item.category || item.visaCategory || item.visaType || "General");
      increment(visaMap, item.visaType || item.visaCategory || "Unspecified");
      if (activeCases.includes(item)) {
        increment(activeByStage, item.stage || "intake");
        increment(activeByPriority, item.priority || "medium");
        const index = monthIndex.get(monthKey(item.updatedAt || item.createdAt));
        if (index !== undefined) monthly[index].active += 1;
      }
      if (closedCases.includes(item)) {
        const index = monthIndex.get(monthKey(item.updatedAt || item.createdAt));
        if (index !== undefined) monthly[index].closed += 1;
      }
      const dueDates = [
        item.dueDate,
        ...(item.keyDates || []).map((date) => date?.date).filter(Boolean),
      ].filter(Boolean);
      if (["urgent", "high"].includes(item.priority)) increment(attentionMap, "High priority cases");
      if (dueDates.some((date) => new Date(date) < now) && !isCompletedCase(item) && !CLOSED_CASE_STATUSES.includes(item.status)) increment(attentionMap, "Overdue case dates");
    });

    tasks.forEach((task) => {
      if (ATTENTION_TASK_STATUSES.includes(task.status) && task.dueDate && new Date(task.dueDate) < now) increment(attentionMap, "Overdue tasks");
      if (task.status === "blocked") increment(attentionMap, "Blocked tasks");
      const index = monthIndex.get(monthKey(task.updatedAt || task.createdAt));
      if (index !== undefined) monthly[index].activity += 1;
    });

    const paymentStatusMap = new Map();
    let totalAssigned = 0;
    let totalCollected = 0;
    let outstanding = 0;
    payments.forEach((payment) => {
      const total = money(payment.totalAmount || payment.totalFee);
      const paid = money(payment.amountPaid || payment.paidAmount);
      const remaining = money(payment.remainingAmount || Math.max(total - paid, 0));
      totalAssigned += total;
      totalCollected += paid;
      outstanding += remaining;
      increment(paymentStatusMap, payment.paymentStatus || payment.status || "not_started");
      const index = monthIndex.get(monthKey(payment.paymentDate || payment.updatedAt || payment.createdAt));
      if (index !== undefined) monthly[index].payments += paid; // dollars
      if (["overdue", "failed"].includes(payment.paymentStatus || payment.status)) increment(attentionMap, "Payment attention");
    });

    caseRows.forEach((item) => {
      [...(item.timeline || []), ...(item.activityLog || [])].forEach((activity) => {
        const index = monthIndex.get(monthKey(activity.createdAt || activity.timestamp || activity.updatedAt));
        if (index !== undefined) monthly[index].activity += 1;
      });
    });

    const attentionItems = mapToSeries(attentionMap, "reason");
    const attentionTotal = attentionItems.reduce((sum, item) => sum + item.count, 0);
    const analytics = {
      summary: {
        active: activeCases.length,
        attention: attentionTotal,
        closed: closedCases.length,
        payments: totalCollected,
        activity: monthly.reduce((sum, item) => sum + item.activity, 0),
        categories: categoryMap.size,
      },
      trend: monthly.map(({ key, ...item }) => item),
      active: {
        total: activeCases.length,
        byStage: mapToSeries(activeByStage, "stage"),
        byPriority: mapToSeries(activeByPriority, "priority"),
      },
      attention: {
        total: attentionTotal,
        byReason: attentionItems,
      },
      closed: {
        total: closedCases.length,
        completionRate: caseRows.length ? Math.round((closedCases.length / caseRows.length) * 100) : 0,
      },
      payments: {
        totalAssigned,
        totalCollected,
        outstanding,
        collectionRate: totalAssigned ? Math.round((totalCollected / totalAssigned) * 100) : 0,
        byStatus: mapToSeries(paymentStatusMap, "status"),
      },
      activityStatus: {
        total: tasks.length,
        byStatus: mapToSeries(tasks.reduce((map, task) => {
          increment(map, task.status || "pending");
          return map;
        }, new Map()), "status"),
      },
      category: {
        byVisaType: mapToSeries(visaMap, "category"),
        byCategory: mapToSeries(categoryMap, "category"),
      },
      totalCases: caseRows.length,
      completedCases: closedCases.length,
      casesByStatus: mapToSeries(casesByStatus, "status"),
      casesByStage: mapToSeries(casesByStage, "stage"),
    };
    res.json({ success: true, data: analytics, analytics });
  } catch (error) {
    next(error);
  }
}

async function getCaseManagerAnalyticsPanel(req, res, next) {
  try {
    const role = normalizeRole(req.user.role);
    const requestedId = req.query.caseManagerId;
    const period = ["30d", "90d", "1y"].includes(req.query.period) ? req.query.period : "30d";
    const staleDays = Number(req.query.staleDays) > 0 ? Number(req.query.staleDays) : caseManagerAnalyticsService.DEFAULT_STALE_DAYS;
    const options = { period, staleDays };

    if (role === "case_manager") {
      if (requestedId && String(requestedId) !== String(req.user._id)) {
        return res.status(403).json({ success: false, message: "Not authorized to view another case manager's analytics" });
      }
      const panel = await caseManagerAnalyticsService.buildPanel(req.user._id, options);
      return res.json({ success: true, scope: { caseManagerId: String(req.user._id), period, staleDays }, ...panel });
    }

    const isTeamLead = role === "team_lead";
    const teamFilter = isTeamLead ? { $or: [{ assignedTeamLead: req.user._id }, ...(req.user.teamId ? [{ teamId: req.user.teamId }] : [])] } : {};

    if (requestedId) {
      const target = await User.findById(requestedId).select("role teamId").lean().catch(() => null);
      const targetIsTeamLead = normalizeRole(target?.role) === "team_lead";
      if (isTeamLead) {
        // a team lead sees their own team's case managers and themselves (never another team lead)
        const ownTeam = req.user.teamId && target && normalizeRole(target.role) === "case_manager" && String(target.teamId) === String(req.user.teamId);
        if (!ownTeam && String(requestedId) !== String(req.user._id)) return res.status(403).json({ success: false, message: "Not authorized to view this case manager's analytics" });
      }
      const panel = await caseManagerAnalyticsService.buildPanel(requestedId, { ...options, asTeamLead: targetIsTeamLead });
      return res.json({ success: true, scope: { caseManagerId: String(requestedId), period, staleDays }, ...panel });
    }

    // Aggregate mode (no caseManagerId): admin/super_admin see every case manager,
    // team_lead is scoped to their own team - mirrors getTeamLeadDashboard's teamFilter.
    const managers = await User.find({ role: "case_manager", ...teamFilter }).select("name displayName email");
    // admins / super admins also see the team leads (each by the cases they lead); a team lead's own team view stays the case managers
    const leads = isTeamLead ? [] : await User.find({ role: "team_lead", status: { $ne: "archived" } }).select("name displayName email");
    const perCaseManager = await Promise.all([...managers.map((m) => ({ m, asTeamLead: false })), ...leads.map((m) => ({ m, asTeamLead: true }))].map(async ({ m: manager, asTeamLead }) => ({
      caseManagerId: String(manager._id),
      caseManagerName: manager.name || manager.displayName || manager.email,
      role: asTeamLead ? "team_lead" : "case_manager",
      ...(await caseManagerAnalyticsService.buildPanel(manager._id, { ...options, asTeamLead })),
    })));

    res.json({ success: true, scope: { caseManagerId: null, period, staleDays, aggregate: true }, perCaseManager });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getCaseManagerActivities,
  getCaseManagerAnalytics,
  getCaseManagerAnalyticsPanel,
  getCaseManagerCases,
  getCaseManagerRatings,
  rateCaseManager,
  getCaseManagerDetails,
  getCaseManagerPayments,
  getCaseManagers,
};
