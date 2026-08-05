const assert = require("node:assert/strict");
const test = require("node:test");
const router = require("../compliance.routes");

function routes() {
  return router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));
}

test("compliance routes are all registered", () => {
  const registered = routes();
  [
    "GET /disclaimer",
    "POST /disclaimer/accept",
    "POST /lint",
  ].forEach((route) => assert.ok(registered.includes(route), `${route} is missing`));
});

test("/disclaimer requires no authentication middleware at all", () => {
  const layer = router.stack.find((l) => l.route?.path === "/disclaimer" && l.route.methods.get);
  const handlerNames = layer.route.stack.map((s) => s.name);
  assert.ok(!handlerNames.includes("authenticate"), "/disclaimer must be public");
});

test("/disclaimer/accept uses the local softAuthenticate helper, not the hard authenticate gate", () => {
  const layer = router.stack.find((l) => l.route?.path === "/disclaimer/accept");
  const handlerNames = layer.route.stack.map((s) => s.name);
  assert.ok(!handlerNames.includes("authenticate"), "/disclaimer/accept must stay reachable without a token");
  assert.ok(handlerNames.includes("softAuthenticate"), "/disclaimer/accept should still try to attach req.user when a token IS present");
});

test("/lint requires authentication and staff-role authorization", () => {
  const layer = router.stack.find((l) => l.route?.path === "/lint");
  const handlerNames = layer.route.stack.map((s) => s.name);
  assert.ok(handlerNames.includes("authenticate"), "/lint must require authentication");
});
