const assert = require("node:assert/strict");
const test = require("node:test");
const { isDemoSeedAllowed, assertDemoSeedAllowed } = require("../demoSeedGuard");

test("isDemoSeedAllowed allows non-production environments regardless of the override", () => {
  assert.equal(isDemoSeedAllowed({ NODE_ENV: "development" }), true);
  assert.equal(isDemoSeedAllowed({ NODE_ENV: "test" }), true);
  assert.equal(isDemoSeedAllowed({}), true, "undefined NODE_ENV must not be treated as production");
});

test("isDemoSeedAllowed blocks production without ALLOW_DEMO_SEED", () => {
  assert.equal(isDemoSeedAllowed({ NODE_ENV: "production" }), false);
});

test("isDemoSeedAllowed only accepts the exact string \"true\" as an override", () => {
  assert.equal(isDemoSeedAllowed({ NODE_ENV: "production", ALLOW_DEMO_SEED: "1" }), false);
  assert.equal(isDemoSeedAllowed({ NODE_ENV: "production", ALLOW_DEMO_SEED: "yes" }), false);
  assert.equal(isDemoSeedAllowed({ NODE_ENV: "production", ALLOW_DEMO_SEED: "false" }), false);
});

test("isDemoSeedAllowed allows production when ALLOW_DEMO_SEED=true", () => {
  assert.equal(isDemoSeedAllowed({ NODE_ENV: "production", ALLOW_DEMO_SEED: "true" }), true);
});

test("assertDemoSeedAllowed logs and exits when blocked, without throwing", () => {
  let exitCode = null;
  let loggedError = null;
  assertDemoSeedAllowed(
    { NODE_ENV: "production" },
    { logger: { error: (message) => { loggedError = message; } }, exit: (code) => { exitCode = code; } }
  );
  assert.equal(exitCode, 1);
  assert.ok(loggedError && loggedError.includes("production"));
});

test("assertDemoSeedAllowed does nothing when allowed", () => {
  let exitCalled = false;
  let loggedCalled = false;
  assertDemoSeedAllowed(
    { NODE_ENV: "development" },
    { logger: { error: () => { loggedCalled = true; } }, exit: () => { exitCalled = true; } }
  );
  assert.equal(exitCalled, false);
  assert.equal(loggedCalled, false);
});
