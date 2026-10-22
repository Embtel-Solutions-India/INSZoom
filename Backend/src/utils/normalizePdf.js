const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs/promises");
const fsSync = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const env = require("../config/env");
const logger = require("./logger");

const execFileAsync = promisify(execFile);
let fallbackWarned = false;

// Phase 7.E: every failure carries WHY it happened, not just that it happened.
//   cause "tool_spawn"  qpdf could not be started (the program itself is missing / not runnable) - the only cause that may be reported as QPDF_NOT_FOUND
//   cause "temp_file"   a temporary input / output file or folder was missing (ENOENT from the file system, NOT from starting qpdf)
//   cause "qpdf_failed" qpdf started and rejected the file
//   cause "not_pdf"     the input is not a PDF
const tagged = (error, code, cause, evidence) => Object.assign(error, { code, cause, evidence });

/** One qpdf run in its own throw-away folder. Each failure is tagged with the step it came from, so an ENOENT is never blamed on the wrong thing. */
async function runQpdf(qpdf, inputBuffer, exec) {
  let step = "mkdtemp";
  let dir;
  try {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "uscis-norm-"));
    const inPath = path.join(dir, `${crypto.randomUUID()}.in.pdf`);
    const outPath = path.join(dir, `${crypto.randomUUID()}.out.pdf`);
    step = "write";
    await fs.writeFile(inPath, inputBuffer);
    step = "exec";
    try {
      await exec(qpdf, [
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
    } catch (error) {
      if (error.code === 3) { // qpdf warnings; valid output still written
        step = "read";
        try { return await fs.readFile(outPath); } catch (_) { /* fall through */ }
      }
      throw error;
    }
    step = "read";
    return await fs.readFile(outPath);
  } catch (error) {
    if (error.cause && error.code && String(error.code).startsWith("NORMALIZE_")) throw error;
    const spawnFailure = step === "exec" && ["ENOENT", "EACCES", "EPERM", "ENOEXEC"].includes(error.code) && (/spawn/i.test(String(error.syscall || error.message)) || error.path === qpdf || !error.syscall);
    if (spawnFailure) throw tagged(error, "QPDF_SPAWN_FAILED", "tool_spawn", `could not start "${qpdf}" (${error.code})`);
    if (error.code === "ENOENT" || ["mkdtemp", "write", "read"].includes(step) && ["ENOENT", "ENOSPC", "EACCES", "EPERM", "EMFILE"].includes(error.code)) {
      throw tagged(error, "NORMALIZE_TEMP_FILE", "temp_file", `temporary file problem at step "${step}" (${error.code})`);
    }
    error.message = `qpdf normalization failed: ${error.message}`;
    throw tagged(error, error.code, "qpdf_failed", `qpdf exited with ${error.code}`);
  } finally {
    if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => null);
  }
}

const programFileExists = (qpdf) => {
  if (!qpdf || !/[\\/]/.test(qpdf)) return null;
  try { return fsSync.existsSync(qpdf); } catch (_) { return null; }
};

/**
 * Normalize a USCIS PDF so pdf-lib can parse it. qpdf rewrites the file with
 * object streams disabled and streams uncompressed; pdf-lib then reads/fills the
 * AcroForm layer (residual XFA is dropped by pdf-lib on save). Idempotent.
 * Never mutates the input buffer.
 *
 * Phase 7.E resilience, in this order, each step only when the one before cannot be used:
 *   1. qpdf at the configured path;
 *   2. a temp-file failure is retried once in a fresh folder (it is NOT "qpdf missing");
 *   3. when qpdf cannot be STARTED: a fresh re-probe (ignoring any cached answer), then the resolved path and the bare name on PATH;
 *   4. only if qpdf is truly unusable and FORM_PIPELINE_AUTONOMY is not "off": the pure-JavaScript normalizer, accepted only when it keeps the same pages and
 *      the same field names; otherwise QPDF_NOT_FOUND with the real cause (cause: tool_spawn).
 * `deps` (tests): { exec, ensureQpdf, fallback, mode }.
 * @param {Buffer} inputBuffer raw PDF bytes
 * @returns {Promise<Buffer>} normalized PDF bytes
 */
async function normalizePdf(inputBuffer, deps = {}) {
  if (!Buffer.isBuffer(inputBuffer) ||
      inputBuffer.subarray(0, 5).toString("utf8") !== "%PDF-") {
    const error = new Error("normalizePdf expects a PDF Buffer");
    error.code = "NORMALIZE_INPUT_NOT_PDF";
    error.cause = "not_pdf";
    throw error;
  }
  const exec = deps.exec || execFileAsync;
  const qpdf = env.qpdfPath || "qpdf";
  let spawnError;
  try {
    return await runQpdf(qpdf, inputBuffer, exec);
  } catch (error) {
    if (error.cause === "temp_file") {
      // a missing temporary file is not a missing tool: try once more in a fresh folder
      try { return await runQpdf(qpdf, inputBuffer, exec); } catch (again) { if (again.cause !== "tool_spawn") throw again; spawnError = again; }
    } else if (error.cause === "tool_spawn") {
      spawnError = error;
    } else {
      throw error;
    }
  }

  // qpdf could not be started: heal first (fresh probe, resolved path, bare name), then fall back
  const tried = [qpdf];
  const heal = deps.ensureQpdf || require("./ensureQpdf").ensureQpdf;
  let resolved = null;
  try { resolved = await heal({ force: true }); } catch (_) { resolved = null; }
  for (const candidate of [resolved, "qpdf"]) {
    if (!candidate || tried.includes(candidate)) continue;
    tried.push(candidate);
    try {
      const output = await runQpdf(candidate, inputBuffer, exec);
      env.qpdfPath = candidate; // the working path is remembered for the next call
      logger.info("qpdf_recovered", { binary: candidate });
      return output;
    } catch (error) {
      if (error.cause !== "tool_spawn") throw error;
      spawnError = error;
    }
  }

  const mode = deps.mode || require("../config/formPipelineAutonomy").mode();
  const existsNote = programFileExists(qpdf);
  if (mode !== "off") {
    try {
      const fallback = deps.fallback || require("./normalizeFallback");
      const { buffer } = await fallback.normalizeVerified(inputBuffer);
      if (!fallbackWarned) {
        fallbackWarned = true;
        logger.warn("normalize_pdf_fallback_used", { reason: "qpdf could not be started", tried, configuredPathExists: existsNote });
      }
      return buffer;
    } catch (fallbackError) {
      logger.warn("normalize_pdf_fallback_failed", { error: fallbackError.message, code: fallbackError.code });
    }
  }
  const message = `qpdf could not be started (tried ${tried.map((item) => `"${item}"`).join(", ")}; the configured path ${existsNote === null ? "was not checked" : existsNote ? "exists but did not run" : "does not exist"}). ` +
    `Set QPDF_PATH to a working qpdf, or install it (Windows: winget install --id QPDF.QPDF; macOS: brew install qpdf; Debian/Ubuntu: apt-get install -y qpdf). A process started before qpdf was installed must be restarted.`;
  throw tagged(new Error(message), "QPDF_NOT_FOUND", "tool_spawn", `tried ${tried.join(" | ")}; first error ${spawnError?.code || "unknown"}`);
}

module.exports = { normalizePdf, runQpdf };
