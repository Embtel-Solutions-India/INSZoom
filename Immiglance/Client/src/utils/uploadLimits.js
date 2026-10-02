// Mirrors Backend/src/modules/uploads/upload-limits.js - the server is the
// authority; these exist so the UI can stop an over-limit upload before sending.
export const MAX_FILES_PER_ROW = 10;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

const BLOCKED_EXTENSIONS = new Set([
  "exe", "dll", "msi", "com", "scr", "pif", "cpl", "sys", "drv", "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js", "jse",
  "wsf", "wsh", "hta", "jar", "app", "apk", "ipa", "dmg", "pkg", "deb", "rpm", "sh", "bash", "run", "bin", "reg", "lnk", "inf",
  "html", "htm", "xhtml", "svg",
]);

export function formatBytes(bytes = 0) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

// Splits a picked/dropped file list into what may be uploaded and a single
// human-readable error for whatever was rejected (size, type, or row full).
export function planUpload(files, existingCount) {
  const accepted = [];
  const problems = [];
  const room = Math.max(0, MAX_FILES_PER_ROW - existingCount);
  for (const file of files) {
    const extension = (file.name.split(".").pop() || "").toLowerCase();
    if (file.name.includes(".") && BLOCKED_EXTENSIONS.has(extension)) {
      problems.push(`"${file.name}" is not an allowed file type (executables and scripts cannot be uploaded).`);
    } else if (file.size > MAX_FILE_BYTES) {
      problems.push(`"${file.name}" is ${formatBytes(file.size)} - the limit is ${formatBytes(MAX_FILE_BYTES)} per file.`);
    } else if (file.size === 0) {
      problems.push(`"${file.name}" is empty.`);
    } else if (accepted.length >= room) {
      problems.push(`Only ${MAX_FILES_PER_ROW} files are allowed per row - "${file.name}" was not added.`);
    } else {
      accepted.push(file);
    }
  }
  return { accepted, error: problems.join(" ") };
}
