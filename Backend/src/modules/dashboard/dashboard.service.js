const os = require("os");
const Answer = require("../../models/Answer");
const Appointment = require("../../models/Appointment");
const AuditLog = require("../../models/AuditLog");
const Beneficiary = require("../../models/Beneficiary");
const Case = require("../../models/Case");
const Client = require("../../models/Client");
const Company = require("../../models/Company");
const Conversation = require("../../models/Conversation");
const Dashboard = require("../../models/Dashboard");
const Document = require("../../models/Document");
const Message = require("../../models/Message");
const Notification = require("../../models/Notification");
const Payment = require("../../models/Payment");
const ScheduledReport = require("../../models/ScheduledReport");
const StaffPerformance = require("../../models/StaffPerformance");
const Task = require("../../models/Task");
const User = require("../../models/User");
const Workflow = require("../../models/Workflow");
const CaseForm = require("../../models/CaseForm");
const { normalizeRole } = require("../authorization/roleHierarchy");

function roleOf(user) {
  return normalizeRole(user?.role);
}

function dateRange(query = {}) {
  const filter = {};
  const from = query.from || query.startDate;
  const to = query.to || query.endDate;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }
  return filter;
}

function mapGroups(rows) {
  return rows.map((item) => ({ key: item._id || "unknown", count: item.count || 0, value: item.value || item.amount || 0 }));
}

async function groupCount(Model, field, match = {}) {
  return mapGroups(await Model.aggregate([{ $match: match }, { $group: { _id: `$${field}`, count: { $sum: 1 } } }, { $sort: { count: -1 } }]));
}

async function monthlyTrend(Model, valueField, match = {}) {
  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
        count: { $sum: 1 },
        value: valueField ? { $sum: `$${valueField}` } : { $sum: 1 },
      },
    },
    { $sort: { "_id.year": 1, "_id.month": 1 } },
  ];
  return (await Model.aggregate(pipeline)).map((item) => ({
    month: `${item._id.year}-${String(item._id.month).padStart(2, "0")}`,
    count: item.count,
    value: item.value,
  }));
}

function scopedCaseFilter(user) {
  const role = roleOf(user);
  if (["super_admin", "admin", "finance"].includes(role)) return {};
  if (role === "case_manager") return { assignedCaseManager: user._id };
  if (role === "employer") return { companyId: user.companyId };
  if (role === "client" || role === "user") return { user: user._id };
  return {};
}

async function paymentTotals(match = {}) {
  const result = await Payment.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        revenue: { $sum: { $cond: [{ $gt: ["$amountPaid", 0] }, "$amountPaid", { $ifNull: ["$paidAmount", 0] }] } },
        outstanding: { $sum: "$remainingAmount" },
        refunded: { $sum: "$refundedAmount" },
        count: { $sum: 1 },
      },
    },
  ]);
  return result[0] || { revenue: 0, outstanding: 0, refunded: 0, count: 0 };
}

async function executiveMetrics(query = {}) {
  const range = dateRange(query);
  const [users, clients, companies, beneficiaries, cases, payments, documents, securityAlerts, userGrowth] = await Promise.all([
    User.countDocuments(range),
    Client.countDocuments(range),
    Company.countDocuments(range),
    Beneficiary.countDocuments(range),
    Case.countDocuments(range),
    paymentTotals(range),
    Document.aggregate([{ $match: range }, { $group: { _id: null, count: { $sum: 1 }, storageBytes: { $sum: { $ifNull: ["$size", "$fileSize"] } } } }]),
    Notification.countDocuments({ category: { $in: ["security", "system"] }, isRead: false }),
    monthlyTrend(User, null, range),
  ]);
  const documentStats = documents[0] || { count: 0, storageBytes: 0 };
  return {
    totalUsers: users,
    totalClients: clients,
    totalCompanies: companies,
    totalBeneficiaries: beneficiaries,
    totalCases: cases,
    revenue: payments.revenue,
    outstandingInvoices: payments.outstanding,
    storageUsageBytes: documentStats.storageBytes,
    documentCount: documentStats.count,
    securityAlerts,
    userGrowth,
    systemHealth: {
      status: "ok",
      uptimeSeconds: process.uptime(),
      memory: process.memoryUsage(),
      cpuLoad: os.loadavg(),
      generatedAt: new Date(),
    },
  };
}

async function caseAnalytics(query = {}, user) {
  const match = { ...dateRange(query), ...scopedCaseFilter(user) };
  const [total, active, closed, byStage, byVisaType, byStatus, priority, rfeTrends, processingTimes] = await Promise.all([
    Case.countDocuments(match),
    Case.countDocuments({ ...match, status: "active" }),
    Case.countDocuments({ ...match, status: { $in: ["closed", "approved"] } }),
    groupCount(Case, "stage", match),
    groupCount(Case, "visaType", match),
    groupCount(Case, "status", match),
    groupCount(Case, "priority", match),
    Case.aggregate([{ $match: { ...match, uscisDecision: "rfe" } }, { $group: { _id: "$visaType", rfeCount: { $sum: 1 } } }]),
    Case.aggregate([
      { $match: { ...match, filingDate: { $exists: true }, uscisDecisionDate: { $exists: true } } },
      { $project: { visaType: 1, processingDays: { $divide: [{ $subtract: ["$uscisDecisionDate", "$filingDate"] }, 86400000] } } },
      { $group: { _id: "$visaType", avgProcessingDays: { $avg: "$processingDays" }, minProcessingDays: { $min: "$processingDays" }, maxProcessingDays: { $max: "$processingDays" }, count: { $sum: 1 } } },
    ]),
  ]);
  return { total, active, closed, byStage, byVisaType, byStatus, priority, rfeTrends, processingTimes };
}

async function revenueAnalytics(query = {}) {
  const match = dateRange(query);
  const [totals, byPackage, monthlyRevenue, byStatus] = await Promise.all([
    paymentTotals(match),
    Payment.aggregate([{ $match: match }, { $group: { _id: "$package", revenue: { $sum: { $cond: [{ $gt: ["$amountPaid", 0] }, "$amountPaid", { $ifNull: ["$paidAmount", 0] }] } }, outstanding: { $sum: "$remainingAmount" }, count: { $sum: 1 } } }]),
    Payment.aggregate([
      { $match: match },
      { $group: { _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } }, count: { $sum: 1 }, value: { $sum: { $cond: [{ $gt: ["$amountPaid", 0] }, "$amountPaid", { $ifNull: ["$paidAmount", 0] }] } } } },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
      { $project: { _id: 0, month: { $concat: [{ $toString: "$_id.year" }, "-", { $cond: [{ $lt: ["$_id.month", 10] }, { $concat: ["0", { $toString: "$_id.month" }] }, { $toString: "$_id.month" }] }] }, count: 1, value: 1 } },
    ]),
    groupCount(Payment, "paymentStatus", match),
  ]);
  return { totals, byPackage, monthlyRevenue, byStatus };
}

async function documentAnalytics(query = {}, user) {
  const match = dateRange(query);
  if (roleOf(user) === "client") match.user = user._id;
  const [total, byStatus, byCategory, missingDocuments, ocrStats, storage] = await Promise.all([
    Document.countDocuments(match),
    groupCount(Document, "reviewStatus", match),
    groupCount(Document, "category", match),
    Document.countDocuments({ ...match, requestStatus: { $in: ["missing", "requested", "overdue"] } }),
    groupCount(Document, "ocr.status", match),
    Document.aggregate([{ $match: match }, { $group: { _id: null, storageBytes: { $sum: { $ifNull: ["$size", "$fileSize"] } } } }]),
  ]);
  return { total, byStatus, byCategory, missingDocuments, ocrStats, storageBytes: storage[0]?.storageBytes || 0 };
}

async function workflowAnalytics(query = {}, user) {
  const match = dateRange(query);
  const role = roleOf(user);
  if (role === "case_manager") match.assignedTo = user._id;
  const [total, byStatus, byStage, overdue, slaBreaches] = await Promise.all([
    Workflow.countDocuments(match),
    groupCount(Workflow, "status", match),
    groupCount(Workflow, "currentStage", match),
    Workflow.countDocuments({ ...match, dueAt: { $lt: new Date() }, status: { $nin: ["completed", "cancelled"] } }),
    Workflow.countDocuments({ ...match, slaBreachedAt: { $exists: true } }),
  ]);
  return { total, byStatus, byStage, overdue, slaBreaches };
}

async function questionnaireAnalytics(query = {}, user) {
  const match = dateRange(query);
  if (roleOf(user) === "client") match.user = user._id;
  const [responsesByStatus, averageCompletion, overdue] = await Promise.all([
    groupCount(Answer, "status", match),
    Answer.aggregate([{ $match: match }, { $group: { _id: null, average: { $avg: "$completion.percent" }, responses: { $sum: 1 } } }]),
    Answer.countDocuments({ ...match, dueDate: { $lt: new Date() }, status: { $nin: ["submitted", "approved"] } }),
  ]);
  return { responsesByStatus, averageCompletion: averageCompletion[0] || { average: 0, responses: 0 }, overdue };
}

async function messagingAnalytics(query = {}, user) {
  const match = dateRange(query);
  if (roleOf(user) === "client") match["participants.user"] = user._id;
  const [conversations, messages, byStatus, unread, averageResponse] = await Promise.all([
    Conversation.countDocuments(match),
    Message.countDocuments(dateRange(query)),
    groupCount(Conversation, "status", match),
    Conversation.aggregate([{ $match: match }, { $group: { _id: null, unread: { $sum: { $add: ["$unreadClient", "$unreadManager"] } } } }]),
    Conversation.aggregate([{ $match: { ...match, "analytics.firstResponseSeconds": { $exists: true } } }, { $group: { _id: null, averageFirstResponseSeconds: { $avg: "$analytics.firstResponseSeconds" } } }]),
  ]);
  return { conversations, messages, byStatus, unread: unread[0]?.unread || 0, averageFirstResponseSeconds: averageResponse[0]?.averageFirstResponseSeconds || 0 };
}

async function appointmentAnalytics(query = {}, user) {
  const match = dateRange(query);
  const role = roleOf(user);
  if (role === "client") match.$or = [{ linkedUser: user._id }, { clientId: user._id }];
  if (role === "case_manager") match.$or = [{ caseManagerId: user._id }, { assignedTo: user._id }];
  const [total, upcoming, byStatus, byType] = await Promise.all([
    Appointment.countDocuments(match),
    Appointment.countDocuments({ ...match, startAt: { $gte: new Date() }, status: { $nin: ["cancelled", "completed", "no_show"] } }),
    groupCount(Appointment, "status", match),
    groupCount(Appointment, "type", match),
  ]);
  return { total, upcoming, byStatus, byType };
}

async function userAnalytics(query = {}) {
  const match = dateRange(query);
  const [total, byRole, growth, activeSessions, lockedAccounts] = await Promise.all([
    User.countDocuments(match),
    groupCount(User, "role", match),
    monthlyTrend(User, null, match),
    User.countDocuments({ lastLoginAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }),
    User.countDocuments({ $or: [{ isLocked: true }, { accountLocked: true }] }),
  ]);
  return { total, byRole, growth, activeSessions, lockedAccounts };
}

function buildInsights({ cases, revenue, documents, workflows, questionnaires, messages, appointments }) {
  const insights = [];
  if (documents.missingDocuments > 0) insights.push({ type: "risk", title: "Missing documents are blocking progress", value: documents.missingDocuments });
  if (workflows.slaBreaches > 0) insights.push({ type: "warning", title: "Workflow SLA breaches detected", value: workflows.slaBreaches });
  if (revenue.totals?.outstanding > 0) insights.push({ type: "finance", title: "Outstanding invoices require follow-up", value: revenue.totals.outstanding });
  if (questionnaires.overdue > 0) insights.push({ type: "action", title: "Overdue questionnaires need reminders", value: questionnaires.overdue });
  if (appointments.upcoming > 0) insights.push({ type: "schedule", title: "Upcoming appointments scheduled", value: appointments.upcoming });
  if (messages.unread > 0) insights.push({ type: "communication", title: "Unread conversation load", value: messages.unread });
  if (!insights.length && cases.active > 0) insights.push({ type: "positive", title: "Case pipeline is active with no critical dashboard alerts", value: cases.active });
  return insights;
}

async function buildAnalytics(query, user) {
  const [cases, revenue, users, documents, workflows, questionnaires, messages, appointments] = await Promise.all([
    caseAnalytics(query, user),
    revenueAnalytics(query),
    userAnalytics(query),
    documentAnalytics(query, user),
    workflowAnalytics(query, user),
    questionnaireAnalytics(query, user),
    messagingAnalytics(query, user),
    appointmentAnalytics(query, user),
  ]);
  return { cases, revenue, users, documents, workflows, questionnaires, messages, appointments };
}

async function roleDashboard(user, query = {}) {
  const role = roleOf(user);
  const analytics = await buildAnalytics(query, user);
  const executive = ["super_admin", "admin"].includes(role) ? await executiveMetrics(query) : null;
  const teamPerformance = ["super_admin", "admin", "team_lead"].includes(role)
    ? await StaffPerformance.find({ period: query.period || "this_month" }).populate("staff", "name displayName email role").sort({ score: -1 }).limit(10).lean()
    : [];
  const assignedCaseFilter = scopedCaseFilter(user);
  const recentMessages = await Conversation.find(role === "client" ? { "participants.user": user._id } : {}).sort({ lastMessageAt: -1 }).limit(5).lean();
  const upcomingDeadlines = await Case.find({ ...assignedCaseFilter, $or: [{ filingDeadline: { $gte: new Date() } }, { rfeDeadline: { $gte: new Date() } }, { visaExpirationDate: { $gte: new Date() } }] }).sort({ filingDeadline: 1, rfeDeadline: 1, visaExpirationDate: 1 }).limit(10).lean();
  return {
    success: true,
    role,
    generatedAt: new Date(),
    refreshSeconds: 60,
    kpis: {
      ...(executive || {}),
      assignedCases: analytics.cases.total,
      activeCases: analytics.cases.active,
      missingDocuments: analytics.documents.missingDocuments,
      pendingQuestionnaires: analytics.questionnaires.responsesByStatus.find((item) => ["draft", "auto_saved"].includes(item.key))?.count || 0,
      upcomingAppointments: analytics.appointments.upcoming,
      unreadMessages: analytics.messages.unread,
      revenue: analytics.revenue.totals.revenue,
      outstandingInvoices: analytics.revenue.totals.outstanding,
      workflowSlaBreaches: analytics.workflows.slaBreaches,
    },
    widgets: buildDefaultWidgets(role, analytics, executive),
    analytics,
    teamPerformance,
    recentMessages,
    upcomingDeadlines,
    insights: buildInsights(analytics),
    predictive: {
      caseBacklogRisk: analytics.workflows.overdue + analytics.documents.missingDocuments + analytics.questionnaires.overdue,
      revenueCollectionRisk: analytics.revenue.totals.outstanding,
      communicationLoad: analytics.messages.unread,
    },
  };
}

async function collaborationSummary(user, query = {}) {
  const caseFilter = buildScopedCaseFilter(user, query);
  const caseIds = await Case.find(caseFilter).distinct("_id");
  const now = new Date();
  const deadlineThreshold = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const [activeCases, byStatus, pendingRequests, openTasks, overdueTasks, pendingReviews, readyForms, highRiskCases] = await Promise.all([
    Case.countDocuments({ _id: { $in: caseIds }, status: { $nin: ["closed", "archived", "denied"] } }),
    Case.aggregate([{ $match: { _id: { $in: caseIds } } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    Case.countDocuments({
      _id: { $in: caseIds },
      $or: [
        { "documentChecklist.status": { $in: ["requested", "missing", "overdue"] } },
        { "checklistItems.status": { $in: ["requested", "missing", "overdue"] } },
      ],
    }),
    Task.countDocuments({ caseId: { $in: caseIds }, status: { $nin: ["completed", "cancelled"] } }),
    Task.countDocuments({ caseId: { $in: caseIds }, status: { $nin: ["completed", "cancelled"] }, dueDate: { $lt: now } }),
    Document.countDocuments({ caseId: { $in: caseIds }, reviewStatus: { $in: ["pending", "under_review", "needs_revision"] }, deletedAt: { $exists: false } }),
    CaseForm.countDocuments({ caseId: { $in: caseIds }, status: { $in: ["approved", "generated", "locked"] } }),
    Case.countDocuments({
      _id: { $in: caseIds },
      $or: [
        { priority: "urgent" },
        { filingDeadline: { $lte: deadlineThreshold } },
        { rfeDeadline: { $lte: deadlineThreshold } },
      ],
    }),
  ]);
  return { activeCases, casesByStatus: byStatus, pendingRequests, openTasks, overdueTasks, pendingReviews, readyForms, highRiskCases, caseIds };
}

function buildScopedCaseFilter(user, query = {}) {
  const filter = { ...dateRange(query), ...scopedCaseFilter(user) };
  if (query.status) filter.status = query.status;
  if (query.visaType) filter.visaType = query.visaType;
  if (query.priority) filter.priority = query.priority;
  return filter;
}

async function clientDashboard(user, query = {}) {
  const summary = await collaborationSummary(user, query);
  const [upcomingDeadlines, cases] = await Promise.all([
    Case.find({
      _id: { $in: summary.caseIds },
      $or: [{ filingDeadline: { $gte: new Date() } }, { rfeDeadline: { $gte: new Date() } }],
    }).select("caseNumber filingDeadline rfeDeadline stage status").sort({ filingDeadline: 1, rfeDeadline: 1 }).limit(10).lean(),
    Case.find({ _id: { $in: summary.caseIds } })
      .select("caseNumber visaType stage status journeyProgress filingReadinessScore assignedCaseManager questionnaireData")
      .sort({ updatedAt: -1 })
      .limit(10)
      .lean(),
  ]);
  return { ...summary, upcomingDeadlines, cases };
}

async function employerDashboard(user, query = {}) {
  const summary = await collaborationSummary(user, query);
  const visaCategories = await Case.aggregate([
    { $match: { _id: { $in: summary.caseIds } } },
    { $group: { _id: "$visaType", count: { $sum: 1 } } },
  ]);
  return { ...summary, visaCategories };
}

function buildDefaultWidgets(role, analytics, executive) {
  const widgets = [
    { key: "case-status", title: "Case Status Distribution", type: "chart", data: analytics.cases.byStatus },
    { key: "workflow-progress", title: "Workflow Metrics", type: "chart", data: analytics.workflows.byStatus },
    { key: "documents", title: "Document Analytics", type: "chart", data: analytics.documents.byStatus },
    { key: "appointments", title: "Appointment Metrics", type: "chart", data: analytics.appointments.byStatus },
    { key: "messages", title: "Messaging Load", type: "metric", data: { unread: analytics.messages.unread, conversations: analytics.messages.conversations } },
  ];
  if (["super_admin", "admin", "team_lead"].includes(role)) widgets.push({ key: "revenue", title: "Revenue Analytics", type: "chart", data: analytics.revenue.monthlyRevenue });
  if (executive) widgets.push({ key: "system-health", title: "System Health", type: "metric", data: executive.systemHealth });
  return widgets;
}

async function listDashboards(user) {
  const role = roleOf(user);
  return Dashboard.find({
    active: true,
    $or: [
      { owner: user._id },
      { sharedWithUsers: user._id },
      { sharedWithRoles: role },
      { role },
      { dashboardType: "system" },
    ],
  }).sort({ isDefault: -1, updatedAt: -1 }).lean();
}

async function saveDashboard(payload, user) {
  return Dashboard.create({ ...payload, owner: payload.owner || user._id, createdBy: user._id, updatedBy: user._id });
}

async function updateDashboard(id, payload, user) {
  return Dashboard.findByIdAndUpdate(id, { ...payload, updatedBy: user._id }, { new: true, runValidators: true });
}

async function createScheduledReport(payload, user) {
  return ScheduledReport.create({ ...payload, createdBy: user._id, updatedBy: user._id });
}

async function listScheduledReports(user) {
  const role = roleOf(user);
  const filter = ["super_admin", "admin", "finance", "team_lead"].includes(role) ? {} : { createdBy: user._id };
  return ScheduledReport.find(filter).sort({ updatedAt: -1 }).lean();
}

async function exportDashboard(query, user) {
  const dashboard = await roleDashboard(user, query);
  return {
    format: query.format || "json",
    exportedAt: new Date(),
    exportedBy: user._id,
    dashboard,
  };
}

module.exports = {
  appointmentAnalytics,
  buildAnalytics,
  caseAnalytics,
  clientDashboard,
  collaborationSummary,
  createScheduledReport,
  documentAnalytics,
  employerDashboard,
  exportDashboard,
  listDashboards,
  listScheduledReports,
  messagingAnalytics,
  questionnaireAnalytics,
  revenueAnalytics,
  roleDashboard,
  saveDashboard,
  updateDashboard,
  userAnalytics,
  workflowAnalytics,
};
