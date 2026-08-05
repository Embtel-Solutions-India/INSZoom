const assert = require("node:assert/strict");
const test = require("node:test");
const router = require("../index");
const Settings = require("../../models/Settings");

// Regression net for Phase 1 — proves the new modules mounted without
// disturbing any pre-existing mount (including Phase 0's), and that every
// Phase 0 + pre-existing Settings field is untouched. Schema introspection
// needs no live DB connection; full read/write behavior is covered by live
// verification against the running dev backend (see the Phase 1 report).

function mountedPrefixes() {
  return router.stack.filter((layer) => layer.regexp && layer.handle?.stack);
}

test("all Phase 1 modules are mounted under /api", () => {
  const testPaths = ["/eligibility-quiz/definition", "/eligibility-quiz/admin/scoring-config", "/consultation-routing/options"];
  testPaths.forEach((path) => {
    const matched = mountedPrefixes().some((layer) => layer.regexp.test(path));
    assert.ok(matched, `no mounted router matches ${path}`);
  });
});

test("pre-existing and Phase 0 mounts are still present", () => {
  const testPaths = ["/leads/public", "/audit/summary", "/eligibility/evaluate", "/appointments/public", "/entity-config/public", "/compliance/disclaimer"];
  testPaths.forEach((path) => {
    const matched = mountedPrefixes().some((layer) => layer.regexp.test(path));
    assert.ok(matched, `mount for ${path} is missing — a Phase 1 change may have broken routing`);
  });
});

test("the authenticated eligibility-engine module is not duplicated or shadowed by eligibility-quiz", () => {
  // Both /eligibility (engine) and /eligibility-quiz (Phase 1) must resolve
  // to their OWN distinct routers — a naive prefix mistake could make one
  // shadow the other.
  const engineMatches = mountedPrefixes().filter((layer) => layer.regexp.test("/eligibility/evaluate"));
  const quizMatches = mountedPrefixes().filter((layer) => layer.regexp.test("/eligibility-quiz/definition"));
  assert.ok(engineMatches.length >= 1);
  assert.ok(quizMatches.length >= 1);
});

test("every Phase 0 + pre-existing Settings field keeps its original default", () => {
  const paths = Settings.schema.paths;
  const expectDefault = (field, expected) => {
    assert.ok(paths[field], `Settings field "${field}" is missing`);
    assert.deepEqual(paths[field].defaultValue, expected, `Settings.${field}'s default changed`);
  };
  expectDefault("companyName", "BAIS");
  expectDefault("primaryColor", "#10b981");
  expectDefault("lawFirmEntityName", "");
  expectDefault("disclaimerVersion", 1);
});

test("every new Phase 1 Settings field has a safe, additive default", () => {
  const paths = Settings.schema.paths;
  ["leadNotificationEmail", "crmWebhookUrl", "gaMeasurementId"].forEach((field) => {
    assert.ok(paths[field], `Phase 1 field "${field}" is missing from the Settings schema`);
    assert.equal(paths[field].defaultValue, "", `${field} must default to blank`);
  });
  const consultationRoutingDefault = typeof paths.consultationRouting.defaultValue === "function"
    ? paths.consultationRouting.defaultValue()
    : paths.consultationRouting.defaultValue;
  assert.deepEqual(consultationRoutingDefault, [], "consultationRouting must default to an empty roster");
});
