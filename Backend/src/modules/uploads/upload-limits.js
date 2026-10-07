// Single source of truth for checklist-row upload limits. Used by the multer
// middleware, the questionnaire answer-file path and the Document upload path
// so every checklist surface (questionnaire file questions AND the legacy
// document-baseline rows) enforces the same numbers.
const path = require("path");

const MAX_FILES_PER_ROW = 10;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
// A case manager's uploaded petition is a large scanned/compiled PDF - it gets
// its own, higher ceiling (200 MB) instead of the 50 MB checklist-row cap.
const PETITION_DOCUMENT_TYPE = "petition_manual_upload";
const PETITION_MAX_FILE_BYTES = 200 * 1024 * 1024;

function maxFileBytesFor(documentType) {
  return documentType === PETITION_DOCUMENT_TYPE ? PETITION_MAX_FILE_BYTES : MAX_FILE_BYTES;
}

// Safety posture: any file type is accepted EXCEPT things that execute or
// script on a victim machine. Deliberately an extension blocklist (the old
// MIME allowlist rejected HEIC/WebP/etc.). Content sniffing in
// file-security.service additionally rejects executables whatever the name.
const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".dll", ".msi", ".com", ".scr", ".pif", ".cpl", ".sys", ".drv",
  ".bat", ".cmd", ".ps1", ".psm1", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh", ".hta",
  ".jar", ".app", ".apk", ".ipa", ".dmg", ".pkg", ".deb", ".rpm", ".sh", ".bash", ".run", ".bin", ".reg", ".lnk", ".inf",
  ".html", ".htm", ".xhtml", ".svg",
]);

function limitError(message, statusCode, code) {
  const error = new Error(message);
  error.status = statusCode;
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function formatBytes(bytes) {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function isBlockedFileName(name = "") {
  // Check every dot-segment so "invoice.exe.pdf"-style tricks are judged by
  // the real final extension, but "photo.exe" is still blocked.
  const extension = path.extname(String(name)).toLowerCase();
  return BLOCKED_EXTENSIONS.has(extension);
}

function assertFileNameAllowed(name = "") {
  if (isBlockedFileName(name)) {
    throw limitError(`"${name}" is not an allowed file type. Executable and script files cannot be uploaded.`, 415, "BLOCKED_FILE_TYPE");
  }
}

function assertFileSize(file, documentType) {
  const size = file?.size ?? file?.buffer?.length ?? 0;
  const cap = maxFileBytesFor(documentType);
  if (size > cap) {
    throw limitError(`"${file?.originalname || "File"}" is larger than the ${formatBytes(cap)} limit per file.`, 413, "FILE_TOO_LARGE");
  }
}

// existingCount = files already stored on the row; incomingCount = files in
// this request. Counting against what is already stored is what makes the cap
// hold when entries are appended across separate requests.
function assertRowCapacity(existingCount, incomingCount) {
  if (existingCount + incomingCount > MAX_FILES_PER_ROW) {
    const remaining = Math.max(0, MAX_FILES_PER_ROW - existingCount);
    throw limitError(
      `A maximum of ${MAX_FILES_PER_ROW} files is allowed per document row. This row already has ${existingCount}${remaining ? `; you can add ${remaining} more` : " and cannot accept more"}.`,
      422,
      "ROW_FILE_LIMIT_EXCEEDED"
    );
  }
}

module.exports = {
  MAX_FILES_PER_ROW,
  MAX_FILE_BYTES,
  PETITION_MAX_FILE_BYTES,
  maxFileBytesFor,
  BLOCKED_EXTENSIONS,
  assertFileNameAllowed,
  assertFileSize,
  assertRowCapacity,
  formatBytes,
  isBlockedFileName,
  limitError,
};
