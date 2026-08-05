const test = require("node:test");
const assert = require("node:assert/strict");
const router = require("./analytics.routes");

function roleMiddleware(path) {
  const route = router.stack.find((layer) => layer.route?.path === path)?.route;
  assert.ok(route, `${path} route is missing`);
  return route.stack[1].handle;
}

function runAuthorization(middleware, role) {
  let nextCalled = false;
  let responseStatus;
  const response = {
    status(status) {
      responseStatus = status;
      return this;
    },
    json() {
      return this;
    },
  };
  middleware({ user: { role } }, response, () => {
    nextCalled = true;
  });
  return { nextCalled, responseStatus };
}

test("payment analytics are limited to administrators and team leads", () => {
  for (const path of ["/payments", "/revenue"]) {
    const authorize = roleMiddleware(path);
    assert.equal(runAuthorization(authorize, "finance").responseStatus, 403);
    assert.equal(runAuthorization(authorize, "case_manager").responseStatus, 403);
    assert.equal(runAuthorization(authorize, "team_lead").nextCalled, true);
    assert.equal(runAuthorization(authorize, "admin").nextCalled, true);
    assert.equal(runAuthorization(authorize, "super_admin").nextCalled, true);
  }
});
