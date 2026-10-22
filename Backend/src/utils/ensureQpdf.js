// Makes sure the qpdf binary the PDF normalizer needs is present - by code, not by hand. Order: configured QPDF_PATH -> the bare name on PATH -> what `where`/`which`
// reports -> well-known install locations -> (only where allowed) a one-time silent package-manager install -> re-probe.
//
// Phase 7.E changes: the probe timeout is generous and configurable (QPDF_PROBE_TIMEOUT_MS, default 60 s: a slow first start under load is not proof the tool is
// missing); `force` re-probes from scratch and forgets any cached answer (a long-running process that started before qpdf was installed heals itself on the next
// failure); describe() reports what a diagnosis needs (path, exists, runs, version) without installing anything; nothing is installed at runtime in production
// unless QPDF_AUTO_INSTALL is explicitly "true". Opt out everywhere with QPDF_AUTO_INSTALL=false.
const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const path = require("path");
const env = require("../config/env");
const logger = require("./logger");

const execFileAsync = promisify(execFile);
let cached = null;
let inFlight = null;
let descriptionCache = null;
const DESCRIBE_TTL_MS = 30000;

const probeTimeoutMs = () => {
  const value = Number(process.env.QPDF_PROBE_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 60000;
};

/** { ok, version } - does this binary start and answer --version? Never throws. */
async function works(binary, { exec = execFileAsync, timeout = probeTimeoutMs() } = {}) {
  try {
    const result = await exec(binary, ["--version"], { timeout });
    const text = String(result?.stdout ?? result ?? "");
    const match = text.match(/qpdf version\s+([0-9][0-9.]*)/i);
    return { ok: true, version: match ? match[1] : null };
  } catch (_) {
    return { ok: false, version: null };
  }
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

/** What the OS locator (`where qpdf` / `which qpdf`) reports, first line per match. Never throws. */
async function locate({ exec = execFileAsync } = {}) {
  try {
    const result = await exec(process.platform === "win32" ? "where" : "which", ["qpdf"], { timeout: 15000 });
    return String(result?.stdout ?? result ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch (_) {
    return [];
  }
}

/** Auto-install is allowed outside production by default, and in production only when QPDF_AUTO_INSTALL is explicitly "true". */
function installAllowed(processEnv = process.env) {
  const flag = String(processEnv.QPDF_AUTO_INSTALL ?? "").trim().toLowerCase();
  if (flag === "false") return false;
  if (String(processEnv.NODE_ENV || "").toLowerCase() === "production") return flag === "true";
  return true;
}

function installCommands() {
  if (process.platform === "win32") return [["winget", ["install", "--id", "QPDF.QPDF", "-e", "--silent", "--accept-package-agreements", "--accept-source-agreements"]], ["choco", ["install", "qpdf", "-y"]], ["scoop", ["install", "qpdf"]]];
  if (process.platform === "darwin") return [["brew", ["install", "qpdf"]]];
  return [["apt-get", ["install", "-y", "qpdf"]], ["dnf", ["install", "-y", "qpdf"]], ["apk", ["add", "qpdf"]]];
}

/** The candidate paths in the order they are tried (de-duplicated). */
async function candidates(deps = {}) {
  const located = await (deps.locate || locate)(deps);
  const list = [env.qpdfPath, "qpdf", ...located, ...(deps.knownLocations || knownLocations)()].filter(Boolean);
  return [...new Set(list)];
}

async function probe(deps = {}) {
  const check = deps.works || works;
  for (const candidate of await candidates(deps)) {
    const result = await check(candidate, deps);
    if (result.ok) return { binary: candidate, version: result.version };
  }
  return null;
}

async function resolve(deps = {}) {
  let found = await probe(deps);
  if (!found && (deps.installAllowed ? deps.installAllowed() : installAllowed())) {
    for (const [command, args] of (deps.installCommands || installCommands)()) {
      try {
        logger.info("qpdf_auto_install_attempt", { command });
        await (deps.exec || execFileAsync)(command, args, { timeout: 10 * 60 * 1000 });
        found = await probe(deps);
        if (found) break;
      } catch (error) {
        logger.info("qpdf_auto_install_failed", { command, error: error.message });
      }
    }
  }
  if (found) { env.qpdfPath = found.binary; logger.info("qpdf_ready", { binary: found.binary, version: found.version }); }
  descriptionCache = null;
  return found ? found.binary : null;
}

// resolves to the working qpdf path (and points env.qpdfPath at it) or null when it truly cannot be provided.
// { force: true } forgets the cached answer and probes again from scratch (a failure cached earlier never sticks).
function ensureQpdf({ force = false, deps = {} } = {}) {
  if (force) { cached = null; descriptionCache = null; }
  if (cached && !force) return Promise.resolve(cached);
  if (inFlight && !force) return inFlight;
  const run = resolve(deps).then((binary) => { if (binary) cached = binary; return binary; }).finally(() => { if (inFlight === run) inFlight = null; });
  inFlight = run;
  return run;
}

/** { configuredPath, exists, runs, version, triedAt } for the diagnoser. Cheap: cached for 30 s; never installs. */
async function describe({ fresh = false, deps = {} } = {}) {
  if (!fresh && descriptionCache && Date.now() - descriptionCache.at < DESCRIBE_TTL_MS) return descriptionCache.value;
  const configuredPath = env.qpdfPath || null;
  let exists = null;
  if (configuredPath && /[\\/]/.test(configuredPath)) {
    try { exists = fs.existsSync(configuredPath); } catch (_) { exists = null; }
  }
  const direct = configuredPath ? await (deps.works || works)(configuredPath, deps) : { ok: false, version: null };
  const viaPath = direct.ok ? direct : await (deps.works || works)("qpdf", deps);
  const value = { configuredPath, exists, runs: viaPath.ok, runsFrom: direct.ok ? "configured" : viaPath.ok ? "PATH" : null, version: viaPath.version, triedAt: new Date().toISOString() };
  descriptionCache = { at: Date.now(), value };
  return value;
}

module.exports = { ensureQpdf, describe, works, installAllowed, probeTimeoutMs };
