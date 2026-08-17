require("dotenv").config();

const nodeEnv = process.env.NODE_ENV || "development";
const jwtAccessSecret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;
const configuredOrigins = (process.env.CLIENT_URLS || process.env.ALLOWED_ORIGINS || process.env.CLIENT_URL || "http://localhost:5173,http://localhost:3002")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (nodeEnv === "production") {
  const missing = [
    ["MONGODB_URI", process.env.MONGODB_URI],
    ["JWT_ACCESS_SECRET", jwtAccessSecret],
    ["JWT_REFRESH_SECRET", jwtRefreshSecret],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (!process.env.CLIENT_URLS && !process.env.ALLOWED_ORIGINS && !process.env.CLIENT_URL) missing.push("CLIENT_URLS");
  if (configuredOrigins.some((origin) => !/^https:\/\//i.test(origin) || /localhost|127\.0\.0\.1/i.test(origin))) {
    missing.push("production CLIENT_URLS must contain HTTPS non-local origins only");
  }
  if (missing.length) throw new Error(`Missing required production configuration: ${missing.join(", ")}`);
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
    provider: process.env.STORAGE_PROVIDER || "local",
    localPath: process.env.LOCAL_STORAGE_PATH,
    encryptionKeyConfigured: Boolean(process.env.STORAGE_ENCRYPTION_KEY),
  },
  stripe: {
    configured: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),
    apiVersion: process.env.STRIPE_API_VERSION,
  },
  documentIntelligence: {
    provider: process.env.DOCUMENT_INTELLIGENCE_PROVIDER || "gemini",
    configured: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
  },
  // Frontend origin to send the browser back to once the backend has
  // finished a redirect-based auth flow (e.g. Google OAuth's callback) — the
  // first entry in CLIENT_URLS/CLIENT_URL, same source of truth CORS itself
  // already reads, so this never drifts from the actual allowed frontend.
  clientUrl: process.env.CLIENT_URL || configuredOrigins[0] || "http://localhost:5173",
  google: {
    // Client ID/secret for the "Continue with Google" OAuth login button
    // (authorization-code flow) — distinct from the GOOGLE_SERVICE_ACCOUNT_*
    // credentials used by the Document AI provider. The client secret is
    // read here only; it must never be sent to the frontend.
    oauthClientId: process.env.GOOGLE_CLIENT_ID || "",
    oauthClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    oauthRedirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI || "",
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
