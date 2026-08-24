const assert = require("node:assert/strict");
const test = require("node:test");
const router = require("../uscis-form.routes");

function registeredRoutes() {
  return router.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods).filter((method) => layer.route.methods[method]),
    }));
}

test("interactive USCIS review endpoints are registered", () => {
  const routes = registeredRoutes();
  const expected = [
    ["get", "/case/:caseId/:formId/workspace"],
    ["patch", "/case/:caseId/:formId/workspace/field"],
    ["put", "/case/:caseId/:formId/workspace/section"],
    ["post", "/case/:caseId/:formId/workspace/field/review"],
    ["post", "/case/:caseId/:formId/workspace/section/review"],
    ["post", "/case/:caseId/:formId/workspace/decision"],
    ["post", "/case/:caseId/:formId/workspace/lock"],
    ["post", "/case/:caseId/:formId/workspace/refresh"],
    ["post", "/case/:caseId/:formId/workspace/reset"],
    ["post", "/case/:caseId/:formId/workspace/conflict"],
    ["post", "/case/:caseId/:formId/workspace/field/resolve-conflict"],
    ["get", "/case/:caseId/:formId/workspace/comparison"],
    ["get", "/case/:caseId/:formId/workspace/search"],
    ["get", "/registry"],
    ["get", "/registry/:formCode/versions"],
    ["get", "/case/:caseId/:formId/validation"],
    ["get", "/case/:caseId/:formId/comparison"],
    ["put", "/:id/approve"],
    ["put", "/:id/activate"],
  ];

  expected.forEach(([method, path]) => {
    assert.ok(routes.some((route) => route.path === path && route.methods.includes(method)), `${method.toUpperCase()} ${path} is missing`);
  });
});

test("Phase 3 §J.4: resolve-field-conflict's auth middleware chain matches saveInteractiveField's", () => {
  const middlewareNames = (path, method) => router.stack
    .filter((layer) => layer.route?.path === path && layer.route.methods[method])
    .flatMap((layer) => layer.route.stack.map((item) => item.handle.name));

  const saveFieldChain = middlewareNames("/case/:caseId/:formId/workspace/field", "patch");
  const resolveFieldConflictChain = middlewareNames("/case/:caseId/:formId/workspace/field/resolve-conflict", "post");

  assert.ok(saveFieldChain.length >= 2, "expected saveInteractiveField to have at least authenticate + authorizePermissions in its chain");
  // Same middleware FUNCTIONS (authenticate, authorizePermissions("forms:update")) in the same
  // order, minus the final route handler itself (last entry in each chain).
  assert.deepEqual(resolveFieldConflictChain.slice(0, -1), saveFieldChain.slice(0, -1));
});
