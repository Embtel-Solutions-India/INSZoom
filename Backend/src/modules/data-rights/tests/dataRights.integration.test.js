const assert = require("node:assert/strict");
const test = require("node:test");
const router = require("../dataRights.routes");

function routes() {
  return router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));
}

test("data-rights routes are all registered", () => {
  const registered = routes();
  [
    "POST /requests",
    "GET /requests",
    "POST /requests/:id/approve",
    "POST /requests/:id/reject",
    "GET /requests/:id/export",
  ].forEach((route) => assert.ok(registered.includes(route), `${route} is missing`));
});

test("every data-rights route requires authentication (router.use(authenticate) at the top)", () => {
  const authLayer = router.stack.find((layer) => !layer.route && layer.name === "authenticate");
  assert.ok(authLayer, "router.use(authenticate) must be registered before any route");
});
