const assert = require("node:assert/strict");
const test = require("node:test");
const router = require("../telemetry.routes");

function routes() {
  return router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));
}

test("telemetry routes are all registered", () => {
  const registered = routes();
  assert.ok(registered.includes("POST /track"));
  assert.ok(registered.includes("GET /summary"));
});

test("/track has no authenticate middleware (public ingest) but does carry a rate limiter", () => {
  const layer = router.stack.find((l) => l.route?.path === "/track");
  const handlerNames = layer.route.stack.map((s) => s.name);
  assert.ok(!handlerNames.includes("authenticate"), "/track must be public");
  assert.equal(layer.route.stack.length >= 2, true, "/track should have a rate-limit middleware ahead of the handler");
});

test("/summary requires authentication", () => {
  const layer = router.stack.find((l) => l.route?.path === "/summary");
  const handlerNames = layer.route.stack.map((s) => s.name);
  assert.ok(handlerNames.includes("authenticate"), "/summary must require authentication");
});
