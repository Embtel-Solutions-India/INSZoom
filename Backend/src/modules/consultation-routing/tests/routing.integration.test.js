const assert = require("node:assert/strict");
const test = require("node:test");
const router = require("../routing.routes");

function routes() {
  return router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));
}

test("consultation-routing routes are all registered", () => {
  const registered = routes();
  ["GET /options", "POST /book", "GET /queue", "POST /queue/:id/claim"].forEach((route) =>
    assert.ok(registered.includes(route), `${route} is missing`));
});

test("/options and /book are public (no authenticate middleware)", () => {
  ["/options", "/book"].forEach((path) => {
    const layer = router.stack.find((l) => l.route?.path === path);
    const handlerNames = layer.route.stack.map((s) => s.name);
    assert.ok(!handlerNames.includes("authenticate"), `${path} must be public`);
  });
});

test("/queue and /queue/:id/claim require staff authentication", () => {
  ["/queue", "/queue/:id/claim"].forEach((path) => {
    const layer = router.stack.find((l) => l.route?.path === path);
    const handlerNames = layer.route.stack.map((s) => s.name);
    assert.ok(handlerNames.includes("authenticate"), `${path} must require authentication`);
  });
});
