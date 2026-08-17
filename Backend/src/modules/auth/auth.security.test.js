const test = require("node:test");
const assert = require("node:assert/strict");
const { authPayload } = require("./auth.service");

test("authentication payload never returns a refresh token", () => {
  const payload = authPayload({ toAuthJSON: () => ({ _id: "user-id", role: "client" }) }, "access-token", "refresh-token");
  assert.equal(payload.accessToken, "access-token");
  assert.equal(payload.refreshToken, undefined);
  assert.equal(payload.user.role, "client");
});

// ── Production OAuth-redirect safety (env.js clientUrlSafe/oauthRedirectUriSafe) ──
// Re-requires env.js with a controlled process.env for each case, since it
// resolves everything once at module-load time. Restores process.env and
// busts the require cache afterward so later tests in this file (or the
// wider `node --test` run) always see a fresh, correctly-configured module.
const ENV_KEYS = ["NODE_ENV", "CLIENT_URL", "CLIENT_URLS", "ALLOWED_ORIGINS", "GOOGLE_OAUTH_REDIRECT_URI", "MONGODB_URI", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"];
const ENV_PATH = require.resolve("../../config/env");

function withEnvVars(vars, fn) {
  const saved = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  // Set every tracked key explicitly (to "" when the test wants it
  // "unset") rather than deleting it — dotenv.config() (called inside
  // env.js on every re-require below) only fills in keys that are
  // genuinely absent from process.env, so a deleted key would get
  // silently refilled from the real Backend/.env file instead of staying
  // unset for this test.
  for (const key of ENV_KEYS) process.env[key] = vars[key] !== undefined ? vars[key] : "";
  delete require.cache[ENV_PATH];
  try {
    return fn(require(ENV_PATH));
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    delete require.cache[ENV_PATH];
  }
}

const PROD_REQUIRED = { MONGODB_URI: "mongodb://x/y", JWT_ACCESS_SECRET: "a", JWT_REFRESH_SECRET: "b" };

test("production: valid HTTPS clientUrl/oauthRedirectUri resolve safe", () => {
  withEnvVars(
    { ...PROD_REQUIRED, NODE_ENV: "production", CLIENT_URL: "https://client.example.com", GOOGLE_OAUTH_REDIRECT_URI: "https://client.example.com/api/auth/google/callback" },
    (env) => {
      assert.equal(env.clientUrlSafe, true);
      assert.equal(env.google.oauthRedirectUriSafe, true);
    }
  );
});

test("production: explicit localhost GOOGLE_OAUTH_REDIRECT_URI is rejected even with a safe CLIENT_URL", () => {
  withEnvVars(
    { ...PROD_REQUIRED, NODE_ENV: "production", CLIENT_URL: "https://client.example.com", GOOGLE_OAUTH_REDIRECT_URI: "http://localhost:7000/api/auth/google/callback" },
    (env) => {
      assert.equal(env.clientUrlSafe, true);
      assert.equal(env.google.oauthRedirectUriSafe, false);
    }
  );
});

test("production: non-HTTPS (but non-localhost) GOOGLE_OAUTH_REDIRECT_URI is rejected", () => {
  withEnvVars(
    { ...PROD_REQUIRED, NODE_ENV: "production", CLIENT_URL: "https://client.example.com", GOOGLE_OAUTH_REDIRECT_URI: "http://client.example.com/api/auth/google/callback" },
    (env) => {
      assert.equal(env.google.oauthRedirectUriSafe, false);
    }
  );
});

test("production: missing GOOGLE_OAUTH_REDIRECT_URI resolves unsafe, not a localhost default", () => {
  withEnvVars(
    { ...PROD_REQUIRED, NODE_ENV: "production", CLIENT_URL: "https://client.example.com" },
    (env) => {
      assert.equal(env.google.oauthRedirectUri, "");
      assert.equal(env.google.oauthRedirectUriSafe, false);
    }
  );
});

test("production: non-HTTPS production CLIENT_URL is rejected (already caught by the pre-existing CORS boot guard, throws before clientUrlSafe is even reached)", () => {
  assert.throws(() => {
    withEnvVars(
      { ...PROD_REQUIRED, NODE_ENV: "production", CLIENT_URL: "http://client.example.com", GOOGLE_OAUTH_REDIRECT_URI: "https://client.example.com/api/auth/google/callback" },
      (env) => env
    );
  }, /Missing required production configuration/);
});

test("production: missing CLIENT_URL/CLIENT_URLS entirely throws at boot (existing guard)", () => {
  assert.throws(() => {
    withEnvVars({ ...PROD_REQUIRED, NODE_ENV: "production" }, (env) => env);
  }, /Missing required production configuration/);
});

test("development: unset vars fall back to the same localhost defaults as before", () => {
  withEnvVars({ NODE_ENV: "development" }, (env) => {
    assert.equal(env.clientUrl, "http://localhost:5173");
    assert.equal(env.clientUrlSafe, true);
    assert.equal(env.google.oauthRedirectUri, "http://localhost:7000/api/auth/google/callback");
    assert.equal(env.google.oauthRedirectUriSafe, true);
  });
});

// ── auth.controller.js: refuses to redirect/generate an auth URL when either flag is unsafe ──
test("googleOAuthStart returns 503 CLIENT_URL_MISCONFIGURED when clientUrlSafe is false in production, without redirecting", () => {
  const ctrl = require("./auth.controller");
  const env = require("../../config/env");
  const originalNodeEnv = env.nodeEnv;
  const originalClientUrlSafe = env.clientUrlSafe;
  env.nodeEnv = "production";
  env.clientUrlSafe = false;
  try {
    let statusCode;
    let jsonBody;
    let redirected = false;
    const res = {
      status(code) { statusCode = code; return this; },
      json(body) { jsonBody = body; return this; },
      redirect() { redirected = true; },
      cookie() { return this; },
    };
    ctrl.googleOAuthStart({}, res);
    assert.equal(redirected, false);
    assert.equal(statusCode, 503);
    assert.equal(jsonBody.code, "CLIENT_URL_MISCONFIGURED");
  } finally {
    env.nodeEnv = originalNodeEnv;
    env.clientUrlSafe = originalClientUrlSafe;
  }
});

test("googleOAuthStart returns 503 CLIENT_URL_MISCONFIGURED when oauthRedirectUriSafe is false in production, without redirecting", () => {
  const ctrl = require("./auth.controller");
  const env = require("../../config/env");
  const originalNodeEnv = env.nodeEnv;
  const originalSafe = env.google.oauthRedirectUriSafe;
  env.nodeEnv = "production";
  env.google.oauthRedirectUriSafe = false;
  try {
    let statusCode;
    let jsonBody;
    let redirected = false;
    const res = {
      status(code) { statusCode = code; return this; },
      json(body) { jsonBody = body; return this; },
      redirect() { redirected = true; },
      cookie() { return this; },
    };
    ctrl.googleOAuthStart({}, res);
    assert.equal(redirected, false);
    assert.equal(statusCode, 503);
    assert.equal(jsonBody.code, "CLIENT_URL_MISCONFIGURED");
  } finally {
    env.nodeEnv = originalNodeEnv;
    env.google.oauthRedirectUriSafe = originalSafe;
  }
});

test("googleOAuthStart still redirects normally when both flags are safe (regression check)", () => {
  const ctrl = require("./auth.controller");
  const env = require("../../config/env");
  const originalNodeEnv = env.nodeEnv;
  const originalClientUrlSafe = env.clientUrlSafe;
  const originalOauthSafe = env.google.oauthRedirectUriSafe;
  env.nodeEnv = "production";
  env.clientUrlSafe = true;
  env.google.oauthRedirectUriSafe = true;
  try {
    let redirectedTo;
    const res = {
      status() { return this; },
      json() { return this; },
      redirect(url) { redirectedTo = url; },
      cookie() { return this; },
    };
    ctrl.googleOAuthStart({}, res);
    assert.ok(redirectedTo, "expected googleOAuthStart to redirect");
  } finally {
    env.nodeEnv = originalNodeEnv;
    env.clientUrlSafe = originalClientUrlSafe;
    env.google.oauthRedirectUriSafe = originalOauthSafe;
  }
});
