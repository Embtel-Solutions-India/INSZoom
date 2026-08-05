const test = require("node:test");
const assert = require("node:assert/strict");
const routes = require("../dashboard.routes");
const service = require("../dashboard.service");

test("all role dashboards are served by the central dashboard module", () => {
  const registered = routes.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods).join(",").toUpperCase()} ${layer.route.path}`);
  assert.ok(registered.some((route) => route.includes("/:dashboardType")));
  // updated: attorneyDashboard was consolidated into the generic roleDashboard
  // dispatcher (attorney collaboration descoped) — no per-role attorney function remains.
  assert.equal(typeof service.clientDashboard, "function");
  assert.equal(typeof service.roleDashboard, "function");
  assert.equal(typeof service.employerDashboard, "function");
});
