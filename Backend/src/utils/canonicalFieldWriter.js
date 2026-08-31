// Shared write logic for provenance-tracked canonicalData fields on
// EmployerProfile and EmployeeProfile.

const ALLOWED_SOURCES = new Set(["questionnaire", "ocr", "case_manager_edit", "import", "form_edit"]);
const STAFF_ROLES = new Set(["super_admin", "admin", "team_lead", "case_manager", "attorney", "paralegal"]);
const STAFF_AUTHORITATIVE_SOURCES = new Set(["case_manager_edit", "form_edit"]);

function resolveSchemaPath(Model, canonicalPath) {
  return Model.schema.path(`canonicalData.${canonicalPath}.value`);
}

function validateFieldPaths(Model, fields) {
  return Object.keys(fields || {}).filter((fieldPath) => !resolveSchemaPath(Model, fieldPath));
}

function getExistingField(existingDoc, fieldPath) {
  if (!existingDoc) return null;
  return fieldPath.split(".").reduce((node, key) => (node == null ? node : node[key]), existingDoc.canonicalData) || null;
}

function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isStaffUser(user) {
  return STAFF_ROLES.has(user?.role);
}

function resolveCanonicalWriteSource(user, requestedSource, fallback = "questionnaire") {
  const requested = ALLOWED_SOURCES.has(requestedSource) ? requestedSource : fallback;
  if (!isStaffUser(user) && STAFF_AUTHORITATIVE_SOURCES.has(requested)) return "questionnaire";
  return ALLOWED_SOURCES.has(requested) ? requested : "questionnaire";
}

function conflictPayload({ value, source, sourceId, sourceField, revision, now, userId, reason }) {
  return {
    conflictValue: value,
    conflictSource: source,
    conflictSourceId: sourceId || null,
    conflictSourceField: sourceField || null,
    conflictRevision: revision ?? null,
    conflictAt: now,
    conflictBy: userId || null,
    conflictReason: reason || null,
  };
}

function clearConflictPayload() {
  return {
    conflictValue: null,
    conflictSource: null,
    conflictSourceId: null,
    conflictSourceField: null,
    conflictRevision: null,
    conflictAt: null,
    conflictBy: null,
    conflictReason: null,
  };
}

function historyEntry({ value, source, sourceId, sourceField, now, userId, revision, action, reason, changeId }) {
  return {
    value,
    source,
    sourceId: sourceId || null,
    sourceField: sourceField || null,
    updatedAt: now,
    updatedBy: userId || null,
    revision,
    action,
    reason: reason || null,
    changeId: changeId || null,
  };
}

function buildCanonicalUpdate({
  Model,
  existingDoc,
  fields,
  source,
  userId,
  now = new Date(),
  sourceId = null,
  sourceFieldPrefix = null,
  sourceFields = {},
  expectedRevisions = {},
  profileOwner = null,
  caseScope = null,
  changeId = null,
  reason = null,
}) {
  const setOps = { updatedAt: now, updatedBy: userId };
  const incOps = {};
  const pushOps = {};
  const applied = [];
  const conflicted = [];

  for (const [fieldPath, value] of Object.entries(fields || {})) {
    const base = `canonicalData.${fieldPath}`;
    const existing = getExistingField(existingDoc, fieldPath);
    const existingRevision = Number(existing?.revision || 0);
    const expectedRevision = expectedRevisions[fieldPath];
    const resolvedSourceField = sourceFields[fieldPath] || (sourceFieldPrefix ? `${sourceFieldPrefix}.${fieldPath}` : null);
    const resolvedChangeId = changeId ? `${changeId}:${fieldPath}` : null;

    if (resolvedChangeId && existing?.lastChangeId === resolvedChangeId) {
      applied.push(fieldPath);
      continue;
    }

    if (expectedRevision !== undefined && Number(expectedRevision) !== existingRevision) {
      setOps[`${base}.conflictPending`] = conflictPayload({
        value,
        source,
        sourceId,
        sourceField: resolvedSourceField,
        revision: Number(expectedRevision),
        now,
        userId,
        reason: reason || "stale_revision",
      });
      conflicted.push(fieldPath);
      continue;
    }

    if ((existing?.locked || STAFF_AUTHORITATIVE_SOURCES.has(existing?.source)) && !STAFF_AUTHORITATIVE_SOURCES.has(source) && !valuesEqual(existing?.value, value)) {
      setOps[`${base}.conflictPending`] = conflictPayload({
        value,
        source,
        sourceId,
        sourceField: resolvedSourceField,
        revision: existingRevision,
        now,
        userId,
        reason: reason || (existing?.locked ? "locked_field" : "staff_override"),
      });
      conflicted.push(fieldPath);
      continue;
    }

    if (valuesEqual(existing?.value, value) && existing?.source === source) {
      setOps[`${base}.sourceId`] = sourceId || existing?.sourceId || null;
      setOps[`${base}.sourceField`] = resolvedSourceField || existing?.sourceField || null;
      setOps[`${base}.updatedAt`] = now;
      setOps[`${base}.updatedBy`] = userId;
      setOps[`${base}.profileOwner`] = profileOwner || existing?.profileOwner || null;
      setOps[`${base}.caseScope`] = caseScope || existing?.caseScope || null;
      if (resolvedChangeId) setOps[`${base}.lastChangeId`] = resolvedChangeId;
      applied.push(fieldPath);
      continue;
    }

    const nextRevision = existingRevision + 1;
    setOps[`${base}.value`] = value;
    setOps[`${base}.source`] = source;
    setOps[`${base}.sourceId`] = sourceId || null;
    setOps[`${base}.sourceField`] = resolvedSourceField || null;
    setOps[`${base}.updatedAt`] = now;
    setOps[`${base}.updatedBy`] = userId;
    setOps[`${base}.profileOwner`] = profileOwner || null;
    setOps[`${base}.caseScope`] = caseScope || null;
    if (resolvedChangeId) setOps[`${base}.lastChangeId`] = resolvedChangeId;
    if (STAFF_AUTHORITATIVE_SOURCES.has(source)) {
      setOps[`${base}.locked`] = true;
      setOps[`${base}.conflictPending`] = clearConflictPayload();
    }
    incOps[`${base}.revision`] = 1;
    pushOps[`${base}.history`] = {
      $each: [historyEntry({
        value,
        source,
        sourceId,
        sourceField: resolvedSourceField,
        now,
        userId,
        revision: nextRevision,
        action: STAFF_AUTHORITATIVE_SOURCES.has(source) ? "authoritative_write" : "field_write",
        reason,
        changeId: resolvedChangeId,
      })],
      $slice: -25,
    };
    applied.push(fieldPath);
  }

  return { setOps, incOps, pushOps, applied, conflicted };
}

module.exports = {
  validateFieldPaths,
  buildCanonicalUpdate,
  resolveCanonicalWriteSource,
  getExistingField,
};
