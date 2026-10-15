// Makes sure the qpdf binary the PDF normalizer needs is present - by code, not by hand. Order: configured QPDF_PATH / PATH -> well-known install
// locations -> a one-time silent package-manager install (winget / choco / scoop on Windows, brew on macOS, apt-get / dnf / apk on Linux) -> re-probe.
// Opt out with QPDF_AUTO_INSTALL=false (e.g. locked-down production images that bake qpdf in). Result is cached for the process.
const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const path = require("path");
const env = require("../config/env");
const logger = require("./logger");

const execFileAsync = promisify(execFile);
let cached = null;
let inFlight = null;

async function works(binary) {
  try { await execFileAsync(binary, ["--version"], { timeout: 15000 }); return true; } catch (_) { return false; }
}

function knownLocations() {
  if (process.platform !== "win32") return ["/usr/bin/qpdf", "/usr/local/bin/qpdf", "/opt/homebrew/bin/qpdf"];
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs")].filter(Boolean);
  const found = [];
  for (const root of roots) {
    try {
      fs.readdirSync(root).filter((name) => /^qpdf/i.test(name)).forEach((name) => found.push(path.join(root, name, "bin", "qpdf.exe")));
    } catch (_) { /* root missing */ }
  }
  return found;
}

function installCommands() {
  if (process.platform === "win32") return [["winget", ["install", "--id", "QPDF.QPDF", "-e", "--silent", "--accept-package-agreements", "--accept-source-agreements"]], ["choco", ["install", "qpdf", "-y"]], ["scoop", ["install", "qpdf"]]];
  if (process.platform === "darwin") return [["brew", ["install", "qpdf"]]];
  return [["apt-get", ["install", "-y", "qpdf"]], ["dnf", ["install", "-y", "qpdf"]], ["apk", ["add", "qpdf"]]];
}

async function probe() {
  const candidates = [env.qpdfPath, "qpdf", ...knownLocations()].filter(Boolean);
  for (const candidate of candidates) if (await works(candidate)) return candidate;
  return null;
}

async function resolve() {
  let binary = await probe();
  if (!binary && String(process.env.QPDF_AUTO_INSTALL || "true").toLowerCase() !== "false") {
    for (const [command, args] of installCommands()) {
      try {
        logger.info("qpdf_auto_install_attempt", { command });
        await execFileAsync(command, args, { timeout: 10 * 60 * 1000 });
        binary = await probe();
        if (binary) break;
      } catch (error) {
        logger.info("qpdf_auto_install_failed", { command, error: error.message });
      }
    }
  }
  if (binary) { env.qpdfPath = binary; logger.info("qpdf_ready", { binary }); }
  return binary;
}

// resolves to the working qpdf path (and points env.qpdfPath at it) or null when it truly cannot be provided
function ensureQpdf({ force = false } = {}) {
  if (cached && !force) return Promise.resolve(cached);
  if (!inFlight) inFlight = resolve().then((binary) => { if (binary) cached = binary; return binary; }).finally(() => { inFlight = null; });
  return inFlight;
}

module.exports = { ensureQpdf };
