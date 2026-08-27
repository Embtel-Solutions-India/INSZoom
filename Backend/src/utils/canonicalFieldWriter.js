// Shared write logic for the provenance-tracked canonicalData fields on
// EmployerProfile and EmployeeProfile (see their canonicalFieldSchema in
// Backend/src/models/). Centralized here so both profile types enforce the
// same rule: a field marked `locked` (a case manager correction) can never
// be silently overwritten by a later questionnaire/OCR/import submission —
// the conflicting incoming value is recorded on `conflictPending` instead,
// exactly as the schema's own doc comments already describe, for a case
// manager to resolve later. Until this file, that mechanism was defined on
// the schema but never implemented anywhere.

function resolveSchemaPath(Model, canonicalPath) {
  return Model.schema.path(`canonicalData.${canonicalPath}.value`);
}

// Returns the subset of `fields`' keys that don't resolve to a real
// canonicalData leaf on the given Model — used to reject unknown field
// paths with a 400 instead of Mongoose silently dropping them.
function validateFieldPaths(Model, fields) {
  return Object.keys(fields).filter((fieldPath) => !resolveSchemaPath(Model, fieldPath));
}

function getExistingField(existingDoc, fieldPath) {
  if (!existingDoc) return null;
  return fieldPath.split(".").reduce((node, key) => (node == null ? node : node[key]), existingDoc.canonicalData) || null;
}

// Builds the $set/$inc update for a batch of field writes, respecting
// `locked`. Returns { setOps, incOps, applied, conflicted } — `conflicted`
// lists fields that were NOT applied because they're locked and the
// incoming source isn't a case manager edit (their conflictPending was set
// instead); `applied` lists the rest.
function buildCanonicalUpdate({ Model, existingDoc, fields, source, userId, now = new Date() }) {
  const setOps = { updatedAt: now, updatedBy: userId };
  const incOps = {};
  const applied = [];
  const conflicted = [];

  for (const [fieldPath, value] of Object.entries(fields)) {
    const base = `canonicalData.${fieldPath}`;
    const existing = getExistingField(existingDoc, fieldPath);

    if (existing?.locked && source !== "case_manager_edit") {
      setOps[`${base}.conflictPending`] = { conflictValue: value, conflictSource: source, conflictAt: now };
      conflicted.push(fieldPath);
      continue;
    }

    setOps[`${base}.value`] = value;
    setOps[`${base}.source`] = source;
    setOps[`${base}.updatedAt`] = now;
    setOps[`${base}.updatedBy`] = userId;
    // A case manager edit resolves any prior pending conflict and locks the
    // field so a later questionnaire/OCR resubmission can't silently undo it.
    if (source === "case_manager_edit") {
      setOps[`${base}.locked`] = true;
      setOps[`${base}.conflictPending`] = { conflictValue: null, conflictSource: null, conflictAt: null };
    }
    incOps[`${base}.revision`] = 1;
    applied.push(fieldPath);
  }

  return { setOps, incOps, applied, conflicted };
}

module.exports = { validateFieldPaths, buildCanonicalUpdate };
