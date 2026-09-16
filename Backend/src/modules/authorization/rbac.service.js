const { ROLE_PERMISSIONS } = require("./permissions.registry");
const { normalizeRole, isHigherRole } = require("./roleHierarchy");
// Deliberately the SettingValue model directly, not settingsEngine.service.js
// — that module already requires this one (for its own write-permission
// checks), and requiring it back here would create a require cycle. This
// keeps hasPermission() itself fully synchronous (same performance profile
// as before); only the in-memory `permissionOverrides` map is refreshed
// asynchronously in the background — see settings/registry/roles.registry.js
// for the full design rationale.
const SettingValue = require("../../models/SettingValue");
const settingsEvents = require("../settings/settingsEvents");

let permissionOverrides = {};

async function loadPermissionOverrides() {
  try {
    const doc = await SettingValue.findOne({ key: "roles.permissionOverrides", scope: "system", scopeId: null }).lean();
    permissionOverrides = doc?.value && typeof doc.value === "object" ? doc.value : {};
  } catch {
    // Keep whatever was last successfully loaded (or {} on a first-ever
    // failure) — a transient DB error here must never crash every
    // permission check in the app.
  }
}

// Fire-and-forget at module load — every hasPermission() call before this
// resolves just uses the static ROLE_PERMISSIONS baseline, identical to
// pre-engine behavior, so a cold start is never blocked or broken by this.
loadPermissionOverrides();
settingsEvents.on("settings.changed", ({ key }) => {
  if (key === "roles.permissionOverrides") loadPermissionOverrides();
});

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
  // Hard guard: super_admin is never overridable, by construction — a bad
  // or malicious roles.permissionOverrides value can never lock out the
  // last super_admin.
  if (role === "super_admin") return true;

  const override = permissionOverrides[role] ?? permissionOverrides[user.role];
  const rolePermissions = Array.isArray(override) ? override : (ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS[user.role] || []);
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
