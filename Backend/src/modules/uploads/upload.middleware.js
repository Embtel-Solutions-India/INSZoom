const multer = require("multer");

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/tiff",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/zip",
  "application/x-zip-compressed",
  "text/plain",
  "text/csv",
  "application/csv",
];

const MAX_FILE_SIZE = Number(
  process.env.MAX_UPLOAD_SIZE_BYTES ||
  process.env.MAX_FILE_SIZE ||
  10 * 1024 * 1024
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, callback) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) return callback(null, true);
    return callback(new Error("Invalid file type. Allowed: PDF, JPG, PNG, TIFF, DOC, DOCX, TXT, CSV, ZIP"));
  },
});

module.exports = upload;
