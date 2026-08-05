const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const env = require("../config/env");

const execFileAsync = promisify(execFile);

/**
 * Normalize a USCIS PDF so pdf-lib can parse it. qpdf rewrites the file with
 * object streams disabled and streams uncompressed; pdf-lib then reads/fills the
 * AcroForm layer (residual XFA is dropped by pdf-lib on save). Idempotent.
 * Never mutates the input buffer.
 * @param {Buffer} inputBuffer raw PDF bytes
 * @returns {Promise<Buffer>} normalized PDF bytes
 */
async function normalizePdf(inputBuffer) {
  if (!Buffer.isBuffer(inputBuffer) ||
      inputBuffer.subarray(0, 5).toString("utf8") !== "%PDF-") {
    const error = new Error("normalizePdf expects a PDF Buffer");
    error.code = "NORMALIZE_INPUT_NOT_PDF";
    throw error;
  }
  const qpdf = env.qpdfPath || "qpdf";
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "uscis-norm-"));
  const inPath = path.join(dir, `${crypto.randomUUID()}.in.pdf`);
  const outPath = path.join(dir, `${crypto.randomUUID()}.out.pdf`);
  try {
    await fs.writeFile(inPath, inputBuffer);
    await execFileAsync(qpdf, [
      "--object-streams=disable",
      "--stream-data=uncompress",
      // Many official USCIS PDFs are encrypted with an empty user password
      // (permission restrictions only, e.g. no-copy/no-print — never a real
      // password prompt). qpdf can't write a --deterministic-id for an
      // encrypted output, so strip that wrapper here; pdf-lib already reads
      // through it via { ignoreEncryption: true } regardless, and it never
      // affects sourceChecksum, which stays the RAW encrypted bytes' hash.
      "--decrypt",
      // Without this, qpdf regenerates the trailer's /ID from randomness on
      // every run, so normalizing the SAME input twice (a retry after a
      // transient failure, or a later re-import of the same file) produces
      // different bytes each time — which breaks the content-addressed
      // immutable storage layer's collision check (storeImmutableBuffer
      // compares the checksum of what's already stored against what's being
      // written). Deriving the ID from content instead makes normalizePdf's
      // output byte-for-byte reproducible for the same input.
      "--deterministic-id",
      inPath,
      outPath,
    ]);
    return await fs.readFile(outPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      const e = new Error(
        `qpdf binary not found (looked for "${qpdf}"). Install it and/or set QPDF_PATH, ` +
        `then open a NEW terminal (PATH changes don't reach already-open shells). ` +
        `Windows: winget install --id QPDF.QPDF (or choco install qpdf / scoop install qpdf). ` +
        `macOS: brew install qpdf. Debian/Ubuntu: sudo apt-get update && sudo apt-get install -y qpdf.`
      );
      e.code = "QPDF_NOT_FOUND";
      throw e;
    }
    if (error.code === 3) { // qpdf warnings; valid output still written
      try { return await fs.readFile(outPath); } catch (_) { /* fall through */ }
    }
    error.message = `qpdf normalization failed: ${error.message}`;
    throw error;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

module.exports = { normalizePdf };
