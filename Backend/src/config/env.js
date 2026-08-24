require("dotenv").config();

const nodeEnv = process.env.NODE_ENV || "development";
const jwtAccessSecret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;
const configuredOrigins = (process.env.CLIENT_URLS || process.env.ALLOWED_ORIGINS || process.env.CLIENT_URL || "http://localhost:5173,http://localhost:3002")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// Shared by the production boot guard below AND the runtime clientUrlSafe/
// oauthRedirectUriSafe flags further down — one definition of "unsafe" for
// any URL a production request could redirect a real browser to. Empty,
// non-HTTPS, or containing localhost/127.0.0.1 are all unsafe; this is
// checked against both bare origins (CORS) and full URLs (OAuth callback),
// since it only ever inspects the scheme prefix and host substring, not
// origin-vs-path shape.
function isUnsafeOrigin(value) {
  return !value || !/^https:\/\//i.test(value) || /localhost|127\.0\.0\.1/i.test(value);
}

// Admin Portal local-dev client, explicitly permitted to call the production
// backend's CORS-protected endpoints (e.g. /api/auth/refresh) for testing
// against real data. This is the only origin exempted from the production
// HTTPS/non-local guard below — it affects CORS admission only and never
// touches clientUrl/oauthRedirectUri, which keep their existing safety checks.
const CORS_LOCAL_DEV_EXCEPTIONS = ["http://localhost:3002","http://localhost:5173"];

if (nodeEnv === "production") {
  const missing = [
    ["MONGODB_URI", process.env.MONGODB_URI],
    ["JWT_ACCESS_SECRET", jwtAccessSecret],
    ["JWT_REFRESH_SECRET", jwtRefreshSecret],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (!process.env.CLIENT_URLS && !process.env.ALLOWED_ORIGINS && !process.env.CLIENT_URL) missing.push("CLIENT_URLS");
  if (configuredOrigins.some((origin) => isUnsafeOrigin(origin) && !CORS_LOCAL_DEV_EXCEPTIONS.includes(origin))) {
    missing.push("production CLIENT_URLS must contain HTTPS non-local origins only");
  }
  if (missing.length) throw new Error(`Missing required production configuration: ${missing.join(", ")}`);
}

// Frontend origin to send the browser back to once the backend has finished
// a redirect-based auth flow (e.g. Google OAuth's callback) — the first
// entry in CLIENT_URLS/CLIENT_URL, same source of truth CORS itself already
// reads, so this never drifts from the actual allowed frontend. The
// localhost default only applies outside production: in production, an
// unset value must never silently resolve to a plausible-looking wrong
// host — see clientUrlSafe below, which auth.controller.js's OAuth flow
// checks before ever redirecting a browser here.
const clientUrl = process.env.CLIENT_URL || configuredOrigins[0] || (nodeEnv === "production" ? "" : "http://localhost:5173");

// The backend's own Google OAuth callback URL, sent to Google as part of
// the authorization request. Independent of clientUrl — either can be
// unsafe on its own (e.g. GOOGLE_OAUTH_REDIRECT_URI explicitly left as a
// localhost value in a production deploy while CLIENT_URL is correctly set,
// or vice versa) so each gets its own *Safe flag rather than sharing one.
const oauthRedirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || (nodeEnv === "production" ? "" : "http://localhost:7000/api/auth/google/callback");

// File-storage config — storage.service.js's single provider switch reads
// all of this via env.storage rather than process.env directly, so both the
// "local" and "s3" branches share one source of truth. LOCAL_STORAGE_PATH/
// MAX_UPLOAD_SIZE_BYTES are this codebase's original names; UPLOAD_DIR/
// MAX_FILE_SIZE are accepted as a second name so an operator who only set
// the newer names doesn't silently keep hitting the old default.
const storageProvider = process.env.STORAGE_PROVIDER || "local";
const localStoragePath = process.env.LOCAL_STORAGE_PATH || process.env.UPLOAD_DIR || "";
const maxUploadSizeBytes = Number(process.env.MAX_UPLOAD_SIZE_BYTES || process.env.MAX_FILE_SIZE || 10 * 1024 * 1024);

if (storageProvider === "s3") {
  // Fail fast at boot, not on the first upload — a missing key/bucket/region
  // shouldn't surface as a confusing runtime error deep inside a request.
  const missingS3 = [
    ["AWS_S3_BUCKET", process.env.AWS_S3_BUCKET],
    ["AWS_ACCESS_KEY_ID", process.env.AWS_ACCESS_KEY_ID],
    ["AWS_SECRET_ACCESS_KEY", process.env.AWS_SECRET_ACCESS_KEY],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (missingS3.length) throw new Error(`STORAGE_PROVIDER=s3 requires: ${missingS3.join(", ")}`);
}

const env = {
  nodeEnv,
  port: process.env.PORT || 7000,
  mongoUri: process.env.MONGODB_URI || "mongodb://localhost:27017/immigration_crm",
  clientOrigins: configuredOrigins,
  jwtAccessSecret: jwtAccessSecret || "dev-access-secret-change-me",
  jwtRefreshSecret: jwtRefreshSecret || "dev-refresh-secret-change-me",
  jwtAccessExpires: process.env.JWT_ACCESS_EXPIRES || process.env.JWT_EXPIRE || "7d",
  jwtRefreshExpires: process.env.JWT_REFRESH_EXPIRES || "7d",
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS || 7),
  // The refresh cookie's SameSite policy depends on whether the deployed
  // frontend and backend share a registrable domain (subdomains are fine
  // with "lax") or are genuinely cross-site (a different domain entirely,
  // e.g. separate hosting platforms with no custom domain configured — "lax"
  // cookies are withheld on cross-site fetch/XHR, only sent on top-level
  // navigation). No production origin is recorded anywhere in this repo, so
  // this can't be determined from source — defaulting to the current "lax"
  // behavior preserves existing behavior; set REFRESH_COOKIE_SAMESITE=none
  // once the actual topology is confirmed (see refreshCookieDiagnostics in
  // auth.controller.js for log-based confirmation). "none" always implies
  // secure:true regardless of NODE_ENV, since browsers reject SameSite=None
  // cookies that aren't Secure.
  refreshCookieSameSite: (process.env.REFRESH_COOKIE_SAMESITE || "lax").toLowerCase(),
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 12),
  storage: {
    provider: storageProvider,
    localPath: localStoragePath,
    maxUploadSizeBytes,
    encryptionKeyConfigured: Boolean(process.env.STORAGE_ENCRYPTION_KEY),
    aws: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
      region: process.env.AWS_REGION || "us-east-1",
      bucket: process.env.AWS_S3_BUCKET || "",
      // Optional — only set for S3-compatible non-AWS providers (MinIO,
      // R2, etc). Left undefined for real AWS so the SDK uses its own
      // regional endpoint resolution.
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      // Server-side encryption applied on every PutObject, independent of
      // (and in addition to) the app-level AES-256-GCM envelope above when
      // STORAGE_ENCRYPTION_KEY is set — defense in depth, not a replacement.
      sse: process.env.S3_SSE || "AES256",
    },
  },
  stripe: {
    configured: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),
    apiVersion: process.env.STRIPE_API_VERSION,
  },
  documentIntelligence: {
    provider: process.env.DOCUMENT_INTELLIGENCE_PROVIDER || "gemini",
    configured: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
  },
  clientUrl,
  // True unless we are genuinely running in production with a clientUrl
  // that is missing or resolves to a non-HTTPS/local origin — computed once
  // at boot from the same values CORS (clientOrigins) already trusts, so it
  // can never drift out of sync. auth.controller.js's OAuth redirect flow
  // must refuse to redirect at all when this is false rather than send a
  // real user's browser to a dead localhost URL (see ensureSafeOAuthConfig).
  clientUrlSafe: nodeEnv !== "production" || !isUnsafeOrigin(clientUrl),
  google: {
    // Client ID/secret for the "Continue with Google" OAuth login button
    // (authorization-code flow) — distinct from the GOOGLE_SERVICE_ACCOUNT_*
    // credentials used by the Document AI provider. The client secret is
    // read here only; it must never be sent to the frontend.
    oauthClientId: process.env.GOOGLE_CLIENT_ID || "",
    oauthClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    oauthRedirectUri,
    // Same idea as clientUrlSafe, but for the URL sent to Google itself —
    // independently unsafe if GOOGLE_OAUTH_REDIRECT_URI is missing OR
    // explicitly set to a localhost/non-HTTPS value in production.
    oauthRedirectUriSafe: nodeEnv !== "production" || !isUnsafeOrigin(oauthRedirectUri),
    get oauthConfigured() {
      return Boolean(this.oauthClientId && this.oauthClientSecret && this.oauthRedirectUri);
    },
  },
  adminEmails: (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
  redisUrl: process.env.REDIS_URL || null,
  qpdfPath: process.env.QPDF_PATH || "qpdf",
};

module.exports = env;
