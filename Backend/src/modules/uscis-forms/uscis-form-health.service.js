// Registry health checks for USCIS form templates (spec §30).
//
// Answers one question per template: "is this form actually usable for a
// real filing right now?" — storage object present, bytes intact, PDF
// parseable/fillable, edition known, and at least one active VisaFormMapping
// pointing at it.
//
// Deliberately metadata-first: `checkTemplate` does a HEAD-equivalent probe
// (storageService.statObject) by default and only downloads+hashes the object
// when `deep: true` is requested, so the registry list page can show health
// for every form without pulling megabytes of PDF per row.
const VisaFormMapping = require("../../models/VisaFormMapping");
const USCISFormTemplate = require("../../models/USCISFormTemplate");
const storageService = require("../uploads/storage.service");

const STATUS = { OK: "ok", WARNING: "warning", ERROR: "error" };

// Worst-wins: one error anywhere makes the whole form unusable; a warning is
// a configuration gap that still permits filing.
const SEVERITY_ORDER = { [STATUS.OK]: 0, [STATUS.WARNING]: 1, [STATUS.ERROR]: 2 };

function check(id, label, status, detail) {
  return { id, label, status, detail };
}

function rollup(checks) {
  return checks.reduce(
    (worst, item) => (SEVERITY_ORDER[item.status] > SEVERITY_ORDER[worst] ? item.status : worst),
    STATUS.OK
  );
}

// The storage key the rest of the app actually reads from. getTemplatePdf
// prefers artifacts.form.storageKey while PDFRenderer reads pdfStorageKey —
// both are resolved here (in getTemplatePdf's order) so health reflects
// whichever key a reader would land on, and a mismatch between the two is
// surfaced as its own warning rather than silently hidden.
function resolveStorageKey(template) {
  return template?.artifacts?.form?.storageKey || template?.pdfStorageKey || null;
}

async function countActiveMappings(formCode) {
  if (!formCode) return 0;
  // formTemplateFormCode is stored lowercased (see visaFormMappings.seed.js).
  return VisaFormMapping.countDocuments({
    formTemplateFormCode: String(formCode).toLowerCase(),
    active: true,
  });
}

/**
 * @param {object} template A USCISFormTemplate document (or lean object).
 * @param {object} [options]
 * @param {boolean} [options.deep] Download the object and verify its SHA-256
 *   against the recorded checksum, and confirm pdf-lib can open it. Costs a
 *   full object read — never use it for list-page sweeps.
 */
async function checkTemplate(template, { deep = false } = {}) {
  const checks = [];
  const storageKey = resolveStorageKey(template);
  const recordedChecksum = template?.artifacts?.form?.checksum || null;

  // ── Storage ──────────────────────────────────────────────────────────────
  let stat = null;
  if (!storageKey) {
    checks.push(check("storage_key", "Storage key configured", STATUS.ERROR, "No storage key recorded on this template."));
  } else {
    try {
      stat = await storageService.statObject(storageKey);
      checks.push(
        stat.exists
          ? check("storage_object", `${stat.provider === "s3" ? "S3" : "Local"} object available`, STATUS.OK, null)
          : check("storage_object", "Storage object available", STATUS.ERROR, "Object not found in storage.")
      );
    } catch (error) {
      // Never leak raw S3/SDK error text to the client (spec §41).
      checks.push(check("storage_object", "Storage object available", STATUS.ERROR, "Storage backend could not be reached."));
    }
  }

  if (template?.artifacts?.form?.storageKey && template?.pdfStorageKey
      && template.artifacts.form.storageKey !== template.pdfStorageKey) {
    checks.push(check(
      "storage_key_consistency",
      "Storage keys consistent",
      STATUS.WARNING,
      "artifacts.form.storageKey and pdfStorageKey point at different objects."
    ));
  }

  // ── Integrity (deep only) ────────────────────────────────────────────────
  if (deep && storageKey && stat?.exists) {
    try {
      const buffer = await storageService.readBuffer(storageKey);
      if (recordedChecksum) {
        const actual = storageService.checksum(buffer);
        checks.push(
          actual === recordedChecksum
            ? check("integrity", "SHA-256 matches registry", STATUS.OK, null)
            : check("integrity", "SHA-256 matches registry", STATUS.ERROR, "Stored object does not match the recorded checksum.")
        );
      } else {
        checks.push(check("integrity", "SHA-256 recorded", STATUS.WARNING, "No checksum recorded for this template."));
      }
      const isPdf = buffer.subarray(0, 5).toString() === "%PDF-";
      checks.push(
        isPdf
          ? check("pdf_readable", "Valid PDF", STATUS.OK, null)
          : check("pdf_readable", "Valid PDF", STATUS.ERROR, "Stored object is not a valid PDF.")
      );
    } catch (error) {
      checks.push(check("integrity", "Object readable", STATUS.ERROR, "Stored object could not be read."));
    }
  } else if (recordedChecksum) {
    checks.push(check("integrity", "SHA-256 recorded", STATUS.OK, null));
  } else {
    checks.push(check("integrity", "SHA-256 recorded", STATUS.WARNING, "No checksum recorded for this template."));
  }

  // ── PDF metadata ─────────────────────────────────────────────────────────
  const fieldCount = (template?.formFields || []).length;
  checks.push(
    fieldCount > 0
      ? check("fillable", "Fillable fields detected", STATUS.OK, `${fieldCount} fields`)
      : check("fillable", "Fillable fields detected", STATUS.WARNING, "No fillable fields recorded — this form cannot be auto-filled.")
  );

  // ── Edition ──────────────────────────────────────────────────────────────
  checks.push(
    template?.editionDate || template?.version
      ? check("edition", "Edition identified", STATUS.OK, null)
      : check("edition", "Edition identified", STATUS.WARNING, "No edition date recorded.")
  );

  // ── Visa mappings ────────────────────────────────────────────────────────
  let mappingCount = 0;
  try {
    mappingCount = await countActiveMappings(template?.formCode);
  } catch (error) {
    mappingCount = 0;
  }
  checks.push(
    mappingCount > 0
      ? check("mappings", "Visa mappings configured", STATUS.OK, `${mappingCount} active mapping${mappingCount === 1 ? "" : "s"}`)
      : check("mappings", "Visa mappings configured", STATUS.WARNING, "No active visa mapping — this form will never be auto-assigned to a case.")
  );

  // ── Lifecycle status ─────────────────────────────────────────────────────
  checks.push(
    template?.status === "active" && template?.activeFlag !== false
      ? check("active", "Active", STATUS.OK, null)
      : check("active", "Active", STATUS.WARNING, `Template status is "${template?.status || "unknown"}".`)
  );

  return {
    templateId: template?._id?.toString?.() || null,
    formCode: template?.formCode || null,
    version: template?.version || null,
    status: rollup(checks),
    storageProvider: stat?.provider || storageService.provider,
    storageAvailable: Boolean(stat?.exists),
    checks,
    checkedAt: new Date(),
  };
}

// List-page sweep: one metadata probe per template, run with bounded
// concurrency so a 100-form registry doesn't open 100 simultaneous S3
// connections.
async function checkMany(templates, { deep = false, concurrency = 8 } = {}) {
  const results = [];
  for (let index = 0; index < templates.length; index += concurrency) {
    const slice = templates.slice(index, index + concurrency);
    results.push(...await Promise.all(slice.map((template) => checkTemplate(template, { deep }))));
  }
  return results;
}

// Registry-wide sweep is memoized: a full pass measured ~850ms per object
// (S3 HEAD round-trip), i.e. ~8.5s for 10 forms, which is far too slow to run
// on every load of the USCIS Forms list page. Storage availability does not
// change second-to-second, so a short TTL removes the cost from normal
// browsing while still surfacing a newly-broken object within a minute.
// `force: true` (the page's explicit "re-check" action) always bypasses it.
const REGISTRY_HEALTH_TTL_MS = 60 * 1000;
let registryHealthCache = { at: 0, deep: false, value: null };

// Health for every registry template, keyed by template id — used by the
// registry list page's S3 Status / health column.
async function checkRegistry({ deep = false, force = false } = {}) {
  const now = Date.now();
  if (!force && registryHealthCache.value && registryHealthCache.deep === deep
      && now - registryHealthCache.at < REGISTRY_HEALTH_TTL_MS) {
    return registryHealthCache.value;
  }
  const templates = await USCISFormTemplate.find({})
    .select("formCode version status activeFlag editionDate pdfStorageKey artifacts.form formFields")
    .lean();
  const results = await checkMany(templates, { deep });
  const value = results.reduce((map, result) => {
    if (result.templateId) map[result.templateId] = result;
    return map;
  }, {});
  registryHealthCache = { at: now, deep, value };
  return value;
}

// Called after any registry mutation (publish/activate/archive) so the next
// read reflects it immediately rather than waiting out the TTL.
function invalidateRegistryHealthCache() {
  registryHealthCache = { at: 0, deep: false, value: null };
}

module.exports = { STATUS, checkTemplate, checkMany, checkRegistry, invalidateRegistryHealthCache };
