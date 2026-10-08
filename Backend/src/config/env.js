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

// Guard: in production, local storage is forbidden - client immigration
// documents (passports, petitions, personal data) must never be stored on
// the application server's own filesystem. Added after a 2026-09 audit found
// months of orphaned local files (from deleted cases and stale test runs)
// that had accumulated in Backend/storage and Backend/uploads despite S3
// already being configured — this fails the boot outright instead of
// allowing that class of drift to reoccur silently.
if (storageProvider === "local" && process.env.NODE_ENV === "production") {
  throw new Error(
    "STORAGE_PROVIDER=local is not allowed in production. " +
    "Set STORAGE_PROVIDER=s3 and configure AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION."
  );
}

const env = {
  nodeEnv,
  port: process.env.PORT || 7000,
  // Dev/testing-phase guard: real case managers, team leads, admins, and
  // attorneys are real people with real inboxes, and every case/task/
  // notification created while testing this app was otherwise emailing them
  // for real. Client-facing emails still send normally — only team-member
  // and attorney recipients are suppressed. Off by default - team-member and
  // attorney emails go to the real recipients. Set
  // EMAIL_SUPPRESS_STAFF_AND_ATTORNEY=true to hold them back again;
  // does not touch which templates exist or which code paths call them —
  // see email.service.js's sendTemplateEmail(), which is the one place this
  // is enforced.
  emailSuppressStaffAndAttorney: process.env.EMAIL_SUPPRESS_STAFF_AND_ATTORNEY === "true",
  mongoUri: process.env.MONGODB_URI || "mongodb://localhost:27017/immigration_crm",
  clientOrigins: configuredOrigins,
  jwtAccessSecret: jwtAccessSecret || "dev-access-secret-change-me",
  jwtRefreshSecret: jwtRefreshSecret || "dev-refresh-secret-change-me",
  // jwt.sign throws on an empty or whitespace-only expiresIn. A blank dotenv
  // assignment (JWT_ACCESS_EXPIRES= or JWT_ACCESS_EXPIRES= ) produces "" or
  // " " respectively. "" is falsy so || catches it, but " " is truthy and
  // passes through, then jwt.sign rejects it with a 500. Trimming before the
  // fallback check catches both cases.
  jwtAccessExpires: (process.env.JWT_ACCESS_EXPIRES || process.env.JWT_EXPIRE || "").trim() || "7d",
  jwtRefreshExpires: (process.env.JWT_REFRESH_EXPIRES || "").trim() || "7d",
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
  // GoHighLevel integration (integrations/ghl). Off unless GHL_ENABLED=true,
  // so a missing/placeholder token can never affect boot or any other feature.
  ghl: {
    enabled: process.env.GHL_ENABLED === "true",
    token: process.env.GHL_PRIVATE_INTEGRATION_TOKEN || "",
    locationId: process.env.GHL_LOCATION_ID || "",
    baseUrl: process.env.GHL_API_BASE_URL || "https://services.leadconnectorhq.com",
    apiVersion: process.env.GHL_API_VERSION || "2021-07-28",
    // Exact GHL pipeline names that make up the unified board.
    // Pipelines are matched by ID when set, otherwise by exact name.
    immigrantPipelineId: (process.env.GHL_IMMIGRANT_PIPELINE_ID || "").trim(),
    nonImmigrantPipelineId: (process.env.GHL_NON_IMMIGRANT_PIPELINE_ID || "").trim(),
    immigrantPipelineName: process.env.GHL_IMMIGRANT_PIPELINE_NAME || "Immigrant Documentation pipeline",
    nonImmigrantPipelineName: process.env.GHL_NON_IMMIGRANT_PIPELINE_NAME || "Non-Immigrant Documentation pipeline",
    // GHL's OFFICIAL Ed25519 public key (PEM or bare base64 SPKI) used to verify
    // X-GHL-Signature. Never an Immiglance-generated key.
    webhookPublicKey: process.env.GHL_WEBHOOK_PUBLIC_KEY || "",
    // Informational: the URL configured in GHL (shown on the setup/health views).
    webhookPublicUrl: process.env.GHL_WEBHOOK_PUBLIC_URL || "",
    webhookToleranceSeconds: Number(process.env.GHL_WEBHOOK_TOLERANCE_SECONDS || 86400),
    // Historical opportunities imported by "Sync now" never send emails unless
    // this is explicitly turned on.
    importSendsEmails: process.env.GHL_IMPORT_SENDS_EMAILS === "true",
  },
  redisUrl: process.env.REDIS_URL || null,
  qpdfPath: process.env.QPDF_PATH || "qpdf",
  adobe: {
    clientId: process.env.ADOBE_PDF_SERVICES_CLIENT_ID || "",
    clientSecret: process.env.ADOBE_PDF_SERVICES_CLIENT_SECRET || "",
    baseUrl: process.env.ADOBE_PDF_SERVICES_BASE_URL || "https://pdf-services-ue1.adobe.io",
    // Default OFF - the official download uses the built-in pdf-lib engine,
    // which takes ~5-15s per form. The Adobe engine measured 20-55s per form
    // (and times out on large/sliced forms), so it is opt-in: set
    // ADOBE_PDF_FILL_ENABLED=true to try it first. Even then a download
    // never fails because of it - see OfficialFormDownloadService.js, which
    // falls back to pdf-lib after ADOBE_DOWNLOAD_TIMEOUT_MS.
    fillEnabled: process.env.ADOBE_PDF_FILL_ENABLED === "true",
  },
};

module.exports = env;
