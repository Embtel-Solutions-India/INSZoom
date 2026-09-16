const { z } = require("zod");

// §4.10 Feature Flags / Modules. Enforced by middleware/requireFeature.js
// (backend route gating) and the frontend's useFeatureFlag hook (nav/route
// hiding). Every flag defaults to true so no existing install loses access
// on migration.
const MODULES = ["leads", "questionnaires", "formsPipeline", "petitionAssembly", "payments", "analytics", "aiCopilot"];

module.exports = MODULES.map((moduleKey) => ({
  key: `modules.${moduleKey}.enabled`,
  category: "modules",
  group: "Feature flags",
  label: `${moduleKey.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())} module enabled`,
  type: "boolean",
  default: true,
  validation: z.boolean(),
  scopes: ["system"],
  requiresPermission: "settings:manage_modules",
  affects: "middleware/requireFeature.js + frontend useFeatureFlag",
}));

module.exports.MODULES = MODULES;
