const { execFile } = require("child_process");
const path = require("path");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const MIME_BY_EXTENSION = {
  ".csv": ["text/csv", "application/csv", "text/plain"],
  ".doc": ["application/msword"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip"],
  ".jpeg": ["image/jpeg"],
  ".jpg": ["image/jpeg"],
  ".pdf": ["application/pdf"],
  ".png": ["image/png"],
  ".tif": ["image/tiff"],
  ".tiff": ["image/tiff"],
  ".txt": ["text/plain"],
  ".zip": ["application/zip", "application/x-zip-compressed"],
};

const EICAR_SIGNATURE = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

function securityError(message, statusCode = 422, code = "UNSAFE_FILE") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function detectMime(buffer) {
  const { fileTypeFromBuffer } = await import("file-type");
  return fileTypeFromBuffer(buffer);
}

async function validateFile(file) {
  if (!file?.buffer?.length) throw securityError("Uploaded file is empty", 400, "EMPTY_FILE");
  const extension = path.extname(file.originalname || "").toLowerCase();
  const allowedMimes = MIME_BY_EXTENSION[extension];
  if (!allowedMimes) throw securityError("Unsupported file extension", 415, "UNSUPPORTED_FILE_TYPE");

  const detected = await detectMime(file.buffer);
  const suppliedMime = String(file.mimetype || "").toLowerCase();
  if (detected && !allowedMimes.includes(detected.mime)) {
    throw securityError("File content does not match its extension", 415, "FILE_TYPE_MISMATCH");
  }
  if (!detected && !allowedMimes.includes(suppliedMime)) {
    throw securityError("Unable to verify uploaded file type", 415, "UNVERIFIED_FILE_TYPE");
  }
  return {
    extension,
    detectedMime: detected?.mime || suppliedMime,
    detectedExtension: detected?.ext || extension.slice(1),
  };
}

async function scanWithCommand(file) {
  const command = process.env.MALWARE_SCANNER_COMMAND;
  if (!command) return null;
  const args = String(process.env.MALWARE_SCANNER_ARGS || "").split(/\s+/).filter(Boolean);
  const temporaryPath = file.path;
  if (!temporaryPath) return null;
  try {
    await execFileAsync(command, [...args, temporaryPath], {
      timeout: Number(process.env.MALWARE_SCAN_TIMEOUT_MS || 30000),
      windowsHide: true,
    });
    return { provider: "external_command", status: "clean", scannedAt: new Date() };
  } catch (error) {
    if (error.code === 1) throw securityError("Malware was detected in the uploaded file", 422, "MALWARE_DETECTED");
    throw securityError("Malware scanner failed", 503, "MALWARE_SCANNER_FAILED");
  }
}

async function scanBuffer(file) {
  const externalResult = await scanWithCommand(file);
  if (externalResult) return externalResult;
  if (file.buffer.includes(Buffer.from(EICAR_SIGNATURE))) {
    throw securityError("Malware was detected in the uploaded file", 422, "MALWARE_DETECTED");
  }
  return {
    provider: "signature",
    status: "clean",
    scannedAt: new Date(),
    limited: true,
  };
}

async function inspect(file) {
  const validation = await validateFile(file);
  const malware = await scanBuffer(file);
  return { validation, malware };
}

module.exports = {
  MIME_BY_EXTENSION,
  inspect,
  scanBuffer,
  validateFile,
};
