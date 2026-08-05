const assert = require("node:assert/strict");
const test = require("node:test");
const router = require("../index");
const Settings = require("../../models/Settings");

// Regression net for Phase 0: proves the four new modules mounted without
// disturbing any pre-existing mount, and that every pre-Phase-0 Settings
// field/default is untouched. Schema introspection (Settings.schema.paths)
// needs no live DB connection, unlike an actual document round-trip — full
// read/write behavior against a real Settings singleton is covered by live
// verification against the running dev backend (see the Phase 0 report).

function mountedPrefixes() {
  return router.stack
    .filter((layer) => layer.regexp && layer.handle?.stack)
    .map((layer) => layer);
}

test("all four Phase 0 modules are mounted under /api", () => {
  // router.use("/x", subRouter) layers don't expose their literal path string
  // directly, but each carries a matching regexp we can probe with a sample URL.
  const testPaths = ["/compliance/disclaimer", "/entity-config/public", "/data-rights/requests", "/telemetry/track"];
  testPaths.forEach((path) => {
    const matched = mountedPrefixes().some((layer) => layer.regexp.test(path));
    assert.ok(matched, `no mounted router matches ${path}`);
  });
});

test("pre-existing critical mounts are still present (leads, audit, eligibility)", () => {
  const testPaths = ["/leads/public", "/audit/summary", "/eligibility/evaluate"];
  testPaths.forEach((path) => {
    const matched = mountedPrefixes().some((layer) => layer.regexp.test(path));
    assert.ok(matched, `pre-existing mount for ${path} is missing — a Phase 0 change may have broken routing`);
  });
});

test("every pre-existing Settings field keeps its original default (additive only, nothing removed/renamed)", () => {
  const paths = Settings.schema.paths;
  const expectDefault = (field, expected) => {
    assert.ok(paths[field], `Settings field "${field}" is missing`);
    assert.deepEqual(paths[field].defaultValue, expected, `Settings.${field}'s default changed`);
  };
  expectDefault("companyName", "BAIS");
  expectDefault("primaryColor", "#10b981");
  expectDefault("timezone", "America/New_York");
  expectDefault("dateFormat", "MM/DD/YYYY");
  expectDefault("sessionTimeout", 3600);
  expectDefault("auditLogRetentionDays", 90);
  expectDefault("firmAddress", "");
  expectDefault("firmPhone", "");
});

test("every new Phase 0 Settings field has a safe, additive default", () => {
  const paths = Settings.schema.paths;
  ["msoEntityName", "msoEntityShortName", "lawFirmEntityName", "lawFirmEntityShortName", "activeBrand", "nonAttorneyDisclaimer"].forEach((field) => {
    assert.ok(paths[field], `new Phase 0 field "${field}" is missing from the Settings schema`);
  });
  assert.equal(paths.lawFirmEntityName.defaultValue, "", "lawFirmEntityName must default to blank until founder-confirmed");
  assert.equal(paths.lawFirmIsConfigured.defaultValue, false);
  // Mongoose wraps array defaults in a factory function (to avoid a shared
  // reference across documents) rather than storing the literal array.
  const prohibitedTermsDefault = typeof paths.prohibitedTerms.defaultValue === "function"
    ? paths.prohibitedTerms.defaultValue()
    : paths.prohibitedTerms.defaultValue;
  assert.deepEqual(prohibitedTermsDefault, [], "prohibitedTerms must default to empty (fallback list is code-side)");
});
