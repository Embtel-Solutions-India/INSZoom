const dashboardService = require("./dashboard.service");
const { cachedDashboardCompute } = require("../../config/redis");

// Every one of these endpoints is a pure read (dashboard/analytics widgets),
// so they're safe to cache-aside per user+query for a short TTL — the cache
// is invalidated wholesale (dashboardCacheBump) wherever a case or payment
// mutates, see case.service.js's addAuditEntry and payment.service.js's
// payment:updated emit.
function cacheKeyFor(name, req) {
  return `${name}:${req.user._id}:${JSON.stringify(req.query || {})}`;
}

exports.getDashboard = async (req, res, next) => {
  try {
    const dashboard = await cachedDashboardCompute(cacheKeyFor("roleDashboard", req), () => dashboardService.roleDashboard(req.user, req.query));
    res.json(dashboard);
  } catch (error) {
    next(error);
  }
};

exports.getLegacyDashboardStats = async (req, res, next) => {
  try {
    const dashboard = await cachedDashboardCompute(cacheKeyFor("roleDashboard", req), () => dashboardService.roleDashboard(req.user, req.query));
    const caseStage = dashboard.analytics.cases.byStage;
    const caseVisa = dashboard.analytics.cases.byVisaType;
    const topCaseManager = dashboard.teamPerformance.find((item) => item.role === "case_manager");
    res.json({
      success: true,
      totalCases: dashboard.analytics.cases.total,
      activeCases: dashboard.analytics.cases.active,
      closedCases: dashboard.analytics.cases.closed,
      onHoldCases: dashboard.analytics.cases.onHold,
      pendingPayments: dashboard.analytics.revenue.byStatus.filter((item) => ["not_started", "pending", "partially_paid", "partial"].includes(item.key)).reduce((sum, item) => sum + item.count, 0),
      pendingAmount: dashboard.analytics.revenue.totals.outstanding,
      totalRevenue: dashboard.analytics.revenue.totals.revenue,
      totalFees: dashboard.analytics.revenue.totals.total,
      uscisFees: dashboard.analytics.revenue.totals.uscisFees,
      casesByStage: caseStage,
      casesByVisaType: caseVisa,
      topCaseManager: topCaseManager?.staff?.name || topCaseManager?.staff?.displayName || "N/A",
      topCaseManagerScore: topCaseManager?.score || 0,
      dashboard,
    });
  } catch (error) {
    next(error);
  }
};

exports.getRoleDashboard = async (req, res, next) => {
  try {
    const baseUser = typeof req.user.toObject === "function" ? req.user.toObject() : req.user;
    const role = req.params.role || req.user.role;
    const dashboard = await cachedDashboardCompute(cacheKeyFor(`roleDashboard:${role}`, req), () => dashboardService.roleDashboard({ ...baseUser, role }, req.query));
    res.json(dashboard);
  } catch (error) {
    next(error);
  }
};

exports.getNamedDashboard = async (req, res, next) => {
  try {
    const requested = req.params.dashboardType;
    const role = requested === "admin" || requested === "executive" ? req.user.role : requested;
    const specialized = {
      client: dashboardService.clientDashboard,
      employer: dashboardService.employerDashboard,
    }[requested];
    const dashboard = await cachedDashboardCompute(cacheKeyFor(`namedDashboard:${requested}`, req), () => (
      specialized
        ? specialized(req.user, req.query)
        : dashboardService.roleDashboard({ ...(req.user.toObject?.() || req.user), role }, req.query)
    ));
    res.json({ success: true, dashboard });
  } catch (error) {
    next(error);
  }
};

exports.getAnalytics = async (req, res, next) => {
  try {
    const analytics = await cachedDashboardCompute(cacheKeyFor("buildAnalytics", req), () => dashboardService.buildAnalytics(req.query, req.user));
    res.json({ success: true, analytics });
  } catch (error) {
    next(error);
  }
};

exports.getCaseAnalytics = async (req, res, next) => {
  try {
    const cases = await cachedDashboardCompute(cacheKeyFor("caseAnalytics", req), () => dashboardService.caseAnalytics(req.query, req.user));
    res.json({ success: true, cases });
  } catch (error) {
    next(error);
  }
};

exports.getRevenueAnalytics = async (req, res, next) => {
  try {
    const revenue = await cachedDashboardCompute(cacheKeyFor("revenueAnalytics", req), () => dashboardService.revenueAnalytics(req.query, req.user));
    res.json({ success: true, revenue, monthlyRevenue: revenue.monthlyRevenue });
  } catch (error) {
    next(error);
  }
};

exports.getPaymentAnalytics = async (req, res, next) => {
  try {
    const revenue = await cachedDashboardCompute(cacheKeyFor("revenueAnalytics", req), () => dashboardService.revenueAnalytics(req.query, req.user));
    const t = revenue.totals;
    // the names the Analytics page reads, plus the GoHighLevel figures: everything in US dollars
    res.json({
      success: true, ...t, totalRevenue: t.revenue, pendingAmount: t.outstanding, overdueAmount: 0,
      paymentRate: t.total ? Math.round((t.revenue / t.total) * 100) : 0,
      byStatus: revenue.byStatus, monthlyRevenue: revenue.monthlyRevenue,
    });
  } catch (error) {
    next(error);
  }
};

// One row per case with its GoHighLevel figures (total / USCIS fee / paid / outstanding), for the Payments Overview table. US dollars.
exports.getPaymentCases = async (req, res, next) => {
  try {
    const range = {};
    const from = req.query.from || req.query.startDate;
    const to = req.query.to || req.query.endDate;
    if (from || to) range.createdAt = { ...(from ? { $gte: new Date(from) } : {}), ...(to ? { $lte: new Date(to) } : {}) };
    // a case manager sees the cases they are on; admins, super admins and team leads see all
    const extra = require("../authorization/roleHierarchy").normalizeRole(req.user?.role) === "case_manager" ? require("../cases/caseManagerAccess").caseManagerMatch(req.user._id) : {};
    const data = await require("../finance/caseFinance.service").listCases({ range, search: req.query.search, status: req.query.status, page: req.query.page, limit: req.query.limit, extra });
    res.json({ success: true, ...data });
  } catch (error) {
    next(error);
  }
};

exports.getProcessingTime = async (req, res, next) => {
  try {
    const cases = await cachedDashboardCompute(cacheKeyFor("caseAnalytics", req), () => dashboardService.caseAnalytics(req.query, req.user));
    res.json({ success: true, processingTimes: cases.processingTimes });
  } catch (error) {
    next(error);
  }
};

exports.getRfeTrends = async (req, res, next) => {
  try {
    const cases = await cachedDashboardCompute(cacheKeyFor("caseAnalytics", req), () => dashboardService.caseAnalytics(req.query, req.user));
    res.json({ success: true, rfeTrends: cases.rfeTrends });
  } catch (error) {
    next(error);
  }
};

exports.getDocumentAnalytics = async (req, res, next) => {
  try {
    const documents = await cachedDashboardCompute(cacheKeyFor("documentAnalytics", req), () => dashboardService.documentAnalytics(req.query, req.user));
    res.json({ success: true, documents });
  } catch (error) {
    next(error);
  }
};

exports.getWorkflowAnalytics = async (req, res, next) => {
  try {
    const workflows = await cachedDashboardCompute(cacheKeyFor("workflowAnalytics", req), () => dashboardService.workflowAnalytics(req.query, req.user));
    res.json({ success: true, workflows });
  } catch (error) {
    next(error);
  }
};

exports.getQuestionnaireAnalytics = async (req, res, next) => {
  try {
    const questionnaires = await cachedDashboardCompute(cacheKeyFor("questionnaireAnalytics", req), () => dashboardService.questionnaireAnalytics(req.query, req.user));
    res.json({ success: true, questionnaires });
  } catch (error) {
    next(error);
  }
};

exports.getMessagingAnalytics = async (req, res, next) => {
  try {
    const messages = await cachedDashboardCompute(cacheKeyFor("messagingAnalytics", req), () => dashboardService.messagingAnalytics(req.query, req.user));
    res.json({ success: true, messages });
  } catch (error) {
    next(error);
  }
};

exports.getAppointmentAnalytics = async (req, res, next) => {
  try {
    const appointments = await cachedDashboardCompute(cacheKeyFor("appointmentAnalytics", req), () => dashboardService.appointmentAnalytics(req.query, req.user));
    res.json({ success: true, appointments });
  } catch (error) {
    next(error);
  }
};

exports.getUserAnalytics = async (req, res, next) => {
  try {
    const users = await cachedDashboardCompute(cacheKeyFor("userAnalytics", req), () => dashboardService.userAnalytics(req.query));
    res.json({ success: true, users });
  } catch (error) {
    next(error);
  }
};

exports.listSavedDashboards = async (req, res, next) => {
  try {
    const dashboards = await dashboardService.listDashboards(req.user);
    res.json({ success: true, count: dashboards.length, dashboards });
  } catch (error) {
    next(error);
  }
};

exports.createDashboard = async (req, res, next) => {
  try {
    const dashboard = await dashboardService.saveDashboard(req.body, req.user);
    res.status(201).json({ success: true, dashboard });
  } catch (error) {
    next(error);
  }
};

exports.updateDashboard = async (req, res, next) => {
  try {
    const dashboard = await dashboardService.updateDashboard(req.params.id, req.body, req.user);
    if (!dashboard) return res.status(404).json({ success: false, message: "Dashboard not found" });
    res.json({ success: true, dashboard });
  } catch (error) {
    next(error);
  }
};

exports.exportDashboard = async (req, res, next) => {
  try {
    const exported = await dashboardService.exportDashboard(req.query, req.user);
    res.json({ success: true, export: exported });
  } catch (error) {
    next(error);
  }
};

exports.listScheduledReports = async (req, res, next) => {
  try {
    const reports = await dashboardService.listScheduledReports(req.user);
    res.json({ success: true, count: reports.length, reports });
  } catch (error) {
    next(error);
  }
};

exports.createScheduledReport = async (req, res, next) => {
  try {
    const report = await dashboardService.createScheduledReport(req.body, req.user);
    res.status(201).json({ success: true, report });
  } catch (error) {
    next(error);
  }
};
