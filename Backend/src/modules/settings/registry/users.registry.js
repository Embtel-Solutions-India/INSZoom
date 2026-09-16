const { z } = require("zod");

// Settings → Users & Permissions. Firm Members/Teams/Branches themselves
// are real documents (User/Team/Branch), not settings values — they're
// managed through their own CRUD routes (see modules/users, modules/teams,
// modules/branches), not through this registry. What lives here is the
// role → permission override mechanism, RELOCATED from the old
// roles.registry.js (same two key names, unchanged — rbac.service.js reads
// "roles.permissionOverrides" directly regardless of which registry file
// declares it, so nothing about the live RBAC override wiring built in the
// previous pass needed to change to move it here).
module.exports = [
  {
    key: "roles.matrix",
    category: "users",
    group: "Permission matrix",
    label: "Role → permission matrix (baseline)",
    description: "Read-only baseline from modules/authorization/permissions.registry.js — what a role has if no override below is set for it.",
    type: "json",
    default: {},
    validation: z.record(z.array(z.string())),
    scopes: ["system"],
    requiresPermission: "settings:manage_users",
    readOnly: true,
    affects: "informational only",
  },
  {
    key: "roles.permissionOverrides",
    category: "users",
    group: "Permission matrix",
    label: "Role permission overrides",
    description: "Per-role permission list that REPLACES the baseline for that role when present. super_admin can never be overridden.",
    type: "json",
    default: {},
    validation: z.record(z.array(z.string())),
    scopes: ["system"],
    requiresPermission: "settings:manage_users",
    affects: "modules/authorization/rbac.service.js hasPermission()",
  },
];
