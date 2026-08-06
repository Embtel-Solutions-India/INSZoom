const OVERRIDE_ENV = "ALLOW_DEMO_SEED";

// Pure + injectable so tests can exercise it without mutating process.env.
function isDemoSeedAllowed(env = process.env) {
  if (env.NODE_ENV !== "production") return true;
  return env[OVERRIDE_ENV] === "true";
}

function assertDemoSeedAllowed(env = process.env, { logger = console, exit = process.exit } = {}) {
  if (isDemoSeedAllowed(env)) return;
  logger.error(
    "[seed] Refusing to run demo/seed data with NODE_ENV=production. These seeds create " +
      "fake users (with known passwords), clients, a company, and cases. Set ALLOW_DEMO_SEED=true to override."
  );
  exit(1);
}

module.exports = { isDemoSeedAllowed, assertDemoSeedAllowed, OVERRIDE_ENV };
