const mongoose = require("mongoose");
const Case = require("../../models/Case");
const Payment = require("../../models/Payment");
const Task = require("../../models/Task");
const User = require("../../models/User");
const caseService = require("./case.service");
const caseManagerAnalyticsService = require("./case-manager-analytics.service");
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

async function getCaseManagers(req, res, next) {
  try {
    const caseManagers = await User.find({ role: "case_manager", status: { $ne: "archived" } }).select("-password").sort({ name: 1 });
    const data = await Promise.all(caseManagers.map(async (manager) => {
      const caseFilter = { assignedCaseManager: manager._id };
      const [activeCasesCount, completedCasesCount, overdueTasksCount, totalPayments] = await Promise.all([
        Case.countDocuments({ ...caseFilter, status: { $nin: ["closed", "archived", "approved", "denied"] } }),
        Case.countDocuments({ ...caseFilter, status: { $in: ["completed", "closed", "approved"] } }),
        Task.countDocuments({ assignedTo: manager._id, status: { $nin: ["completed", "cancelled"] }, dueDate: { $lt: new Date() } }),
        Payment.aggregate([
          { $match: { paymentStatus: "paid" } },
          { $lookup: { from: "cases", localField: "caseId", foreignField: "_id", as: "caseData" } },
          { $unwind: "$caseData" },
          { $match: { "caseData.assignedCaseManager": manager._id } },
          { $group: { _id: null, total: { $sum: "$amountPaid" } } },
        ]),
      ]);
      return {
        ...manager.toObject(),
        activeCasesCount,
        assignedClientsCount: activeCasesCount,
        completedCasesCount,
        overdueTasksCount,
        totalPayments: totalPayments[0]?.total || 0,
      };
    }));
    res.json({ success: true, count: data.length, data, caseManagers: data });
  } catch (error) {
    next(error);
  }
}

async function getCaseManagerDetails(req, res, next) {
  try {
    const manager = await User.findById(req.params.id).select("-password");
    if (!manager || manager.role !== "case_manager") return res.status(404).json({ success: false, message: "Case manager not found" });
    const cases = await caseService.populateCaseQuery(Case.find({ assignedCaseManager: manager._id }).sort({ updatedAt: -1 }).limit(100));
    const tasks = await Task.find({ assignedTo: manager._id }).sort({ dueDate: 1 }).limit(100);
    const caseIds = cases.map((caseData) => caseData._id);
    const payments = await Payment.find({ $or: [{ caseId: { $in: caseIds } }, { case: { $in: caseIds } }] }).select("totalFee totalAmount amountPaid paidAmount remainingAmount").lean();
    const activeCases = cases.filter((caseData) => !CLOSED_CASE_STATUSES.includes(caseData.status)).length;
    const completedCases = cases.filter((caseData) => CLOSED_CASE_STATUSES.includes(caseData.status)).length;
    const totalRevenue = payments.reduce((sum, payment) => sum + money(payment.totalAmount || payment.totalFee), 0);
    const collectedRevenue = payments.reduce((sum, payment) => sum + money(payment.amountPaid || payment.paidAmount), 0);
    const stats = {
      totalAssignedCases: cases.length,
      activeCases,
      completedCases,
      pendingCases: cases.filter((caseData) => ["pending_assignment", "assigned", "pending_approval"].includes(caseData.status)).length,
      totalRevenue: totalRevenue / 100,
      collectedRevenue: collectedRevenue / 100,
      collectionPercentage: totalRevenue ? Math.round((collectedRevenue / totalRevenue) * 100) : 0,
      avgProcessingTime: 0,
    };
    res.json({ success: true, data: { caseManager: manager, cases, tasks, stats }, caseManager: manager, cases, tasks, stats });
  } catch (error) {
    next(error);
  }
}

async function getCaseManagerCases(req, res, next) {
  try {
    const filter = caseService.buildCaseFilter({ ...req.query, assignedCaseManager: req.params.id }, req.user);
    const cases = await caseService.populateCaseQuery(Case.find(filter).sort({ updatedAt: -1 }).limit(Math.min(Number(req.query.limit || 100), 200)));
    res.json({ success: true, count: cases.length, data: cases, cases });
  } catch (error) {
    next(error);
  }
}

async function getCaseManagerActivities(req, res, next) {
  try {
    const cases = await Case.find({ assignedCaseManager: req.params.id }).select("caseNumber clientName timeline activityLog updatedAt").sort({ updatedAt: -1 }).limit(50);
    const activities = cases.flatMap((caseData) => [
      ...(caseData.timeline || []).map((item) => ({ ...asObject(item), caseNumber: caseData.caseNumber, clientName: caseData.clientName })),
      ...(caseData.activityLog || []).map((item) => ({ ...asObject(item), caseNumber: caseData.caseNumber, clientName: caseData.clientName })),
    ]).sort((a, b) => new Date(b.createdAt || b.timestamp || b.updatedAt) - new Date(a.createdAt || a.timestamp || a.updatedAt)).slice(0, 100);
    res.json({ success: true, count: activities.length, data: activities, activities });
  } catch (error) {
    next(error);
  }
}

async function getCaseManagerPayments(req, res, next) {
  try {
    const cases = await Case.find({ assignedCaseManager: req.params.id }).select("_id");
    const caseIds = cases.map((caseData) => caseData._id);
    const payments = await Payment.find({ $or: [{ caseId: { $in: caseIds } }, { case: { $in: caseIds } }] }).sort({ updatedAt: -1 });
    res.json({ success: true, count: payments.length, data: payments, payments });
  } catch (error) {
    next(error);
  }
}

async function getCaseManagerAnalytics(req, res, next) {
  try {
    const caseFilter = { assignedCaseManager: req.params.id };
    const [caseRows, tasks, payments] = await Promise.all([
      Case.find(caseFilter).select("caseNumber clientName status stage priority visaType visaCategory category createdAt updatedAt dueDate keyDates").lean(),
      Task.find({ assignedTo: req.params.id }).select("status priority category dueDate createdAt updatedAt completedAt").lean(),
      Payment.aggregate([
        { $lookup: { from: "cases", localField: "caseId", foreignField: "_id", as: "caseData" } },
        { $lookup: { from: "cases", localField: "case", foreignField: "_id", as: "legacyCaseData" } },
        { $addFields: { resolvedCase: { $ifNull: [{ $arrayElemAt: ["$caseData", 0] }, { $arrayElemAt: ["$legacyCaseData", 0] }] } } },
        { $match: { "resolvedCase.assignedCaseManager": objectId(req.params.id) } },
        { $project: { totalFee: 1, totalAmount: 1, amountPaid: 1, paidAmount: 1, remainingAmount: 1, paymentStatus: 1, status: 1, paymentDate: 1, updatedAt: 1, createdAt: 1 } },
      ]),
    ]);

    const months = lastMonths(6);
    const monthly = months.map((key) => ({ key, month: monthLabel(key), active: 0, attention: 0, closed: 0, payments: 0, activity: 0 }));
    const monthIndex = new Map(monthly.map((item, index) => [item.key, index]));

    const activeCases = caseRows.filter((item) => ACTIVE_CASE_STATUSES.includes(item.status) && !CLOSED_CASE_STATUSES.includes(item.status));
    const closedCases = caseRows.filter((item) => CLOSED_CASE_STATUSES.includes(item.status));
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
      if (dueDates.some((date) => new Date(date) < now) && !CLOSED_CASE_STATUSES.includes(item.status)) increment(attentionMap, "Overdue case dates");
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
      if (index !== undefined) monthly[index].payments += paid / 100;
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
    const period = ["90d", "ytd", "all"].includes(req.query.period) ? req.query.period : "90d";
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
      if (isTeamLead) {
        const target = req.user.teamId && await User.findOne({ _id: requestedId, role: "case_manager", teamId: req.user.teamId });
        if (!target) return res.status(403).json({ success: false, message: "Not authorized to view this case manager's analytics" });
      }
      const panel = await caseManagerAnalyticsService.buildPanel(requestedId, options);
      return res.json({ success: true, scope: { caseManagerId: String(requestedId), period, staleDays }, ...panel });
    }

    // Aggregate mode (no caseManagerId): admin/super_admin see every case manager,
    // team_lead is scoped to their own team - mirrors getTeamLeadDashboard's teamFilter.
    const managers = await User.find({ role: "case_manager", ...teamFilter }).select("name displayName email");
    const perCaseManager = await Promise.all(managers.map(async (manager) => ({
      caseManagerId: String(manager._id),
      caseManagerName: manager.name || manager.displayName || manager.email,
      ...(await caseManagerAnalyticsService.buildPanel(manager._id, options)),
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
  getCaseManagerDetails,
  getCaseManagerPayments,
  getCaseManagers,
};
