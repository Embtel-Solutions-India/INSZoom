const test = require("node:test");
const { mock } = require("node:test");
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

// ── auth.controller.js: googleOAuthCallback state validation (invalid_state investigation) ──
// This is the exact check that produces error=invalid_state in production.
// These tests prove the fix is a correctness fix (recognizing a mismatch
// state where it's currently not a real mismatch) and NOT a weakening of
// the validation itself - every rejection path here must keep rejecting.
function fakeCallbackRes() {
  const res = { cookiesCleared: [], locals: {} };
  res.cookie = () => res;
  res.clearCookie = (name) => { res.cookiesCleared.push(name); return res; };
  res.redirect = (url) => { res.redirectedTo = url; };
  return res;
}

function withSafeProdFlags(fn) {
  const env = require("../../config/env");
  const originalNodeEnv = env.nodeEnv;
  const originalClientUrlSafe = env.clientUrlSafe;
  const originalOauthSafe = env.google.oauthRedirectUriSafe;
  env.nodeEnv = "production";
  env.clientUrlSafe = true;
  env.google.oauthRedirectUriSafe = true;
  try {
    return fn(env);
  } finally {
    env.nodeEnv = originalNodeEnv;
    env.clientUrlSafe = originalClientUrlSafe;
    env.google.oauthRedirectUriSafe = originalOauthSafe;
  }
}

test("googleOAuthCallback rejects with invalid_state when no state cookie was ever sent back (cross-origin/token-scope loss), never establishes a session", async () => {
  await withSafeProdFlags(async () => {
    const ctrl = require("./auth.controller");
    const res = fakeCallbackRes();
    const req = { query: { code: "auth-code", state: "attacker-or-google-supplied-state" }, cookies: {}, headers: {} };
    await ctrl.googleOAuthCallback(req, res);
    assert.ok(res.redirectedTo, "expected a redirect");
    const url = new URL(res.redirectedTo);
    assert.equal(url.searchParams.get("error"), "invalid_state");
    assert.equal(url.searchParams.has("accessToken"), false, "must never issue a session token on a state mismatch");
  });
});

test("googleOAuthCallback rejects with invalid_state when the provided state does not match the cookie state, never establishes a session", async () => {
  await withSafeProdFlags(async () => {
    const ctrl = require("./auth.controller");
    const res = fakeCallbackRes();
    const req = { query: { code: "auth-code", state: "wrong-state" }, cookies: { google_oauth_state: "correct-state" }, headers: {} };
    await ctrl.googleOAuthCallback(req, res);
    const url = new URL(res.redirectedTo);
    assert.equal(url.searchParams.get("error"), "invalid_state");
    assert.equal(url.searchParams.has("accessToken"), false);
  });
});

test("googleOAuthCallback rejects with invalid_state when code or state is missing entirely", async () => {
  await withSafeProdFlags(async () => {
    const ctrl = require("./auth.controller");
    const res1 = fakeCallbackRes();
    await ctrl.googleOAuthCallback({ query: { state: "s" }, cookies: { google_oauth_state: "s" }, headers: {} }, res1);
    assert.equal(new URL(res1.redirectedTo).searchParams.get("error"), "invalid_state");

    const res2 = fakeCallbackRes();
    await ctrl.googleOAuthCallback({ query: { code: "c" }, cookies: { google_oauth_state: "s" }, headers: {} }, res2);
    assert.equal(new URL(res2.redirectedTo).searchParams.get("error"), "invalid_state");
  });
});

test("googleOAuthCallback establishes a session when the provided state matches the cookie state exactly (regression control — proves the check isn't just always failing)", async () => {
  await withSafeProdFlags(async () => {
    const ctrl = require("./auth.controller");
    const googleOAuthService = require("./google-oauth.service");
    const authService = require("./auth.service");
    const exchangeMock = mock.method(googleOAuthService, "exchangeCodeForIdentity", async () => ({ email: "user@example.com", displayName: "Test User" }));
    const loginMock = mock.method(authService, "loginWithVerifiedIdentity", async () => ({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      user: { _id: "u1", email: "user@example.com", role: "client" },
    }));
    try {
      const res = fakeCallbackRes();
      const req = { query: { code: "auth-code", state: "matching-state" }, cookies: { google_oauth_state: "matching-state" }, headers: {} };
      await ctrl.googleOAuthCallback(req, res);
      const url = new URL(res.redirectedTo);
      assert.equal(url.searchParams.has("error"), false, "must not error when state genuinely matches");
      assert.equal(url.searchParams.get("accessToken"), "access-token");
      assert.equal(url.searchParams.get("role"), "client");
    } finally {
      exchangeMock.mock.restore();
      loginMock.mock.restore();
    }
  });
});

test("googleOAuthCallback's invalid_state diagnostics log never includes the raw state or cookie value, only booleans/fingerprints", async () => {
  await withSafeProdFlags(async () => {
    const ctrl = require("./auth.controller");
    const logger = require("../../utils/logger");
    const warnMock = mock.method(logger, "warn", () => {});
    try {
      const res = fakeCallbackRes();
      const req = { query: { code: "auth-code", state: "wrong-state-xyz" }, cookies: { google_oauth_state: "correct-state-abc" }, headers: {} };
      await ctrl.googleOAuthCallback(req, res);
      assert.equal(warnMock.mock.calls.length, 1);
      const loggedPayload = JSON.stringify(warnMock.mock.calls[0].arguments[1]);
      assert.equal(loggedPayload.includes("wrong-state-xyz"), false, "must never log the raw provided state value");
      assert.equal(loggedPayload.includes("correct-state-abc"), false, "must never log the raw cookie state value");
    } finally {
      warnMock.mock.restore();
    }
  });
});
