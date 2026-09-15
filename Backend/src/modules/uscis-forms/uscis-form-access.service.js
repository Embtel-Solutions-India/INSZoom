// Short-lived signed URLs for official USCIS form PDFs (spec §16/§22/§40).
//
// WHY NOT AN S3 PRESIGNED URL: objects in the bucket are written through
// storage.service's AES-256-GCM application envelope (see its encrypt()/
// ICRMENC1 header) whenever STORAGE_ENCRYPTION_KEY is set — which it is in
// this deployment. A raw S3 presigned URL therefore hands the browser
// ciphertext, not a PDF, and the only way to make one work would be shipping
// the storage encryption key to the client, which is strictly worse than the
// status quo. So the "signed URL" here is a backend-signed, single-purpose,
// expiring token bound to one template + one user, redeemed against this
// app's own streaming endpoint:
//
//   Private S3 → backend authorization → short-lived signed URL → authorized user
//
// which is the flow §16 actually specifies. The bucket stays private, no AWS
// credential ever reaches the browser, and the URL dies on its own.
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const env = require("../../config/env");

// Long enough to open a PDF viewer and for it to issue its Range requests,
// short enough that a leaked URL is near-worthless.
const DEFAULT_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 900;

const AUDIENCE = "uscis-form-pdf";

/**
 * Mint a signed, expiring grant for one template's PDF.
 * @param {object} params
 * @param {string} params.templateId
 * @param {object} params.user The authenticated requester.
 * @param {number} [params.ttlSeconds]
 * @returns {{token: string, expiresAt: Date, expiresInSeconds: number}}
 */
function createFormAccessToken({ templateId, user, ttlSeconds = DEFAULT_TTL_SECONDS }) {
  if (!templateId) throw new Error("templateId is required to mint a form access token");
  const ttl = Math.min(Math.max(Number(ttlSeconds) || DEFAULT_TTL_SECONDS, 30), MAX_TTL_SECONDS);
  const token = jwt.sign(
    {
      aud: AUDIENCE,
      templateId: String(templateId),
      userId: user?._id ? String(user._id) : null,
      // Distinguishes two grants minted in the same second for the same
      // template+user, so one can be revoked/traced in audit without
      // ambiguity (same reasoning as token.service.js's refresh jti).
      jti: crypto.randomBytes(12).toString("hex"),
    },
    env.jwtAccessSecret,
    { expiresIn: ttl }
  );
  return {
    token,
    expiresInSeconds: ttl,
    expiresAt: new Date(Date.now() + ttl * 1000),
  };
}

/**
 * Verify a grant and confirm it was minted for this exact template.
 * Throws a 401/403-shaped error on any failure — never reveals which of the
 * checks failed beyond expired-vs-invalid (spec §41).
 * @returns {{templateId: string, userId: string|null, jti: string}}
 */
function verifyFormAccessToken(token, templateId) {
  let payload;
  try {
    payload = jwt.verify(token, env.jwtAccessSecret, { audience: AUDIENCE });
  } catch (error) {
    const failure = new Error(
      error?.name === "TokenExpiredError"
        ? "This form link has expired. Please reopen the form."
        : "Invalid form access link."
    );
    failure.status = 401;
    throw failure;
  }
  if (String(payload.templateId) !== String(templateId)) {
    const mismatch = new Error("Invalid form access link.");
    mismatch.status = 403;
    throw mismatch;
  }
  return { templateId: payload.templateId, userId: payload.userId || null, jti: payload.jti };
}

module.exports = {
  AUDIENCE,
  DEFAULT_TTL_SECONDS,
  MAX_TTL_SECONDS,
  createFormAccessToken,
  verifyFormAccessToken,
};
