const crypto = require("crypto");

// Verifies GHL's X-GHL-Signature: an Ed25519 signature (base64) over the EXACT
// raw request body bytes, checked with GHL's official PUBLIC key. We hold no
// private key for this; there is nothing of ours to leak or rotate.
//
// Callers must pass the raw Buffer, before any JSON parsing/re-serialising:
// re-encoding the JSON would change the bytes and break verification.

const keyCache = new Map();

// Accepts a PEM block (possibly with literal "\n" escapes from an .env file) or
// the bare base64 SPKI DER that GHL publishes. Throws unless it is Ed25519.
function loadPublicKey(raw) {
  const text = String(raw || "").trim().replace(/\\n/g, "\n");
  if (!text) throw new Error("GHL webhook public key is not configured");
  if (keyCache.has(text)) return keyCache.get(text);

  const key = text.includes("BEGIN PUBLIC KEY")
    ? crypto.createPublicKey(text)
    : crypto.createPublicKey({ key: Buffer.from(text.replace(/\s+/g, ""), "base64"), format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ed25519") throw new Error("GHL webhook public key must be an Ed25519 key");
  keyCache.set(text, key);
  return key;
}

// Returns { ok, reason }. Never throws on bad input: a malformed header or body
// is simply an invalid signature.
function verifyGhlSignature(rawBody, signatureHeader, publicKey) {
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) return { ok: false, reason: "empty_body" };
  if (!signatureHeader || typeof signatureHeader !== "string") return { ok: false, reason: "missing_signature" };

  let key;
  try {
    key = loadPublicKey(publicKey);
  } catch (error) {
    return { ok: false, reason: "bad_public_key", detail: error.message };
  }

  const signature = Buffer.from(signatureHeader.trim(), "base64");
  if (signature.length !== 64) return { ok: false, reason: "malformed_signature" };

  try {
    return crypto.verify(null, rawBody, key, signature) ? { ok: true } : { ok: false, reason: "signature_mismatch" };
  } catch {
    return { ok: false, reason: "verify_error" };
  }
}

module.exports = { verifyGhlSignature, loadPublicKey };
