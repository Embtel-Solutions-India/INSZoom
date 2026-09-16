const { z } = require("zod");

// §4.3 Roles & Permissions.
// PARTIAL IN THIS PASS: modules/authorization/rbac.service.js's
// hasPermission() is called synchronously from authorizePermissions
// middleware on every single permission-gated route across the whole app.
// Making role->permission truly live-editable through this engine would
// require that check to read the (async, cached) settings engine on every
// request — a change with app-wide blast radius that needs its own careful
// pass, not bundled into this one. For now this key is READ-ONLY: it
// mirrors the existing static PERMISSIONS/ROLE_PERMISSIONS registry
// (modules/authorization/permissions.registry.js) into the settings catalog
// so the UI has a real matrix to display, gated by settings:manage_roles.
// Editing here does not yet write back to rbac.service.js.
module.exports = [
  {
    key: "roles.matrix",
    category: "roles",
    group: "Permission matrix",
    label: "Role → permission matrix",
    description: "Read-only mirror of modules/authorization/permissions.registry.js. Live editing is a follow-up (see registry file header).",
    type: "json",
    default: {},
    validation: z.record(z.array(z.string())),
    scopes: ["system"],
    requiresPermission: "settings:manage_roles",
    readOnly: true,
    affects: "informational only in this pass",
  },
];
