const Appointment = require("../../models/Appointment");
const Case = require("../../models/Case");
const Client = require("../../models/Client");
const Document = require("../../models/Document");
const User = require("../../models/User");
const { resolveDocumentRequirements } = require("../document-requirements/document-requirement.resolver");
const { invalidateUserCache } = require("../../config/redis");

const clientRoles = ["client", "user"];

async function getOverview(req, res, next) {
  try {
    const [
      totalUsers,
      completedProfiles,
      totalAppointments,
      pendingAppointments,
      totalCases,
      recentUsers,
      recentAppointments,
      visaBreakdown,
    ] = await Promise.all([
      User.countDocuments({ role: { $in: clientRoles } }),
      Client.countDocuments({ completed: true }),
      Appointment.countDocuments(),
      Appointment.countDocuments({ status: "pending" }),
      Case.countDocuments(),
      User.find({ role: { $in: clientRoles } }).sort({ createdAt: -1 }).limit(5).select("email displayName name createdAt"),
      Appointment.find().sort({ createdAt: -1 }).limit(5).lean(),
      Case.aggregate([{ $group: { _id: "$visaType", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    ]);

    res.json({
      success: true,
      stats: {
        totalUsers,
        completedProfiles,
        incompleteProfiles: Math.max(totalUsers - completedProfiles, 0),
        totalAppointments,
        pendingAppointments,
        totalCases,
      },
      recentUsers,
      recentAppointments,
      visaBreakdown,
    });
  } catch (error) {
    next(error);
  }
}

async function getAllUsers(req, res, next) {
  try {
    const { search, visaType, page = 1, limit = 20 } = req.query;
    const pageNumber = Math.max(Number(page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const userFilter = { role: { $in: clientRoles } };

    if (search) {
      userFilter.$or = [
        { email: { $regex: search, $options: "i" } },
        { displayName: { $regex: search, $options: "i" } },
        { name: { $regex: search, $options: "i" } },
      ];
    }

    const [total, users] = await Promise.all([
      User.countDocuments(userFilter),
      User.find(userFilter).sort({ createdAt: -1 }).skip((pageNumber - 1) * pageSize).limit(pageSize).select("email displayName name createdAt lastLogin isActive").lean(),
    ]);

    const userIds = users.map((user) => user._id);
    const [profiles, cases] = await Promise.all([
      Client.find({ user: { $in: userIds } }).lean(),
      Case.find({ user: { $in: userIds } }).select("visaType currentStage stage status caseId caseNumber user").lean(),
    ]);

    const profileMap = new Map(profiles.map((profile) => [profile.user?.toString(), profile]));
    const caseMap = new Map(cases.map((caseData) => [caseData.user?.toString(), caseData]));
    const enriched = users.map((user) => ({
      ...user,
      displayName: user.displayName || user.name,
      profile: profileMap.get(user._id.toString()) || null,
      case: caseMap.get(user._id.toString()) || null,
    }));

    const filtered = visaType
      ? enriched.filter((user) => user.case?.visaType?.toLowerCase().includes(String(visaType).toLowerCase()))
      : enriched;

    res.json({ success: true, users: filtered, total, page: pageNumber, pages: Math.ceil(total / pageSize) || 1 });
  } catch (error) {
    next(error);
  }
}

async function getUserDetail(req, res, next) {
  try {
    const { userId } = req.params;
    const [user, profile, documents, caseData] = await Promise.all([
      User.findById(userId).select("-password -refreshTokens -twoFactorSecret").lean(),
      Client.findOne({ user: userId }).lean(),
      Document.find({ user: userId }).sort({ category: 1, createdAt: -1 }).lean(),
      Case.findOne({ user: userId }).lean(),
    ]);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, user, profile, documents, case: caseData });
  } catch (error) {
    next(error);
  }
}

async function toggleUserStatus(req, res, next) {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (["admin", "super_admin"].includes(user.role)) return res.status(400).json({ success: false, message: "Cannot deactivate an administrator" });

    user.isActive = !user.isActive;
    user.deactivatedAt = user.isActive ? undefined : new Date();
    user.deactivatedBy = user.isActive ? undefined : req.user._id;
    await user.save();
    await invalidateUserCache(user._id);

    res.json({ success: true, message: `User ${user.isActive ? "activated" : "deactivated"}`, isActive: user.isActive });
  } catch (error) {
    next(error);
  }
}

async function getDocumentOverview(req, res, next) {
  try {
    const users = await User.find({ role: { $in: clientRoles } }).select("email displayName name").lean();
    const userIds = users.map((user) => user._id);
    const [documents, cases] = await Promise.all([
      Document.find({ user: { $in: userIds } }).lean(),
      Case.find({ user: { $in: userIds } }).select("user visaType").sort({ createdAt: -1 }).lean(),
    ]);
    const documentMap = new Map();
    documents.forEach((document) => {
      const userId = document.user?.toString();
      if (!documentMap.has(userId)) documentMap.set(userId, []);
      documentMap.get(userId).push(document);
    });

    // Most recent case per user only (cases are already sorted newest-first).
    const caseByUser = new Map();
    cases.forEach((caseData) => {
      const userId = caseData.user?.toString();
      if (userId && !caseByUser.has(userId)) caseByUser.set(userId, caseData);
    });

    const overview = await Promise.all(users.map(async (user) => {
      const userId = user._id.toString();
      const activeCase = caseByUser.get(userId);
      // Same resolver used at case creation and by the "regenerate checklist"
      // admin action — keeps this tab's document list visa-aware and in sync
      // with the client portal instead of a generic hardcoded list.
      const requiredDocuments = activeCase?.visaType ? await resolveDocumentRequirements(activeCase.visaType) : [];
      return {
        user: { _id: user._id, email: user.email, displayName: user.displayName || user.name },
        visaType: activeCase?.visaType || null,
        requiredDocuments,
        documents: documentMap.get(userId) || [],
        uploadedCount: (documentMap.get(userId) || []).length,
      };
    }));
    res.json(overview);
  } catch (error) {
    next(error);
  }
}

module.exports = { getAllUsers, getDocumentOverview, getOverview, getUserDetail, toggleUserStatus };
