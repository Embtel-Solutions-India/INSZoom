// Phase H3 AC8 (partial) - the generate/download/preview endpoints the
// INSZoom USCISForms Generate/Download/Preview controls call are actually
// registered with the expected method+path and wired to the right
// controller function. DB-free route-table introspection (same pattern as
// uscis-forms/tests/interactive-form-review.routes.test.js) rather than a
// full authenticated HTTP round-trip.
const assert = require("node:assert/strict");
const test = require("node:test");
const router = require("../routes/formGenerationRoutes");
const controller = require("../controllers/FormGenerationController");

function registeredRoutes() {
  return router.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods).filter((method) => layer.route.methods[method]),
      handler: layer.route.stack[layer.route.stack.length - 1].handle,
    }));
}

test("AC8 - generate/download/preview/approve/regenerate endpoints are registered and wired to PDFGenerationService", () => {
  const routes = registeredRoutes();
  const expected = [
    ["post", "/:caseFormId/generate", controller.generate],
    ["get", "/:caseFormId/preview", controller.preview],
    ["get", "/:caseFormId/download", controller.download],
    ["post", "/:caseFormId/approve", controller.approve],
    ["post", "/:caseFormId/regenerate", controller.regenerate],
    // Phase 5 (§I.4) - the new clean filing-copy download route.
    ["get", "/:caseFormId/filing-pdf", controller.filingPdf],
  ];
  expected.forEach(([method, path, handler]) => {
    const match = routes.find((route) => route.path === path && route.methods.includes(method));
    assert.ok(match, `${method.toUpperCase()} ${path} is missing`);
    assert.equal(match.handler, handler, `${method.toUpperCase()} ${path} is wired to the wrong controller function`);
  });
});
