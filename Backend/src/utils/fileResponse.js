// Shared helpers for sending already-decrypted file bytes (storageService.readBuffer) to a browser.

const EXTENSION_TYPES = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".txt": "text/plain",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const GENERIC_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream", "application/download", "application/x-download"]);

function isPdf(buffer) {
  // The PDF spec allows junk before the header, but only within the first 1024 bytes.
  return Buffer.isBuffer(buffer) && buffer.subarray(0, 1024).includes("%PDF-");
}

// RFC 6266 header: an ASCII-only `filename` fallback plus a UTF-8 `filename*`. Interpolating the raw name made Node throw
// ERR_INVALID_CHAR (HTTP 500) for any name with a character above U+00FF (an en dash, a non-English name) and let a `"` break the header.
function contentDisposition(disposition, fileName) {
  const type = disposition === "inline" ? "inline" : "attachment";
  const raw = String(fileName || "").replace(/[\r\n]+/g, " ").trim() || "document";
  const fallback = raw.replace(/[^\x20-\x7e]/g, "_").replace(/["\\%]/g, "_");
  const encoded = encodeURIComponent(raw).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

// The bytes are authoritative: a PDF is always served as application/pdf (an upload recorded as octet-stream or application/x-pdf
// would otherwise download instead of rendering inline). Otherwise trust the stored type unless it is generic, then fall back to the extension.
function resolveContentType({ buffer, mimeType, fileName }) {
  if (isPdf(buffer)) return "application/pdf";
  const stored = String(mimeType || "").split(";")[0].trim().toLowerCase();
  if (!GENERIC_TYPES.has(stored)) return stored;
  const dot = String(fileName || "").lastIndexOf(".");
  return EXTENSION_TYPES[dot >= 0 ? fileName.slice(dot).toLowerCase() : ""] || "application/octet-stream";
}

function sendFile(res, { buffer, fileName, mimeType, disposition = "attachment" }) {
  res.setHeader("Content-Type", resolveContentType({ buffer, mimeType, fileName }));
  res.setHeader("Content-Disposition", contentDisposition(disposition, fileName));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(buffer);
}

module.exports = { contentDisposition, isPdf, resolveContentType, sendFile };
