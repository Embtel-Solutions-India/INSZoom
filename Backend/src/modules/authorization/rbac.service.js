const { ROLE_PERMISSIONS } = require("./permissions.registry");
const { normalizeRole, isHigherRole } = require("./roleHierarchy");

function hasRole(user, roles) {
  if (!user) return false;
  const normalized = normalizeRole(user.role);
  return roles.includes(user.role) || roles.includes(normalized);
}

function hasPermission(user, permission) {
  if (!user) return false;
  const directPermissions = user.permissions || [];
  if (directPermissions.includes("*") || directPermissions.includes(permission)) return true;
  const [resource] = permission.split(":");
  if (directPermissions.includes(`${resource}:*`)) return true;

  const role = normalizeRole(user.role);
  const rolePermissions = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS[user.role] || [];
  if (rolePermissions.includes("*") || rolePermissions.includes(permission)) return true;

  return rolePermissions.includes(`${resource}:*`);
}

function canCreateUserRole(currentUser, targetRole) {
  if (!currentUser || !targetRole) return false;
  const currentRole = normalizeRole(currentUser.role);
  const normalizedTargetRole = normalizeRole(targetRole);
  if (currentRole === "super_admin") return true;
  if (currentRole === "admin") return normalizedTargetRole !== "super_admin";
  return false;
}

function canModifyUser(currentUser, targetUser) {
  if (!currentUser || !targetUser) return false;
  if (currentUser._id?.toString() === targetUser._id?.toString()) return true;
  const currentRole = normalizeRole(currentUser.role);
  const targetRole = normalizeRole(targetUser.role);
  if (currentRole === "super_admin") return true;
  if (currentRole === "admin") return targetRole !== "super_admin";
  if (currentRole === "team_lead") {
    return targetUser.teamId?.toString() === currentUser.teamId?.toString();
  }
  return isHigherRole(currentRole, targetRole);
}

module.exports = {
  hasRole,
  hasPermission,
  canCreateUserRole,
  canModifyUser,
};
