// Permanent case deletion: who may call it, and that the route is wired. Pure tests - no database.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { hasPermission } = require("../../authorization/rbac.service");

test("admin and team lead may delete cases; case manager, client and attorney may not", () => {
  for (const role of ["super_admin", "admin", "team_lead"]) assert.equal(hasPermission({ role }, "cases:delete"), true, role);
  for (const role of ["case_manager", "client", "employee", "attorney"]) assert.equal(hasPermission({ role }, "cases:delete"), false, role);
});

test("DELETE /cases/:id/permanent is registered for team leads and administrators only - never a case manager", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "case.routes.js"), "utf8");
  const line = routes.split("\n").find((entry) => entry.includes('"/:id/permanent"'));
  assert.ok(line, "route exists");
  assert.match(line, /authorizeRoles\("super_admin", "admin", "team_lead"\)/);
  assert.match(line, /deleteCasePermanently/);
});
