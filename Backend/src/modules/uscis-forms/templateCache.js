// Keeps USCIS form templates in memory for the busy case-form paths (saving a box, opening the review workspace, downloading a form).
// A template is large (the live I-129 is ~8 MB even without its raw `definition`) and the same one was re-read from the database on EVERY box
// save and EVERY download - the main reason both were slow. It changes only when the form is re-imported or remapped.
//
// Always correct: before each use one tiny query reads the template's change stamp (updatedAt, __v, its mapping version ids, status); any change
// loads it fresh. Every caller gets its OWN copy (a BSON round trip - exact types: ObjectIds, Dates), so one request can never change what another
// sees. Read-only: nothing here writes a template. Any failure returns null and the caller falls back to its normal populate().
const mongoose = require("mongoose");
const USCISFormTemplate = require("../../models/USCISFormTemplate");

const MAX_ENTRIES = 30;
const STAMP_FIELDS = "updatedAt __v activeMappingVersionId latestMappingVersionId mappingVersion mappingStatus status";
const cache = new Map(); // `${id}|${select}` -> { stamp, raw (BSON bytes) }
const { BSON } = mongoose.mongo;

const idOf = (value) => String(value?._id || value || "");
// "-definition" -> { definition: 0 }; "a b" -> { a: 1, b: 1 }
function projectionOf(select) {
  const tokens = String(select || "").split(/\s+/).filter(Boolean);
  if (!tokens.length) return undefined;
  return Object.fromEntries(tokens.map((token) => (token.startsWith("-") ? [token.slice(1), 0] : [token, 1])));
}

async function stampOf(id, Model) {
  const row = await Model.findById(id).select(STAMP_FIELDS).lean();
  if (!row) return null;
  return JSON.stringify([row.updatedAt, row.__v, row.activeMappingVersionId, row.latestMappingVersionId, row.mappingVersion, row.mappingStatus, row.status].map((v) => (v == null ? null : String(v))));
}

/** A hydrated template document (same as a populate() result), or null when it cannot be served from here. Never throws. */
async function getTemplateDocument(templateId, { select = "-definition", Model = USCISFormTemplate } = {}) {
  try {
    const id = idOf(templateId);
    if (!mongoose.isValidObjectId(id)) return null;
    const key = `${id}|${select}`;
    const stamp = await stampOf(id, Model);
    if (stamp === null) return null;
    let entry = cache.get(key);
    if (!entry || entry.stamp !== stamp) {
      const plain = await Model.findById(id).select(select).lean();
      if (!plain) return null;
      entry = { stamp, raw: BSON.serialize(plain) };
      cache.delete(key);
      cache.set(key, entry);
      while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
    } else {
      cache.delete(key); // keep the most recently used last
      cache.set(key, entry);
    }
    const copy = BSON.deserialize(entry.raw, { promoteBuffers: true });
    // a selected-fields document: Mongoose must know which paths were left out (exactly like the projected populate() it replaces)
    return Model.hydrate(copy, projectionOf(select));
  } catch (_error) {
    return null;
  }
}

/**
 * Puts the cached template on caseForm.formTemplateId (as a populated document). Returns true when it did; false leaves the case form untouched so
 * the caller does its own populate() exactly as before.
 */
async function attachTemplate(caseForm, options = {}) {
  if (!caseForm?.formTemplateId) return false;
  if (typeof caseForm.populated === "function" && caseForm.populated("formTemplateId")) return true;
  // already a template object (not just an id), e.g. handed in by a caller: nothing to do
  const ref = caseForm.formTemplateId;
  if (typeof ref === "object" && !(ref instanceof mongoose.Types.ObjectId) && ref._bsontype !== "ObjectId" && Object.keys(ref.toObject ? ref.toObject() : ref).some((key) => key !== "_id")) return true;
  if (typeof caseForm.populated !== "function") return false; // not a Mongoose document: leave it to the caller
  const template = await getTemplateDocument(caseForm.formTemplateId, options);
  if (!template || idOf(template._id) !== idOf(caseForm.formTemplateId)) return false;
  caseForm.formTemplateId = template;
  return typeof caseForm.populated !== "function" || Boolean(caseForm.populated("formTemplateId"));
}

// ── mapping versions (the box -> canonical path graph; ~0.9 MB for the I-129, read on every open, twice) ──
// Same guarantees: a change stamp is checked before every use, every caller gets its own plain copy (as .lean() returns), any failure returns
// undefined so the caller does its normal query.
const mappingCache = new Map(); // id -> { stamp, raw }
async function getMappingVersionLean(mappingVersionId, { Model } = {}) {
  try {
    const id = idOf(mappingVersionId);
    if (!mongoose.isValidObjectId(id)) return undefined;
    const VersionModel = Model || require("../../models/USCISMappingVersion");
    const row = await VersionModel.findById(id).select("updatedAt __v status").lean();
    if (!row) return null; // same as findById(...).lean() for a missing version
    const stamp = JSON.stringify([row.updatedAt, row.__v, row.status].map((v) => (v == null ? null : String(v))));
    let entry = mappingCache.get(id);
    if (!entry || entry.stamp !== stamp) {
      const plain = await VersionModel.findById(id).lean();
      if (!plain) return null;
      entry = { stamp, raw: BSON.serialize(plain) };
      mappingCache.delete(id);
      mappingCache.set(id, entry);
      while (mappingCache.size > MAX_ENTRIES) mappingCache.delete(mappingCache.keys().next().value);
    } else {
      mappingCache.delete(id);
      mappingCache.set(id, entry);
    }
    return BSON.deserialize(entry.raw, { promoteBuffers: true });
  } catch (_error) {
    return undefined;
  }
}

module.exports = { getTemplateDocument, attachTemplate, getMappingVersionLean, _cache: cache, _mappingCache: mappingCache };
