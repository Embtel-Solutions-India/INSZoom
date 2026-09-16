const SettingValue = require("../../models/SettingValue");
const SettingsAuditLog = require("../../models/SettingsAuditLog");
const { getRegistryEntry, listRegistry, listCategories } = require("./registry");
const cache = require("./settingsCache");
const settingsEvents = require("./settingsEvents");
const { hasPermission } = require("../authorization/rbac.service");

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}
function forbidden(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}
function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function getEntryOrThrow(key) {
  const entry = getRegistryEntry(key);
  if (!entry) throw notFound(`Unknown setting key "${key}"`);
  return entry;
}

// Locked down even though `admin` holds the `settings:*` wildcard — per the
// enterprise settings spec, admin is restricted from system-scope
// security/roles management; only super_admin may write these at system
// scope (org/team/user-scoped security prefs, where applicable, stay open
// to admin). This repo has no distinct "organization" tier below "system"
// yet (single-tenant), so "system scope" is the relevant boundary here.
const SUPER_ADMIN_ONLY_SYSTEM_ACTIONS = new Set(["settings:manage_security", "settings:manage_roles"]);

function assertWritePermission(actor, entry, scope) {
  if (!hasPermission(actor, entry.requiresPermission)) {
    throw forbidden(`Missing permission "${entry.requiresPermission}" for setting "${entry.key}"`);
  }
  if (entry.readOnly) {
    throw forbidden(`Setting "${entry.key}" is read-only`);
  }
  if (scope === "system" && SUPER_ADMIN_ONLY_SYSTEM_ACTIONS.has(entry.requiresPermission) && actor.role !== "super_admin") {
    throw forbidden(`Only a super_admin may manage "${entry.category}" at system scope`);
  }
}

function validateValue(entry, value) {
  const result = entry.validation.safeParse(value);
  if (!result.success) {
    throw badRequest(`Invalid value for "${entry.key}": ${result.error.issues.map((i) => i.message).join("; ")}`);
  }
  return result.data;
}

// Resolution order for a given entry's declared scopes, most-specific
// first: user -> team -> organization -> system -> registry default.
function buildScopeChain(entry, ctx) {
  const chain = [];
  if (entry.scopes.includes("user") && ctx.userId) chain.push(["user", String(ctx.userId)]);
  if (entry.scopes.includes("team") && ctx.teamId) chain.push(["team", String(ctx.teamId)]);
  if (entry.scopes.includes("organization")) chain.push(["organization", ctx.orgId ? String(ctx.orgId) : null]);
  if (entry.scopes.includes("system")) chain.push(["system", null]);
  return chain;
}

// Runtime consumers call this. Secrets are resolved from process.env at
// read time and never touch the SettingValue collection/cache as
// plaintext — only the env var NAME is ever stored/cached.
async function getEffective(key, ctx = {}) {
  const entry = getEntryOrThrow(key);

  if (entry.type === "secretRef") {
    const envVarName = await resolveRawValue(entry, ctx) || entry.default;
    return process.env[envVarName] ?? null;
  }

  const resolved = await resolveRawValue(entry, ctx);
  return resolved !== undefined ? resolved : entry.default;
}

async function resolveRawValue(entry, ctx) {
  for (const [scope, scopeId] of buildScopeChain(entry, ctx)) {
    const cached = cache.get(entry.key, scope, scopeId);
    if (cached !== undefined) return cached;
    const doc = await SettingValue.findOne({ key: entry.key, scope, scopeId }).lean();
    if (doc) {
      cache.set(entry.key, scope, scopeId, doc.value);
      return doc.value;
    }
  }
  return undefined;
}

// Catalog for the UI: registry entries the actor may at least view, merged
// with their current effective value, grouped by category -> group.
// Secrets are masked to {configured, envVar} — the plaintext never reaches
// the client.
async function getCatalog(actor, ctx = {}) {
  const entries = listRegistry().filter((entry) => hasPermission(actor, entry.requiresPermission));
  const withValues = await Promise.all(
    entries.map(async (entry) => {
      let raw;
      if (entry.type === "secretRef") {
        const envVarName = (await resolveRawValue(entry, ctx)) || entry.default;
        raw = { configured: Boolean(process.env[envVarName]), envVar: envVarName };
      } else {
        raw = await getEffective(entry.key, ctx);
      }
      return {
        key: entry.key,
        category: entry.category,
        group: entry.group,
        label: entry.label,
        description: entry.description || "",
        type: entry.type,
        enumValues: entry.enumValues,
        default: entry.sensitive || entry.type === "secretRef" ? undefined : entry.default,
        value: entry.sensitive ? "[REDACTED]" : raw,
        scopes: entry.scopes,
        readOnly: Boolean(entry.readOnly),
        sensitive: Boolean(entry.sensitive),
        canManage: !entry.readOnly,
      };
    })
  );

  const grouped = {};
  for (const item of withValues) {
    grouped[item.category] = grouped[item.category] || {};
    grouped[item.category][item.group] = grouped[item.category][item.group] || [];
    grouped[item.category][item.group].push(item);
  }
  return { categories: listCategories().filter((c) => grouped[c]), grouped };
}

async function writeAudit({ entry, scope, scopeId, previousValue, newValue, actor, req, reason, action }) {
  const redact = (v) => (entry.sensitive ? "[REDACTED]" : v);
  await SettingsAuditLog.create({
    key: entry.key,
    category: entry.category,
    scope,
    scopeId,
    previousValue: redact(previousValue),
    newValue: redact(newValue),
    changedBy: actor?._id,
    changedByRole: actor?.role,
    ip: req?.ip,
    userAgent: req?.headers?.["user-agent"],
    reason: reason || "",
    action: action || "set",
  });
}

async function set(key, scope, scopeId, value, actor, req, options = {}) {
  const entry = getEntryOrThrow(key);
  if (!entry.scopes.includes(scope)) {
    throw badRequest(`Setting "${key}" does not support scope "${scope}"`);
  }
  assertWritePermission(actor, entry, scope);
  const validated = validateValue(entry, value);

  const previous = await SettingValue.findOne({ key, scope, scopeId: scopeId ?? null }).lean();
  const updated = await SettingValue.findOneAndUpdate(
    { key, scope, scopeId: scopeId ?? null },
    { $set: { value: validated, updatedBy: actor?._id }, $inc: { version: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  cache.invalidateKey(key);
  await writeAudit({
    entry, scope, scopeId: scopeId ?? null,
    previousValue: previous ? previous.value : entry.default,
    newValue: validated,
    actor, req, reason: options.reason, action: options.action || "set",
  });

  settingsEvents.emit("settings.changed", { key, scope, scopeId: scopeId ?? null, value: validated });
  return updated;
}

// One category save — all-or-nothing. Validates + permission-checks every
// change before writing any of them, so a bad entry never leaves a partial
// save applied.
async function bulkSet(changes, actor, req, options = {}) {
  if (!Array.isArray(changes) || !changes.length) throw badRequest("changes must be a non-empty array");

  const prepared = changes.map(({ key, scope, scopeId, value }) => {
    const entry = getEntryOrThrow(key);
    if (!entry.scopes.includes(scope)) throw badRequest(`Setting "${key}" does not support scope "${scope}"`);
    assertWritePermission(actor, entry, scope);
    return { entry, scope, scopeId: scopeId ?? null, value: validateValue(entry, value) };
  });

  const results = [];
  for (const { entry, scope, scopeId, value } of prepared) {
    const previous = await SettingValue.findOne({ key: entry.key, scope, scopeId }).lean();
    const updated = await SettingValue.findOneAndUpdate(
      { key: entry.key, scope, scopeId },
      { $set: { value, updatedBy: actor?._id }, $inc: { version: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    cache.invalidateKey(entry.key);
    await writeAudit({ entry, scope, scopeId, previousValue: previous ? previous.value : entry.default, newValue: value, actor, req, reason: options.reason, action: "bulk_set" });
    settingsEvents.emit("settings.changed", { key: entry.key, scope, scopeId, value });
    results.push(updated);
  }
  return results;
}

async function history(key, scope, scopeId) {
  getEntryOrThrow(key);
  return SettingsAuditLog.find({ key, scope, scopeId: scopeId ?? null }).sort({ at: -1 }).lean();
}

async function rollback(key, scope, scopeId, toVersion, actor, req) {
  const entry = getEntryOrThrow(key);
  assertWritePermission(actor, entry, scope);
  const logs = await SettingsAuditLog.find({ key, scope, scopeId: scopeId ?? null }).sort({ at: 1 }).lean();
  const target = logs[toVersion - 1];
  if (!target) throw notFound(`No version ${toVersion} recorded for "${key}"`);
  return set(key, scope, scopeId, target.newValue, actor, req, { reason: `Rollback to version ${toVersion}`, action: "rollback" });
}

async function listAudit({ category, key, limit = 100 } = {}) {
  const filter = {};
  if (category) filter.category = category;
  if (key) filter.key = key;
  return SettingsAuditLog.find(filter).sort({ at: -1 }).limit(Math.min(limit, 500)).lean();
}

module.exports = {
  getCatalog,
  getEffective,
  set,
  bulkSet,
  history,
  rollback,
  listAudit,
};
