const multer = require("multer");
const { MAX_FILE_BYTES, MAX_FILES_PER_ROW, isBlockedFileName, limitError, formatBytes } = require("./upload-limits");

// Any file type is accepted (photos incl. HEIC/WebP, text, Office, PDF, ...)
// except executables/scripts - see upload-limits.js. file-security.service
// additionally sniffs content for the Document pipeline.
const MAX_FILE_SIZE = Number(
  process.env.MAX_UPLOAD_SIZE_BYTES ||
  process.env.MAX_FILE_SIZE ||
  MAX_FILE_BYTES
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, callback) => {
    if (isBlockedFileName(file.originalname)) {
      return callback(limitError(`"${file.originalname}" is not an allowed file type. Executable and script files cannot be uploaded.`, 415, "BLOCKED_FILE_TYPE"));
    }
    return callback(null, true);
  },
});

// multer raises MulterError (no HTTP status) which the global error handler
// would turn into an opaque 500 - map the limit errors to clear 4xx messages.
function translateMulterError(error) {
  if (!error || error.name !== "MulterError") return error;
  if (error.code === "LIMIT_FILE_SIZE") {
    return limitError(`A file is larger than the ${formatBytes(MAX_FILE_SIZE)} limit per file.`, 413, "FILE_TOO_LARGE");
  }
  if (error.code === "LIMIT_UNEXPECTED_FILE") {
    return limitError(`Too many files in one request (maximum ${MAX_FILES_PER_ROW}).`, 422, "ROW_FILE_LIMIT_EXCEEDED");
  }
  return limitError(error.message, 400, error.code);
}

["single", "array", "fields", "any", "none"].forEach((method) => {
  const original = upload[method].bind(upload);
  upload[method] = (...args) => {
    const middleware = original(...args);
    return (req, res, next) => middleware(req, res, (error) => next(translateMulterError(error)));
  };
});

module.exports = upload;
