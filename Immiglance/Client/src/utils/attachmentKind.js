// What an attachment is (from its name / MIME type): drives its icon and whether the browser can preview it.

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"];
const VIDEO_EXT = ["mp4", "webm", "mov", "m4v", "ogv"];
const AUDIO_EXT = ["mp3", "wav", "m4a", "ogg", "oga", "aac", "flac"];
const TEXT_EXT = ["txt", "csv", "json", "md", "log", "xml", "yml", "yaml", "tsv"];
const ARCHIVE_EXT = ["zip", "rar", "7z", "gz", "tar"];
const SHEET_EXT = ["xls", "xlsx", "ods"];
const DOC_EXT = ["doc", "docx", "odt", "rtf", "ppt", "pptx"];

export const MIME_BY_EXT = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml", avif: "image/avif",
  pdf: "application/pdf", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", m4v: "video/mp4", ogv: "video/ogg",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", oga: "audio/ogg", aac: "audio/aac", flac: "audio/flac",
};

export const extOf = (name = "") => (name.includes(".") ? name.split(".").pop().toLowerCase() : "");

// What a file is, for its icon and for whether it can be previewed in the browser.
export function fileKind(name = "", mimeType = "") {
  const mime = (mimeType || "").toLowerCase();
  const ext = extOf(name);
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  // Only formats a browser can really draw: HEIC/TIFF etc. fall through to "other".
  if (IMAGE_EXT.includes(ext) || (!ext && mime.startsWith("image/"))) return "image";
  if (VIDEO_EXT.includes(ext) || (!ext && mime.startsWith("video/"))) return "video";
  if (AUDIO_EXT.includes(ext) || (!ext && mime.startsWith("audio/"))) return "audio";
  if (TEXT_EXT.includes(ext) || (!ext && mime.startsWith("text/"))) return "text";
  if (ARCHIVE_EXT.includes(ext)) return "archive";
  if (SHEET_EXT.includes(ext)) return "sheet";
  if (DOC_EXT.includes(ext)) return "doc";
  if (mime.startsWith("image/")) return "otherImage";
  if (mime.startsWith("video/")) return "otherVideo";
  if (mime.startsWith("audio/")) return "otherAudio";
  return "other";
}

export const isPreviewable = (kind) => ["image", "pdf", "video", "audio", "text"].includes(kind);
