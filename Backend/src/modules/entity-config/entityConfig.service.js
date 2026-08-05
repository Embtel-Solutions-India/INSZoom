const Settings = require("../../models/Settings");
const auditService = require("../audit/audit.service");
const { DEFAULT_BRAND_TOKENS, CANONICAL_STATUSES, mapLegacyStatus } = require("./entityConfig.constants");
const {
  FALLBACK_DISCLAIMER_TEMPLATE,
  FALLBACK_DISCLAIMER_UNCONFIGURED_FIRM_CLAUSE,
  DEFAULT_PROHIBITED_TERMS,
} = require("../compliance/compliance.constants");

// Short in-process TTL cache for the read-heavy, low-churn responses
// (resolved disclaimer, public config, status vocabulary). Busted
// immediately on any config PATCH so an admin edit is never stale for more
// than the TTL, and never stale at all right after they save it.
const CACHE_TTL_MS = 30 * 1000;
const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt < Date.now()) return undefined;
  return entry.value;
}

function cacheSet(key, value) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function bustCache() {
  cache.clear();
}

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}){1,2}$/;

// Always returns a real (possibly freshly-created) Settings singleton —
// never throws on a brand-new database. Mirrors settings.controller.js's
// own upsert-on-read pattern exactly, so both modules share one collection.
async function getConfig() {
  return Settings.findOneAndUpdate(
    { key: "global" },
    { $setOnInsert: { key: "global" } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

function interpolate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? vars[name] : match));
}

// Returns { text, version, lawFirmConfigured } — text is always a non-empty
// string. DB value wins when present; otherwise falls back to the hardcoded
// template, substituting a safe generic clause instead of ever rendering an
// empty law-firm name into client-facing legal copy.
async function resolveDisclaimer() {
  const cached = cacheGet("disclaimer");
  if (cached) return cached;

  const settings = await getConfig();
  const lawFirmConfigured = Boolean(settings.lawFirmEntityName && settings.lawFirmEntityName.trim());
  let text = (settings.nonAttorneyDisclaimer || "").trim();
  if (!text) {
    const template = lawFirmConfigured ? FALLBACK_DISCLAIMER_TEMPLATE : FALLBACK_DISCLAIMER_UNCONFIGURED_FIRM_CLAUSE;
    text = interpolate(template, {
      msoEntityShortName: settings.msoEntityShortName || "The organization",
      lawFirmEntityName: settings.lawFirmEntityName || "",
    });
  }
  const result = { text, version: settings.disclaimerVersion || 1, lawFirmConfigured };
  cacheSet("disclaimer", result);
  return result;
}

async function resolveProhibitedTerms() {
  const cached = cacheGet("prohibitedTerms");
  if (cached) return cached;
  const settings = await getConfig();
  const terms = Array.isArray(settings.prohibitedTerms) && settings.prohibitedTerms.length
    ? settings.prohibitedTerms
    : DEFAULT_PROHIBITED_TERMS;
  cacheSet("prohibitedTerms", terms);
  return terms;
}

// Public-facing config: brand identity + resolved disclaimer. No secrets,
// no internal-only fields — safe to serve unauthenticated.
async function getPublicConfig() {
  const cached = cacheGet("public");
  if (cached) return cached;
  const settings = await getConfig();
  const disclaimer = await resolveDisclaimer();
  const result = {
    msoEntityName: settings.msoEntityName,
    msoEntityShortName: settings.msoEntityShortName,
    lawFirmEntityName: settings.lawFirmEntityName || "",
    lawFirmEntityShortName: settings.lawFirmEntityShortName || "",
    lawFirmConfigured: disclaimer.lawFirmConfigured,
    activeBrand: settings.activeBrand,
    brandTokens: {
      primaryColor: settings.brandTokens?.primaryColor || DEFAULT_BRAND_TOKENS.primaryColor,
      accentColor: settings.brandTokens?.accentColor || DEFAULT_BRAND_TOKENS.accentColor,
      logoUrl: settings.brandTokens?.logoUrl || DEFAULT_BRAND_TOKENS.logoUrl,
    },
    disclaimer: disclaimer.text,
    disclaimerVersion: disclaimer.version,
  };
  cacheSet("public", result);
  return result;
}

function validatePatch(patch) {
  if (patch.msoEntityName !== undefined && !String(patch.msoEntityName).trim()) {
    const error = new Error("msoEntityName cannot be empty");
    error.status = 422;
    throw error;
  }
  const colorFields = [
    ["brandTokens", "primaryColor"],
    ["brandTokens", "accentColor"],
  ];
  colorFields.forEach(([group, field]) => {
    const value = patch[group]?.[field];
    if (value !== undefined && !HEX_COLOR_RE.test(value)) {
      const error = new Error(`${group}.${field} must be a valid hex color`);
      error.status = 422;
      throw error;
    }
  });
  if (patch.prohibitedTerms !== undefined) {
    if (!Array.isArray(patch.prohibitedTerms)) {
      const error = new Error("prohibitedTerms must be an array of strings");
      error.status = 422;
      throw error;
    }
    patch.prohibitedTerms = [...new Set(
      patch.prohibitedTerms
        .map((term) => String(term || "").trim().toLowerCase())
        .filter(Boolean)
    )];
  }
  return patch;
}

async function updateConfig(rawPatch, actor, req) {
  const patch = validatePatch({ ...rawPatch });
  delete patch.key; // never allow overwriting the singleton key

  const before = await getConfig();
  const disclaimerChanged = patch.nonAttorneyDisclaimer !== undefined
    && patch.nonAttorneyDisclaimer.trim() !== (before.nonAttorneyDisclaimer || "").trim();

  if (patch.lawFirmEntityName !== undefined) {
    patch.lawFirmIsConfigured = Boolean(String(patch.lawFirmEntityName).trim());
  }
  if (disclaimerChanged) {
    patch.disclaimerVersion = (before.disclaimerVersion || 1) + 1;
  }

  const updated = await Settings.findOneAndUpdate(
    { key: "global" },
    { $set: { ...patch, lastUpdatedBy: actor?._id, lastUpdatedAt: new Date() } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );

  bustCache();

  await auditService.recordAuditEvent({
    req,
    action: "config.update",
    entityType: "Settings",
    entityId: String(updated._id),
    previousValue: before.toObject(),
    newValue: updated.toObject(),
    severity: "medium",
    source: "api",
  });

  return updated;
}

function getStatusVocabulary() {
  return CANONICAL_STATUSES;
}

module.exports = {
  getConfig,
  getPublicConfig,
  resolveDisclaimer,
  resolveProhibitedTerms,
  updateConfig,
  getStatusVocabulary,
  mapLegacyStatus,
  bustCache,
};
