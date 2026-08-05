const assert = require("node:assert/strict");
const test = require("node:test");
const router = require("../case.routes");

function routes() {
  return router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));
}

test("case lifecycle workflow endpoints are registered", () => {
  const registered = routes();
  [
    "GET /:id/workflow",
    "GET /config",
    "POST /:id/workflow/recalculate",
    "POST /:id/workflow/generate-forms",
    "POST /:id/workflow/generate-package",
  ].forEach((route) => assert.ok(registered.includes(route), `${route} is missing`));
});
