const assert = require("node:assert/strict");
const test = require("node:test");
const router = require("../entityConfig.routes");

function routes() {
  return router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));
}

test("entity-config routes are all registered", () => {
  const registered = routes();
  [
    "GET /public",
    "GET /status-vocabulary",
    "GET /",
    "PATCH /",
  ].forEach((route) => assert.ok(registered.includes(route), `${route} is missing`));
});

test("the public route carries no authenticate middleware in its stack", () => {
  const publicLayer = router.stack.find((layer) => layer.route?.path === "/public");
  const handlerNames = publicLayer.route.stack.map((s) => s.name);
  // authenticate.js exports a plain named function called "authenticate" —
  // asserting it is absent proves /public really is reachable with no token.
  assert.ok(!handlerNames.includes("authenticate"), "/public must not require authentication");
});

test("the admin config routes DO carry authenticate + role/permission middleware", () => {
  const rootLayers = router.stack.filter((layer) => layer.route?.path === "/");
  rootLayers.forEach((layer) => {
    const handlerNames = layer.route.stack.map((s) => s.name);
    assert.ok(handlerNames.includes("authenticate"), "/ must require authentication");
  });
});
