const assert = require("node:assert/strict");
const test = require("node:test");
const quizRouter = require("../quiz.routes");
const adminRouter = require("../admin/quizAdmin.routes");

function routesOf(router) {
  return router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));
}

test("public quiz routes are all registered", () => {
  const registered = routesOf(quizRouter);
  ["GET /definition", "GET /visas", "POST /submit", "GET /leads", "GET /leads/:id"].forEach((route) =>
    assert.ok(registered.includes(route), `${route} is missing`));
});

test("/definition, /visas, /submit carry no authenticate middleware (genuinely public)", () => {
  ["/definition", "/visas", "/submit"].forEach((path) => {
    const layer = quizRouter.stack.find((l) => l.route?.path === path);
    const handlerNames = layer.route.stack.map((s) => s.name);
    assert.ok(!handlerNames.includes("authenticate"), `${path} must be public`);
  });
});

test("/leads and /leads/:id require authentication", () => {
  ["/leads", "/leads/:id"].forEach((path) => {
    const layer = quizRouter.stack.find((l) => l.route?.path === path);
    const handlerNames = layer.route.stack.map((s) => s.name);
    assert.ok(handlerNames.includes("authenticate"), `${path} must require authentication`);
  });
});

test("admin quiz-config routes are all registered", () => {
  const registered = routesOf(adminRouter);
  [
    "GET /scoring-config", "POST /scoring-config", "PUT /scoring-config/:id", "POST /scoring-config/:id/activate",
    "GET /quiz-definition", "POST /quiz-definition", "PUT /quiz-definition/:id", "POST /quiz-definition/:id/activate",
  ].forEach((route) => assert.ok(registered.includes(route), `${route} is missing`));
});

test("admin quiz-config routes require authentication (router.use(authenticate) at the top)", () => {
  const authLayer = adminRouter.stack.find((layer) => !layer.route && layer.name === "authenticate");
  assert.ok(authLayer, "router.use(authenticate) must be registered before any admin route");
});
