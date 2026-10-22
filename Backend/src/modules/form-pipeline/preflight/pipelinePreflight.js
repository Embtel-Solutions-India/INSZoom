// Phase 7.1 pipeline preflight: VERIFIES that what the automatic pipeline needs is actually in place (qpdf, indexes, worker placement, job schema version, evidence flag,
// an admin to alert). It installs nothing and never writes to the database. Report-only unless FORM_PIPELINE_PREFLIGHT_ENFORCE=true, so nothing changes before the
// deploy decision (D6); the worker asks `isBlocking()` later. `runPreflight` never throws.
const { execFile } = require("child_process");
const { SUPPORTED_SCHEMA_VERSIONS, OPEN_STATES } = require("../pipeline.constants");

const MIN_QPDF_VERSION = "10.6.0";
const AUTONOMY_VALUES = ["off", "shadow", "on"];
const ADMIN_ROLES = ["super_admin", "admin"];
const QPDF_TIMEOUT_MS = 15000;

/** Pure. "qpdf version 11.9.0" -> "11.9.0" (null when there is none). */
function parseQpdfVersion(text) {
  const match = String(text || "").match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return match ? `${match[1]}.${match[2]}.${match[3] || 0}` : null;
}

/** Pure. true when version `a` >= version `b` (dotted numbers). */
function versionAtLeast(a, b) {
  const left = String(a).split(".").map(Number);
  const right = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const x = left[i] || 0;
    const y = right[i] || 0;
    if (x !== y) return x > y;
  }
  return true;
}

function defaultExec(binary, args) {
  return new Promise((resolve, reject) => execFile(binary, args, { timeout: QPDF_TIMEOUT_MS }, (error, stdout) => (error ? reject(error) : resolve(String(stdout || "")))));
}

function defaultDeps() {
  const mongoose = require("mongoose");
  return {
    env: process.env,
    qpdfPath: () => require("../../../config/env").qpdfPath || "qpdf",
    exec: defaultExec,
    // only collection(name).indexes() is ever called on this handle (a read)
    db: () => (mongoose.connection.readyState === 1 ? mongoose.connection.db : null),
    Job: () => require("../../../models/FormPipelineJob"),
    User: () => require("../../../models/User"),
    now: () => new Date(),
  };
}

const check = (name, status, critical, detail) => ({ name, status, critical: Boolean(critical), detail });

async function checkQpdf(d) {
  const binary = await Promise.resolve(d.qpdfPath()).catch(() => "qpdf");
  try {
    const version = parseQpdfVersion(await d.exec(binary, ["--version"]));
    if (!version) return check("qpdf", "fail", true, `qpdf answered but its version could not be read (${binary})`);
    if (!versionAtLeast(version, MIN_QPDF_VERSION)) return check("qpdf", "fail", true, `qpdf ${version} is older than the minimum ${MIN_QPDF_VERSION}`);
    return check("qpdf", "pass", true, `qpdf ${version}`);
  } catch (error) {
    return check("qpdf", "fail", true, `qpdf is not available (${binary}): ${error.code || error.message}`);
  }
}

const REQUIRED_INDEXES = [
  { collection: "formpipelinejobs", label: "one_open_job_per_form", match: (ix) => ix.name === "one_open_job_per_form" && ix.unique && ix.partialFilterExpression },
  { collection: "uscisformtemplates", label: "unique {formCode, version}", match: (ix) => ix.unique && Object.keys(ix.key || {}).join(",") === "formCode,version" },
  { collection: "formeditiondecisions", label: "unique {formCode, editionIdentifier}", match: (ix) => ix.unique && Object.keys(ix.key || {}).join(",") === "formCode,editionIdentifier" },
];

async function checkIndexes(d) {
  const db = await Promise.resolve(d.db()).catch(() => null);
  if (!db) return check("indexes", "warn", false, "the database is not connected, indexes could not be checked");
  const missing = [];
  for (const wanted of REQUIRED_INDEXES) {
    try {
      const indexes = await db.collection(wanted.collection).indexes();
      if (!indexes.some((ix) => wanted.match(ix))) missing.push(`${wanted.collection}: ${wanted.label}`);
    } catch (error) {
      if (error?.code === 26 || /ns does not exist|NamespaceNotFound/i.test(String(error?.message))) missing.push(`${wanted.collection}: ${wanted.label} (collection missing)`);
      else return check("indexes", "warn", false, `indexes could not be read: ${error.message}`);
    }
  }
  return missing.length ? check("indexes", "fail", true, `missing: ${missing.join("; ")}`) : check("indexes", "pass", true, "all required indexes exist");
}

function checkPlacement(d) {
  const mode = String(d.env.FORM_PIPELINE_MODE || "inline").toLowerCase();
  const worker = String(d.env.FORM_PIPELINE_WORKER || "embedded").toLowerCase();
  if (!["inline", "queued"].includes(mode)) return check("worker_placement", "fail", true, `FORM_PIPELINE_MODE="${mode}" is not inline or queued`);
  if (!["embedded", "external", "off"].includes(worker)) return check("worker_placement", "fail", true, `FORM_PIPELINE_WORKER="${worker}" is not embedded, external or off`);
  if (mode === "queued" && worker === "off") return check("worker_placement", "fail", true, "mode is queued but the worker is off: queued jobs would never run");
  return check("worker_placement", "pass", true, `mode ${mode}, worker ${worker}`);
}

async function checkSchemaVersion(d) {
  try {
    const bad = await d.Job().countDocuments({ state: { $in: OPEN_STATES }, schemaVersion: { $nin: SUPPORTED_SCHEMA_VERSIONS } });
    return bad
      ? check("job_schema_version", "warn", false, `${bad} open job(s) have a schema version this build cannot claim (backend and worker must be restarted in lockstep)`)
      : check("job_schema_version", "pass", false, "all open jobs are claimable");
  } catch (error) {
    return check("job_schema_version", "warn", false, `could not be checked: ${error.message}`);
  }
}

function checkEvidenceFlag(d) {
  return String(d.env.FORM_EDITION_AUTO_EVIDENCE || "").toLowerCase() === "true"
    ? check("auto_evidence", "pass", false, "automatic edition evidence is on")
    : check("auto_evidence", "warn", false, "FORM_EDITION_AUTO_EVIDENCE is off: every new edition would be held until a decision exists");
}

async function checkAdmin(d) {
  try {
    const count = await d.User().countDocuments({ role: { $in: ADMIN_ROLES }, isActive: { $ne: false } });
    return count ? check("admin_user", "pass", false, `${count} active admin user(s)`) : check("admin_user", "warn", false, "no active admin or super_admin exists to receive pipeline alerts");
  } catch (error) {
    return check("admin_user", "warn", false, `could not be checked: ${error.message}`);
  }
}

function checkAutonomy(d) {
  const value = String(d.env.FORM_PIPELINE_AUTONOMY || "off").toLowerCase();
  return AUTONOMY_VALUES.includes(value)
    ? check("autonomy_switch", "pass", false, `FORM_PIPELINE_AUTONOMY=${value}`)
    : check("autonomy_switch", "fail", false, `FORM_PIPELINE_AUTONOMY="${value}" is not off, shadow or on (treated as off)`);
}

let last = null;

const enforcing = (env = process.env) => String(env.FORM_PIPELINE_PREFLIGHT_ENFORCE || "").toLowerCase() === "true";

/** Runs every check. Never throws; a check that crashes becomes a warning. `deps.noCache` keeps the result out of the cached "last" value. */
async function runPreflight(deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const guarded = async (name, fn) => { try { return await fn(); } catch (error) { return check(name, "warn", false, `the check itself failed: ${error.message}`); } };
  const checks = await Promise.all([
    guarded("qpdf", () => checkQpdf(d)),
    guarded("indexes", () => checkIndexes(d)),
    guarded("worker_placement", () => checkPlacement(d)),
    guarded("job_schema_version", () => checkSchemaVersion(d)),
    guarded("auto_evidence", () => checkEvidenceFlag(d)),
    guarded("admin_user", () => checkAdmin(d)),
    guarded("autonomy_switch", () => checkAutonomy(d)),
  ]);
  const criticalFailed = checks.some((item) => item.critical && item.status === "fail");
  const result = { ok: !checks.some((item) => item.status === "fail"), blocking: criticalFailed && enforcing(d.env), enforced: enforcing(d.env), checkedAt: d.now().toISOString(), checks };
  if (!deps.noCache) last = result;
  return result;
}

const getLastPreflight = () => last;
/** True only when a critical check failed AND enforcement is switched on (default report-only). */
const isBlocking = () => Boolean(last?.blocking) && enforcing();

// ---- start-up wiring: background, warn-level log, one admin notice per distinct failing set ----
let lastAlertedSignature = null;
const failingSignature = (result) => result.checks.filter((item) => item.status === "fail").map((item) => item.name).sort().join(",");

async function notifyAdmins(result, deps = {}) {
  const signature = failingSignature(result);
  if (!signature) { lastAlertedSignature = null; return false; }
  if (signature === lastAlertedSignature) return false;
  lastAlertedSignature = signature;
  const listAdmins = deps.listAdmins || (async () => require("../../../models/User").find({ role: { $in: ADMIN_ROLES }, isActive: { $ne: false } }).select("_id role").lean());
  const notifications = deps.notifications || require("../../notifications/notification.service");
  const failing = result.checks.filter((item) => item.status === "fail");
  const payload = {
    source: "shared", category: "system", priority: "high", type: "form_pipeline_alert",
    title: "Form pipeline preflight failed",
    message: failing.map((item) => `${item.name}: ${item.detail}`).join(" | ").slice(0, 500),
  };
  for (const user of await Promise.resolve(listAdmins()).catch(() => [])) {
    await notifications.createNotification({ ...payload, userId: user._id, recipientRole: user.role, dedupeKey: `form-pipeline-preflight:${signature}:${user._id}` }, null, null);
  }
  return true;
}

function startPipelinePreflight({ logger = require("../../../utils/logger"), withJobLock, deps = {} } = {}) {
  if (String(process.env.FORM_PIPELINE_PREFLIGHT || "true").toLowerCase() === "false") return null;
  const once = async () => {
    const result = await runPreflight(deps);
    for (const item of result.checks.filter((entry) => entry.status !== "pass")) {
      logger.warn("form_pipeline_preflight", { check: item.name, status: item.status, critical: item.critical, detail: item.detail, enforced: result.enforced });
    }
    await notifyAdmins(result, deps).catch((error) => logger.warn("form_pipeline_preflight_alert_failed", { error: error.message }));
    return result;
  };
  const intervalMs = Number(process.env.FORM_PIPELINE_PREFLIGHT_INTERVAL_MS || 30 * 60 * 1000);
  const run = () => (withJobLock ? withJobLock("form-pipeline-preflight", intervalMs, once) : once()).catch((error) => logger.warn("form_pipeline_preflight_failed", { error: error.message }));
  const first = setTimeout(run, Number(process.env.FORM_PIPELINE_PREFLIGHT_INITIAL_DELAY_MS || 20 * 1000));
  first.unref?.();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = { runPreflight, getLastPreflight, isBlocking, startPipelinePreflight, notifyAdmins, parseQpdfVersion, versionAtLeast, MIN_QPDF_VERSION, REQUIRED_INDEXES };
