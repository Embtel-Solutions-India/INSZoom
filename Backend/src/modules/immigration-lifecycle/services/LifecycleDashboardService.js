const Case = require("../../../models/Case");
const Task = require("../../../models/Task");
const caseService = require("../../cases/case.service");
const DeadlineService = require("./DeadlineService");

class LifecycleDashboardService {
  static async dashboard(user, query = {}) {
    const filter = caseService.buildCaseFilter(query, user);
    const cases = await Case.find(filter).populate("beneficiary", "fullName passportExpirationDate visaExpirationDate").limit(500);
    const caseIds = cases.map((item) => item._id);
    const pendingRfes = cases.reduce((count, item) => count + (item.immigrationLifecycle?.rfes || []).filter((rfe) => rfe.responseStatus !== "responded").length, 0);
    const upcomingDeadlines = cases.flatMap((item) => DeadlineService.upcoming(item, 180).map((deadline) => ({ ...deadline, caseId: item._id, caseNumber: item.caseNumber }))).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    const futureRecommendations = cases.flatMap((item) => DeadlineService.futureRecommendations(item).map((recommendation) => ({ ...recommendation, caseId: item._id, caseNumber: item.caseNumber })));
    const [openTasks, byStatus, byVisa] = await Promise.all([
      Task.countDocuments({ caseId: { $in: caseIds }, status: { $nin: ["completed", "cancelled"] } }),
      Case.aggregate([{ $match: { _id: { $in: caseIds } } }, { $group: { _id: "$immigrationLifecycle.filingStatus", count: { $sum: 1 } } }]),
      Case.aggregate([{ $match: { _id: { $in: caseIds } } }, { $group: { _id: "$visaType", count: { $sum: 1 } } }]),
    ]);
    return {
      activeCases: cases.length,
      pendingRfes,
      expiringCases: upcomingDeadlines.filter((item) => ["visa_expiration", "i94_expiration", "ead_expiration", "passport_expiration"].includes(item.type)).length,
      upcomingFilings: upcomingDeadlines.filter((item) => item.type === "filing_deadline").length,
      criticalDeadlines: upcomingDeadlines.filter((item) => item.priority === "urgent" || new Date(item.dueDate) <= new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)).length,
      openTasks,
      casesByLifecycleStatus: byStatus,
      visaCategories: byVisa,
      upcomingDeadlines: upcomingDeadlines.slice(0, 50),
      futureRecommendations: futureRecommendations.slice(0, 50),
    };
  }
}

module.exports = LifecycleDashboardService;
