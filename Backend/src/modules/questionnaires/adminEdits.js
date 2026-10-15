// Edits made on the Questionnaire page must outlive the built-in definition reconciler (questionnaire.service.js reconcileDefinition), which
// re-applies the code definitions to the stored templates. Rather than blocking the reconciler, each edit records WHICH fields the designer
// changed (Question.adminEditedFields / Questionnaire.adminEditedFields) and the reconciler leaves exactly those alone, so everything the
// designer did not touch still receives later code improvements. Pure helpers, no DB.

// Never recorded as a designer edit (bookkeeping / identity / timestamps, or the markers themselves).
const IGNORED_FIELDS = new Set([
  "_id", "id", "__v", "createdAt", "updatedAt", "createdBy", "updatedBy", "adminEditedFields", "adminCreated",
  "questionnaire", "questionnaireKey", "questionnaireVersion",
]);

// The Questionnaire-level fields the reconciler would otherwise reset from the code definition.
const QUESTIONNAIRE_TRACKED_FIELDS = [
  "title", "description", "visaType", "visaTypes", "checklistRole", "isDefault", "isTemplate", "templateCategory",
  "assignmentRules", "sections", "pages", "builder",
];

// Aliases the model mirrors into each other on save: editing one is an edit of the other.
const FIELD_ALIASES = { isActive: ["active"], active: ["isActive"], helpText: ["description"], description: ["helpText"], showIf: ["conditionalLogic"] };

// Structural comparison that ignores Mongoose's sub-document _id noise and key order, so a UI that echoes the whole object back does not
// mark every field as edited.
function canonical(value) {
  if (value === undefined) return null;
  if (value && typeof value.toObject === "function") value = value.toObject();
  return JSON.stringify(value, (key, nested) => {
    if (key === "_id" || key === "id" || key === "__v") return undefined;
    if (nested && typeof nested === "object" && !Array.isArray(nested) && !(nested instanceof Date)) {
      if (typeof nested.toHexString === "function") return String(nested);
      return Object.keys(nested).sort().reduce((sorted, name) => { sorted[name] = nested[name]; return sorted; }, {});
    }
    return nested;
  });
}

const sameValue = (left, right) => canonical(left) === canonical(right);

/** The fields of `incoming` whose value really differs from `current` (a plain object). `only` limits it to a field list. */
function changedFields(current, incoming, { only } = {}) {
  const plain = current && typeof current.toObject === "function" ? current.toObject() : (current || {});
  const changed = [];
  for (const field of Object.keys(incoming || {})) {
    if (IGNORED_FIELDS.has(field)) continue;
    if (only && !only.includes(field)) continue;
    if (!sameValue(plain[field], incoming[field])) changed.push(field);
  }
  // the aliases are mirrored question fields; a questionnaire-level call (`only`) names its fields exactly
  return only ? changed : expandAliases(changed);
}

function expandAliases(fields) {
  const all = new Set(fields);
  fields.forEach((field) => (FIELD_ALIASES[field] || []).forEach((alias) => all.add(alias)));
  return [...all];
}

/** Union, order-stable, de-duplicated. */
function mergeEditedFields(existing, added) {
  return [...new Set([...(existing || []), ...(added || [])])];
}

/** A copy of a reconcile patch without the fields the designer has edited. */
function withoutEditedFields(patch, editedFields) {
  const edited = new Set(editedFields || []);
  if (!edited.size) return patch;
  return Object.fromEntries(Object.entries(patch).filter(([field]) => !edited.has(field)));
}

const isEdited = (editedFields, field) => Boolean(editedFields && [...editedFields].includes(field));

/** A payload without the server-owned markers (a UI that echoes the whole object back must not be able to set or clear them). */
function stripMarkers(payload = {}) {
  const { adminEditedFields, adminCreated, ...rest } = payload;
  return rest;
}

module.exports = {
  QUESTIONNAIRE_TRACKED_FIELDS, changedFields, mergeEditedFields, withoutEditedFields, isEdited, stripMarkers, sameValue,
};
