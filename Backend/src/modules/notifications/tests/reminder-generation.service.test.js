const assert = require("node:assert/strict");
const test = require("node:test");

const service = require("../reminder-generation.service");
const routes = require("../../../routes");

function mountedPaths() {
  return routes.stack
    .filter((layer) => layer.name === "router")
    .map((layer) => layer.regexp?.toString?.() || "");
}

test("reminder date windows target one calendar day", () => {
  const now = new Date("2026-07-01T12:00:00.000Z");
  const window = service.dateWindow(7, now);
  assert.equal(window.$gte.getFullYear(), 2026);
  assert.equal(window.$gte.getMonth(), 6);
  assert.equal(window.$gte.getDate(), 8);
  assert.equal(window.$gte.getHours(), 0);
  assert.equal(window.$lte.getHours(), 23);
});

test("reminder day calculations support future and overdue dates", () => {
  const now = new Date("2026-07-01T10:00:00.000Z");
  assert.equal(service.daysUntil("2026-07-08", now), 7);
  assert.equal(service.daysUntil("2026-06-30", now), -1);
  assert.equal(service.daysUntil("invalid", now), null);
});

test("shared backend no longer mounts cross-backend synchronization APIs", () => {
  const mounts = mountedPaths().join("\n");
  assert.doesNotMatch(mounts, /sync/i);
});
