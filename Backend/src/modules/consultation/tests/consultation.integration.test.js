const assert = require("node:assert/strict");
const test = require("node:test");
const router = require("../consultation.routes");

function routes() {
  return router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));
}

test("consultation routes are all registered", () => {
  const registered = routes();
  [
    "GET /config", "GET /slots", "POST /book",
    "GET /booking/:token", "POST /booking/:token/reschedule", "POST /booking/:token/cancel",
    "GET /admin/availability", "PUT /admin/availability",
  ].forEach((route) => assert.ok(registered.includes(route), `${route} is missing`));
});

test("public prospect-facing routes carry no authenticate middleware", () => {
  ["/config", "/slots", "/book", "/booking/:token", "/booking/:token/reschedule", "/booking/:token/cancel"].forEach((path) => {
    const layer = router.stack.find((l) => l.route?.path === path);
    const handlerNames = layer.route.stack.map((s) => s.name);
    assert.ok(!handlerNames.includes("authenticate"), `${path} must be public (token-authorized, not account-authorized)`);
  });
});

test("admin availability routes require authentication", () => {
  ["/admin/availability"].forEach((path) => {
    const layers = router.stack.filter((l) => l.route?.path === path);
    layers.forEach((layer) => {
      const handlerNames = layer.route.stack.map((s) => s.name);
      assert.ok(handlerNames.includes("authenticate"), `${path} must require authentication`);
    });
  });
});
