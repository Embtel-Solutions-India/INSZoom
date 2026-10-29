const crypto = require("crypto");

// AES-256-GCM for small secrets stored in Mongo (e.g. Google refresh tokens). The key is passed in so each caller uses its own dedicated key.
// Format: "v1.<iv>.<tag>.<ciphertext>" (base64url). Fails closed: no key, no encryption, never plaintext.
function deriveKey(secret) {
  if (!secret || String(secret).length < 32) {
    const error = new Error("Encryption key is missing or shorter than 32 characters");
    error.code = "SECRET_KEY_INVALID";
    throw error;
  }
  return crypto.createHash("sha256").update(String(secret)).digest();
}

function encrypt(plaintext, secret) {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

function decrypt(payload, secret) {
  const key = deriveKey(secret);
  const [version, iv, tag, ct] = String(payload || "").split(".");
  if (version !== "v1" || !iv || !tag || !ct) {
    const error = new Error("Unrecognised encrypted value");
    error.code = "SECRET_FORMAT_INVALID";
    throw error;
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

module.exports = { encrypt, decrypt };
