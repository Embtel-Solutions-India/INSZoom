// Phase 7.2: the template document must fit MongoDB's 16 MB document limit. The I-129 template is already close to it (formFields for ~980 boxes plus the structures
// built from them), and a larger edition would fail at save time with an opaque BSON error. This guard measures the document BEFORE it is saved and, when it is too big,
// reports the size of every top-level key so the error-resolution engine (and a person reading the alert) can see what to shrink.
//
// Estimate: the exact BSON size of the payload (mongoose.mongo.BSON.calculateObjectSize - the driver's own serializer, so it is exact, not a ratio guess) PLUS the structures the
// model's pre-validate hook copies when they are empty (renderingConfiguration <- formLayout + formStructure, validationConfiguration <- validationRules,
// mappingConfiguration <- mappingGraph; models/USCISFormTemplate.js), PLUS a 3% margin for the fields the hook and the versioning step add. Pure; no database.
const BYTES = 1024 * 1024;
const DEFAULT_LIMIT = 14.5 * BYTES; // 1.5 MB below the 16 MB hard limit

function bsonSize(value) {
  const { BSON } = require("mongoose").mongo;
  return BSON.calculateObjectSize({ v: value === undefined ? null : value }) - 8; // minus the wrapper document ("v" key + header)
}

const isEmpty = (value) => !value || (typeof value === "object" && Object.keys(value).length === 0);

/** { estimate, sizes: {key: bytes} (largest first), copies: {key: bytes}, limit } for a template payload. */
function measure(doc, { limit = DEFAULT_LIMIT } = {}) {
  const sizes = {};
  for (const [key, value] of Object.entries(doc || {})) sizes[key] = bsonSize(value);
  const copies = {};
  if (isEmpty(doc?.renderingConfiguration)) copies.renderingConfiguration = bsonSize({ layout: doc?.formLayout || {}, structure: doc?.formStructure || {} });
  if (isEmpty(doc?.validationConfiguration)) copies.validationConfiguration = bsonSize(doc?.validationRules || {});
  if (isEmpty(doc?.mappingConfiguration)) copies.mappingConfiguration = bsonSize(doc?.mappingGraph || {});
  const base = bsonSize(doc || {});
  const estimate = Math.round((base + Object.values(copies).reduce((a, b) => a + b, 0)) * 1.03);
  const ordered = Object.fromEntries(Object.entries(sizes).sort((a, b) => b[1] - a[1]));
  return { estimate, sizes: ordered, copies, limit };
}

/** { ok, estimate, limit, sizes, code? } - ok is false at more than the limit (14.5 MB by default; env TEMPLATE_MAX_BYTES lowers or raises it, never above 15.5 MB). */
function check(doc, options = {}) {
  const env = options.env || process.env;
  const configured = Number(env.TEMPLATE_MAX_BYTES);
  const limit = options.limit || (Number.isFinite(configured) && configured > 0 ? Math.min(configured, 15.5 * BYTES) : DEFAULT_LIMIT);
  const measured = measure(doc, { limit });
  const top = Object.entries(measured.sizes).slice(0, 8).map(([key, bytes]) => `${key} ${(bytes / BYTES).toFixed(2)} MB`).join(", ");
  const result = { ok: measured.estimate <= limit, estimate: measured.estimate, limit, sizes: measured.sizes, copies: measured.copies, summary: top };
  if (!result.ok) result.code = "TEMPLATE_TOO_LARGE";
  return result;
}

/** The coded error thrown at the import's save step. Carries the breakdown so the resolver and the alert can show it. */
function tooLargeError(result) {
  const error = new Error(`The form template would be ${(result.estimate / BYTES).toFixed(2)} MB, over the ${(result.limit / BYTES).toFixed(1)} MB limit (largest parts: ${result.summary})`);
  error.code = "TEMPLATE_TOO_LARGE";
  error.status = 413;
  error.statusCode = 413;
  error.cause = "template_too_large";
  error.sizes = result.sizes;
  return error;
}

// The copies the importer writes into definition.* from the SAME scanResult values as the top-level fields (USCISFormImporterService.js builds both in one expression each; the
// note in uscis-form.service.js records that nothing on the render / workspace / generation path reads them and that the import controller only reads them as FALLBACKS after
// the top-level value). Tier 1 = structures with a top-level twin; tier 2 = definition.fields (the scan list the top-level formFields is built from).
const TIERS = [
  [["formStructure", (p) => p.formStructure], ["layout", (p) => p.formLayout], ["questions", (p) => p.formStructure?.questions || []], ["indexes", (p) => p.fieldIndexes],
    ["dependencies", (p) => p.fieldDependencies], ["validation", (p) => p.validationRules], ["sections", (p) => p.sections]],
  [["fields", (p) => p.formFields]],
];
const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Pure. Drops from payload.definition ONLY the copies that are proven identical, at this moment, to their top-level twin (deep-equal check, not an assumption), tier by tier,
 * and stops as soon as the estimate fits. Never mutates the input. { payload, removed: [key...], before, after, ok }.
 */
function slim(payload, options = {}) {
  const before = check(payload, options);
  const definition = { ...(payload?.definition || {}) };
  const removed = [];
  let current = payload;
  let last = before;
  for (const tier of TIERS) {
    if (last.ok) break;
    for (const [key, twin] of tier) {
      if (!(key in definition)) continue;
      if (!sameJson(definition[key], twin(payload))) continue; // not identical: kept
      delete definition[key];
      removed.push(key);
    }
    current = { ...payload, definition };
    last = check(current, options);
  }
  return { payload: removed.length ? current : payload, removed, before, after: last, ok: last.ok };
}

module.exports = { slim, measure, check, tooLargeError, bsonSize, DEFAULT_LIMIT, BYTES };
