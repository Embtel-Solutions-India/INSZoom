const AuditLog = require("../../models/AuditLog");
const AuthSession = require("../../models/AuthSession");
const Case = require("../../models/Case");
const StaffPerformance = require("../../models/StaffPerformance");
const User = require("../../models/User");
const sessionService = require("../auth/session.service");
const { canCreateUserRole, canModifyUser } = require("../authorization/rbac.service");
const { normalizeRole } = require("../authorization/roleHierarchy");
const caseService = require("../cases/case.service");
const { invalidateUserCache } = require("../../config/redis");

const USER_SELECT = "-password -passwordResetTokenHash -emailVerificationTokenHash -twoFactorSecret";
const ASSIGNABLE_ROLES = ["case_manager", "team_lead", "admin", "paralegal", "finance", "hr", "reviewer"];
const ALLOWED_USER_FIELDS = [
  "email",
  "password",
  "displayName",
  "name",
  "role",
  "phone",
  "department",
  "specialization",
  "teamId",
  "companyId",
  "avatar",
  "profileImage",
  "permissions",
  "isActive",
  "isEmailVerified",
  "preferences",
  "settings",
  "twoFactorEnabled",
];

function sameId(left, right) {
  return left && right && left.toString() === right.toString();
}

function canViewUser(currentUser, targetUser) {
  if (!currentUser || !targetUser) return false;
  const role = normalizeRole(currentUser.role);
  if (["super_admin", "admin", "hr"].includes(role)) return true;
  if (sameId(currentUser._id, targetUser._id)) return true;
  if (role === "team_lead" && currentUser.teamId) return sameId(currentUser.teamId, targetUser.teamId);
  return canModifyUser(currentUser, targetUser);
}

function normalizeUserPayload(payload = {}) {
  const picked = {};
  ALLOWED_USER_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) picked[field] = payload[field];
  });
  if (picked.email) picked.email = picked.email.toLowerCase();
  if (!picked.displayName && picked.name) picked.displayName = picked.name;
  if (!picked.name && picked.displayName) picked.name = picked.displayName;
  if (picked.role) picked.role = normalizeRole(picked.role);
  if (picked.profileImage && !picked.avatar) picked.avatar = picked.profileImage;
  if (picked.avatar && !picked.profileImage) picked.profileImage = picked.avatar;
  return picked;
}

function buildUserFilter(query = {}, currentUser) {
  const filter = {};
  if (query.role) filter.role = normalizeRole(query.role);
  if (query.department) filter.department = query.department;
  if (query.teamId) filter.teamId = query.teamId;
  if (query.companyId) filter.companyId = query.companyId;
  if (query.isActive !== undefined) filter.isActive = query.isActive === true || query.isActive === "true";
  if (query.search) {
    const search = { $regex: query.search, $options: "i" };
    filter.$or = [{ name: search }, { displayName: search }, { email: search }, { department: search }, { specialization: search }];
  }
  if (normalizeRole(currentUser?.role) === "team_lead" && currentUser.teamId) filter.teamId = currentUser.teamId;
  return filter;
}

function pagination(query = {}) {
  const page = Math.max(Number(query.page || 1), 1);
  const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
  return { page, limit, skip: (page - 1) * limit };
}

function sortFor(query = {}) {
  const allowed = new Set(["name", "displayName", "email", "role", "department", "lastLogin", "createdAt", "updatedAt", "isActive"]);
  const sortBy = allowed.has(query.sortBy) ? query.sortBy : "name";
  const direction = query.sortOrder === "desc" ? -1 : 1;
  return { [sortBy]: direction, email: 1 };
}

async function writeAuditLog(action, targetUser, currentUser, changes, req) {
  await AuditLog.create({
    userId: currentUser?._id,
    action,
    entityType: "user",
    entityId: targetUser?._id?.toString(),
    changes,
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
    description: `${action} user ${targetUser?.email || targetUser?._id}`,
  }).catch(() => {});
}

async function listUsers(query, currentUser) {
  const filter = buildUserFilter(query, currentUser);
  const { page, limit, skip } = pagination(query);
  const [users, total] = await Promise.all([
    User.find(filter).select(USER_SELECT).sort(sortFor(query)).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);
  return {
    users,
    count: users.length,
    total,
    pagination: { page, limit, pages: Math.ceil(total / limit) || 1 },
  };
}

async function getAssignableClientUsers(currentUser) {
  const caseFilter = caseService.buildCaseFilter({}, currentUser);
  const assignedCases = await Case.find(caseFilter).select("user caseNumber caseId clientName clientEmail");
  const relatedUserIds = [...new Set(assignedCases.map((caseData) => caseData.user?.toString()).filter(Boolean))];
  if (!relatedUserIds.length) return [];

  const clients = await User.find({
    _id: { $in: relatedUserIds },
    isActive: true,
  }).select(USER_SELECT).sort({ name: 1, displayName: 1, email: 1 });

  const casesByUserId = assignedCases.reduce((lookup, caseData) => {
    const userId = caseData.user?.toString();
    if (!userId) return lookup;
    lookup[userId] = lookup[userId] || [];
    lookup[userId].push({
      caseId: caseData._id,
      caseNumber: caseData.caseNumber || caseData.caseId,
      clientName: caseData.clientName,
      clientEmail: caseData.clientEmail,
    });
    return lookup;
  }, {});

  return clients.map((client) => ({
    ...client.toObject(),
    relatedCases: casesByUserId[client._id.toString()] || [],
  }));
}

async function getAssignableUsers(currentUser, role, options = {}) {
  const normalizedRole = role ? normalizeRole(role) : null;
  const includeCaseClients = options.includeCaseClients === true || normalizedRole === "client";
  const users = [];

  if (!normalizedRole || normalizedRole !== "client") {
    const filter = { isActive: true };
    filter.role = normalizedRole ? normalizedRole : { $in: ASSIGNABLE_ROLES };
    if (normalizeRole(currentUser.role) === "team_lead" && currentUser.teamId) filter.teamId = currentUser.teamId;
    const staffUsers = await User.find(filter).select(USER_SELECT).sort({ name: 1, displayName: 1, email: 1 });
    users.push(...staffUsers.map((staffUser) => staffUser.toObject()));
  }

  if (includeCaseClients) {
    const clientUsers = await getAssignableClientUsers(currentUser);
    users.push(...clientUsers);
  }

  const deduped = Array.from(new Map(users.map((user) => [user._id.toString(), user])).values());
  deduped.sort((left, right) => {
    const leftName = (left.name || left.displayName || left.email || "").toLowerCase();
    const rightName = (right.name || right.displayName || right.email || "").toLowerCase();
    return leftName.localeCompare(rightName);
  });
  return deduped;
}

async function getUserOrThrow(id, currentUser) {
  const user = await User.findById(id).select(USER_SELECT);
  if (!user) {
    const error = new Error("User not found");
    error.status = 404;
    throw error;
  }
  if (!canViewUser(currentUser, user)) {
    const error = new Error("You do not have permission to view this user");
    error.status = 403;
    throw error;
  }
  return user;
}

async function createUser(payload, currentUser, req) {
  const userPayload = normalizeUserPayload(payload);
  if (!canCreateUserRole(currentUser, userPayload.role)) {
    const error = new Error("You do not have permission to create a user with this role");
    error.status = 403;
    throw error;
  }
  const exists = await User.findOne({ email: userPayload.email });
  if (exists) {
    const error = new Error("Email already registered");
    error.status = 409;
    throw error;
  }
  const user = await User.create(userPayload);
  await writeAuditLog("create", user, currentUser, userPayload, req);
  return User.findById(user._id).select(USER_SELECT);
}

async function updateUser(id, payload, currentUser, req) {
  const targetUser = await User.findById(id).select("+password");
  if (!targetUser) {
    const error = new Error("User not found");
    error.status = 404;
    throw error;
  }
  if (!canModifyUser(currentUser, targetUser)) {
    const error = new Error("You do not have permission to modify this user");
    error.status = 403;
    throw error;
  }
  const userPayload = normalizeUserPayload(payload);
  if (userPayload.role && userPayload.role !== targetUser.role && !canCreateUserRole(currentUser, userPayload.role)) {
    const error = new Error("You do not have permission to assign this role");
    error.status = 403;
    throw error;
  }
  Object.assign(targetUser, userPayload);
  if (payload.isActive === false && targetUser.isActive !== false) {
    targetUser.deactivatedAt = new Date();
    targetUser.deactivatedBy = currentUser._id;
    targetUser.tokenVersion = (targetUser.tokenVersion || 0) + 1;
    await sessionService.revokeAllSessions(targetUser._id);
  }
  if (payload.isActive === true) {
    targetUser.deactivatedAt = undefined;
    targetUser.deactivatedBy = undefined;
  }
  await targetUser.save();
  await invalidateUserCache(targetUser._id);
  await writeAuditLog("update", targetUser, currentUser, userPayload, req);
  return User.findById(id).select(USER_SELECT);
}

async function deactivateUser(id, currentUser, req) {
  const user = await updateUser(id, { isActive: false }, currentUser, req);
  await writeAuditLog("deactivate", user, currentUser, {}, req);
  return user;
}

async function getDashboard(currentUser) {
  const role = normalizeRole(currentUser.role);
  const filter = {};
  if (role === "team_lead" && currentUser.teamId) filter.teamId = currentUser.teamId;
  const [total, active, inactive, byRole] = await Promise.all([
    User.countDocuments(filter),
    User.countDocuments({ ...filter, isActive: true }),
    User.countDocuments({ ...filter, isActive: false }),
    User.aggregate([{ $match: filter }, { $group: { _id: "$role", count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
  ]);
  return { total, active, inactive, byRole };
}

async function getUserActivity(id, currentUser) {
  const user = await getUserOrThrow(id, currentUser);
  const [sessions, auditLogs] = await Promise.all([
    AuthSession.find({ user: user._id }).sort({ createdAt: -1 }).limit(20),
    AuditLog.find({ userId: user._id }).sort({ createdAt: -1 }).limit(50),
  ]);
  return { user, loginHistory: user.loginHistory || [], sessions, auditLogs };
}

async function getUserPerformance(id, currentUser) {
  const user = await getUserOrThrow(id, currentUser);
  const role = normalizeRole(user.role);
  const performanceData = await StaffPerformance.find({ staff: user._id }).sort({ periodStart: -1 }).limit(6);
  const currentCases = [];
  if (role === "case_manager") {
    const cases = await Case.find({ assignedCaseManager: user._id, status: { $in: ["active", "processing", "in_review"] } }).select("caseNumber clientName status stage").limit(20);
    currentCases.push(...cases);
  }
  return { user, role, currentCases, performanceData };
}

module.exports = {
  USER_SELECT,
  canViewUser,
  createUser,
  deactivateUser,
  getAssignableUsers,
  getDashboard,
  getUserActivity,
  getUserOrThrow,
  getUserPerformance,
  listUsers,
  normalizeUserPayload,
  updateUser,
};
