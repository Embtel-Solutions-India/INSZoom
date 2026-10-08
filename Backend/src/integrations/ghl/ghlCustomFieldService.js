const env = require("../../config/env");
const logger = require("../../utils/logger");
const GHLIntegration = require("../../models/GHLIntegration");
const { getClient } = require("./ghlClient");
const { FIELD_KEYS, FIELD_NAMES } = require("./ghlVisaMapping");

const CACHE_MS = 6 * 60 * 60 * 1000; // field ids almost never change
const FAILURE_MS = 60 * 1000;

// Looks up the ids of the five visa-related opportunity fields by their stable
// fieldKey. Returns { ids } (possibly partial) or { ids: null, status } when GHL
// refuses (for example the token lacks the custom-fields scope). It never throws:
// "can't read the fields" simply means every visa stays pending.
async function fetchFieldIds({ client = getClient(), locationId = env.ghl.locationId } = {}) {
  try {
    const data = await client.get(`/locations/${locationId}/customFields`, { model: "opportunity" });
    const byKey = new Map((data?.customFields || []).map((field) => [field.fieldKey, field.id]));
    const ids = {};
    for (const name of FIELD_NAMES) {
      const id = byKey.get(FIELD_KEYS[name]);
      if (id) ids[name] = id;
    }
    return { ids: Object.keys(ids).length ? ids : null, missing: FIELD_NAMES.filter((name) => !ids[name]) };
  } catch (error) {
    logger.warn("ghl_custom_fields_unavailable", { status: error.status, error: error.message });
    return { ids: null, status: error.status || 0, missing: FIELD_NAMES };
  }
}

const plainIds = (stored) => {
  const ids = {};
  for (const name of FIELD_NAMES) if (stored?.[name]) ids[name] = stored[name];
  return ids;
};

/**
 * Cached field ids for a configured integration. Refreshes from GHL at most every
 * six hours, persists the result, and falls back to the last known ids if a
 * refresh fails.
 */
// In-memory memo per config object, so a bulk import resolves the ids once, not once per opportunity.
const memo = new WeakMap();

async function ensureFieldIds(config, { client } = {}) {
  if (config && typeof config === "object" && memo.has(config)) {
    const hit = memo.get(config);
    if (Date.now() - hit.at < hit.ttl) return hit.ids;
  }
  const cached = plainIds(config?.visaMapping?.fieldIds);
  const refreshedAt = config?.visaMapping?.fieldIdsRefreshedAt;
  const fresh = refreshedAt && Date.now() - new Date(refreshedAt).getTime() < CACHE_MS;
  if (Object.keys(cached).length && fresh) return cached;

  const { ids } = await fetchFieldIds({ client, locationId: config?.locationId });
  // Remember the answer (a refusal for a minute, so a bulk import doesn't retry GHL once per opportunity).
  if (config && typeof config === "object") {
    memo.set(config, { ids: ids || (Object.keys(cached).length ? cached : null), at: Date.now(), ttl: ids ? CACHE_MS : FAILURE_MS });
  }
  if (ids) {
    if (config?._id) {
      await GHLIntegration.updateOne(
        { _id: config._id },
        { $set: { "visaMapping.fieldIds": ids, "visaMapping.fieldIdsRefreshedAt": new Date() } }
      ).catch(() => {});
    }
    return ids;
  }
  return Object.keys(cached).length ? cached : null;
}

module.exports = { fetchFieldIds, ensureFieldIds, CACHE_MS };
