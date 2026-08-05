const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CANONICAL_STATUSES,
  DEFAULT_BRAND_TOKENS,
  mapLegacyStatus,
} = require("../entityConfig.constants");
const { FALLBACK_DISCLAIMER_TEMPLATE, FALLBACK_DISCLAIMER_UNCONFIGURED_FIRM_CLAUSE } = require("../../compliance/compliance.constants");

// DB-backed behavior (resolveDisclaimer/resolveProhibitedTerms/updateConfig
// against a real Settings singleton, cache-busting on write) is covered by
// live verification against the running dev backend rather than here — this
// repo's own test convention (see cases/tests/case-lifecycle-routes.test.js,
// family-workflow/tests/family-workflow.test.js) is pure-logic/no-DB
// `node --test` files, since `npm test` has no DB connection or mocking
// layer wired up. These tests cover everything reachable without Mongo.

test("canonical status vocabulary has exactly 6 entries with the documented keys", () => {
  const keys = CANONICAL_STATUSES.map((s) => s.key);
  assert.equal(CANONICAL_STATUSES.length, 6);
  assert.deepEqual(keys, ["complete", "in_progress", "action_required", "critical", "informational", "not_started"]);
});

test("every canonical status carries a colorToken and a non-empty appliesTo list", () => {
  CANONICAL_STATUSES.forEach((status) => {
    assert.ok(status.colorToken, `${status.key} missing colorToken`);
    assert.ok(Array.isArray(status.appliesTo) && status.appliesTo.length > 0, `${status.key} missing appliesTo`);
  });
});

test("mapLegacyStatus covers all 5 existing frontend states with no breakage", () => {
  assert.equal(mapLegacyStatus("not_started"), "not_started");
  assert.equal(mapLegacyStatus("in_progress"), "in_progress");
  assert.equal(mapLegacyStatus("under_review"), "in_progress");
  assert.equal(mapLegacyStatus("verified"), "complete");
  assert.equal(mapLegacyStatus("needs_attention"), "critical");
});

test("mapLegacyStatus falls back to not_started for an unrecognized legacy value", () => {
  assert.equal(mapLegacyStatus("some_future_status_nobody_invented_yet"), "not_started");
  assert.equal(mapLegacyStatus(undefined), "not_started");
});

test("every mapped canonical value is itself a real canonical status key", () => {
  const canonicalKeys = new Set(CANONICAL_STATUSES.map((s) => s.key));
  ["not_started", "in_progress", "under_review", "verified", "needs_attention"].forEach((legacy) => {
    assert.ok(canonicalKeys.has(mapLegacyStatus(legacy)), `mapLegacyStatus("${legacy}") must map onto a real canonical key`);
  });
});

test("default brand tokens are valid hex colors", () => {
  assert.match(DEFAULT_BRAND_TOKENS.primaryColor, /^#[0-9a-fA-F]{6}$/);
  assert.match(DEFAULT_BRAND_TOKENS.accentColor, /^#[0-9a-fA-F]{6}$/);
});

test("fallback disclaimer templates never hardcode a real firm name and always carry the MSO placeholder", () => {
  assert.match(FALLBACK_DISCLAIMER_TEMPLATE, /\{msoEntityShortName\}/);
  assert.match(FALLBACK_DISCLAIMER_TEMPLATE, /\{lawFirmEntityName\}/);
  // The unconfigured-firm variant must never reference a firm-name
  // placeholder at all — it exists precisely to avoid interpolating "".
  assert.doesNotMatch(FALLBACK_DISCLAIMER_UNCONFIGURED_FIRM_CLAUSE, /\{lawFirmEntityName\}/);
  assert.match(FALLBACK_DISCLAIMER_UNCONFIGURED_FIRM_CLAUSE, /\{msoEntityShortName\}/);
});
