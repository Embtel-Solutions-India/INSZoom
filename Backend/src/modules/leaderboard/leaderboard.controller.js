const StaffPerformance = require("../../models/StaffPerformance");
const User = require("../../models/User");
const Case = require("../../models/Case");
const Task = require("../../models/Task");

async function calculate(req, res, next) {
  try {
    const period = req.body.period || req.query.period || "this_month";
    const periodStart = new Date();
    periodStart.setDate(period === "today" ? periodStart.getDate() : period === "this_week" ? periodStart.getDate() - 7 : periodStart.getDate() - 30);
    const periodEnd = new Date();
    const staff = await User.find({ role: { $in: ["case_manager", "team_lead"] }, isActive: true }).lean();
    const rows = await Promise.all(staff.map(async (user) => {
      const [activeCases, closedCases, tasksCompleted] = await Promise.all([
        Case.countDocuments({ $or: [{ assignedCaseManager: user._id }, { assignedTeamLead: user._id }], status: { $nin: ["closed", "completed", "archived"] } }),
        Case.countDocuments({ $or: [{ assignedCaseManager: user._id }, { assignedTeamLead: user._id }], status: { $in: ["closed", "completed", "approved"] }, updatedAt: { $gte: periodStart, $lte: periodEnd } }),
        Task.countDocuments({ assignedTo: user._id, status: "completed", updatedAt: { $gte: periodStart, $lte: periodEnd } }),
      ]);
      const score = closedCases * 10 + tasksCompleted * 3 + activeCases;
      return StaffPerformance.findOneAndUpdate(
        { staff: user._id, period, periodStart },
        { staff: user._id, role: user.role === "team_lead" ? "team_lead" : "case_manager", period, periodStart, periodEnd, activeCases, closedCases, metrics: { tasksCompleted }, score },
        { new: true, upsert: true, runValidators: true }
      );
    }));
    res.json({ success: true, data: rows, leaderboard: rows });
  } catch (error) {
    next(error);
  }
}

async function list(req, res, next) {
  try {
    const rows = await StaffPerformance.find(req.query.period ? { period: req.query.period } : {}).populate("staff", "name displayName email role").sort({ score: -1 }).limit(50).lean();
    res.json({ success: true, data: rows, leaderboard: rows });
  } catch (error) {
    next(error);
  }
}

module.exports = { calculate, list };
