// Phase 2: MappingContractValidator. Pure (no database, no network): it judges a mapping edge, or a whole graph, against what the autofill engine really supports.
//
// An edge is held to the contract in one of two severities (plan Rule A):
//   ENFORCED    - a NEW or CHANGED edge (origin authored / inferred / ai / scored): every violation is an ERROR and the edge cannot go live;
//   REPORT-ONLY - a LEGACY edge (it was live before origins existed): the same violations are listed per form with a remediation status, never blocking.
// Checks: source path resolvable, type compatibility, supported transform + referenced paths, condition / fallback / array references, party ownership, derived
// metadata not stale, valid status and origin. Unmapped form fields are classified intentional / optional / out-of-scope / unresolved.
const { ORIGINS, EDGE_STATUSES, originOf } = require("./MappingPolicy");
const { SUPPORTED_TRANSFORMS, CONDITION_OPERATORS } = require("./transformTypes");

const CODES = Object.freeze({
  PATH_UNKNOWN: "PATH_UNKNOWN",
  TYPE_INCOMPATIBLE: "TYPE_INCOMPATIBLE",
  TRANSFORM_UNSUPPORTED: "TRANSFORM_UNSUPPORTED",
  TRANSFORM_PATH_UNKNOWN: "TRANSFORM_PATH_UNKNOWN",
  CONDITION_OPERATOR_UNSUPPORTED: "CONDITION_OPERATOR_UNSUPPORTED",
  CONDITION_PATH_UNKNOWN: "CONDITION_PATH_UNKNOWN",
  FALLBACK_PATH_UNKNOWN: "FALLBACK_PATH_UNKNOWN",
  ARRAY_REFERENCE_BROKEN: "ARRAY_REFERENCE_BROKEN",
  PARTY_CONTRADICTION: "PARTY_CONTRADICTION",
  STALE_DERIVED_METADATA: "STALE_DERIVED_METADATA",
  STATUS_INVALID: "STATUS_INVALID",
  ORIGIN_INVALID: "ORIGIN_INVALID",
});

const norm = (value) => String(value ?? "").toLowerCase();
const isCheckboxLike = (type) => /check|radio|choice|boolean/.test(norm(type));
const isDateLike = (type) => /date/.test(norm(type));

/** The party a piece of form text speaks about: "petitioner" (employer / sponsor side), "beneficiary" (the person the form is for), or null when unclear / both. */
function partyOfText(text) {
  const value = norm(text);
  const petitioner = /\b(petitioner|employer|sponsor|company|organization)\b/.test(value);
  const beneficiary = /\b(beneficiary|applicant|worker|employee|alien)\b/.test(value);
  if (petitioner === beneficiary) return null; // both or neither: not a contradiction we can prove
  return petitioner ? "petitioner" : "beneficiary";
}
const partyOfPath = (path) => {
  const root = String(path || "").split(".")[0];
  if (["petitioner", "company", "employer"].includes(root)) return "petitioner";
  if (["beneficiary", "employee"].includes(root)) return "beneficiary";
  return null;
};

function conditionPaths(rule, out = []) {
  if (!rule || typeof rule !== "object") return out;
  if (Array.isArray(rule.all)) rule.all.forEach((item) => conditionPaths(item, out));
  if (Array.isArray(rule.any)) rule.any.forEach((item) => conditionPaths(item, out));
  const path = rule.field || rule.source || rule.path || rule.sourceFieldId || rule.questionKey;
  if (path && !rule.all && !rule.any) out.push({ path: String(path), operator: rule.operator });
  return out;
}

/**
 * One edge. ctx: { universe, target? } where universe.check(path) answers { known, via, exact, entry } and target is the form field the edge writes to.
 * Returns the violations (all of them; the caller decides severity by the edge's origin).
 */
function checkEdge(edge, ctx) {
  const found = [];
  const add = (code, detail) => found.push({ code, mappingId: edge.mappingId, targetFieldId: edge.targetFieldId, ...detail });
  const universe = ctx.universe;
  const source = universe.check(edge.sourcePath);

  if (!edge.sourcePath || !source.known) add(CODES.PATH_UNKNOWN, { sourcePath: edge.sourcePath, reason: "the source path is not in the live registry and is not produced by any profile map or question" });

  // type compatibility: only clear contradictions (a date written into a checkbox, a yes/no written into a date box)
  const sourceType = norm(source.entry?.type);
  const targetType = norm(edge.targetType || ctx.target?.type);
  const transformType = norm(edge.transform?.type);
  if (source.exact && sourceType && targetType) {
    const toCheckbox = isCheckboxLike(targetType) && !["checkbox", "boolean", "listitem", "constant", "digitat"].includes(transformType);
    if (toCheckbox && ["date", "email", "phone"].includes(sourceType)) add(CODES.TYPE_INCOMPATIBLE, { sourceType, targetType, reason: `a ${sourceType} value cannot fill a ${targetType} box without a checkbox / boolean transform` });
    if (isDateLike(targetType) && sourceType === "boolean") add(CODES.TYPE_INCOMPATIBLE, { sourceType, targetType, reason: "a yes/no value cannot fill a date box" });
  }

  const transform = edge.transform && typeof edge.transform === "object" ? edge.transform : null;
  if (transform?.type && !SUPPORTED_TRANSFORMS.includes(transform.type)) add(CODES.TRANSFORM_UNSUPPORTED, { transform: transform.type, reason: "the autofill engine has no such transform" });
  for (const reference of [...(Array.isArray(transform?.fields) ? transform.fields : []), ...(transform?.source ? [transform.source] : []), ...(transform?.path ? [transform.path] : [])]) {
    if (typeof reference === "string" && reference && !universe.check(reference).known) add(CODES.TRANSFORM_PATH_UNKNOWN, { path: reference });
  }

  for (const reference of conditionPaths(edge.condition)) {
    if (reference.operator !== undefined && !CONDITION_OPERATORS.includes(reference.operator)) add(CODES.CONDITION_OPERATOR_UNSUPPORTED, { operator: reference.operator, path: reference.path });
    const path = reference.path.replace(/^canonicalData\./, "");
    if (!/^filledData\./.test(path) && !universe.check(path).known) add(CODES.CONDITION_PATH_UNKNOWN, { path });
  }
  if (edge.fallback && !universe.check(edge.fallback).known) add(CODES.FALLBACK_PATH_UNKNOWN, { path: edge.fallback });

  if ((edge.mappingType === "repeating" || transform?.type === "arrayItem") && !(edge.repeatable?.sourceCollection || transform?.collection)) add(CODES.ARRAY_REFERENCE_BROKEN, { reason: "a repeating / arrayItem edge needs the collection it reads" });

  // party ownership: only when the form field's own text names exactly one side and the source path names the other
  const targetParty = partyOfText([edge.targetLabel, edge.section, edge.targetPdfField].join(" "));
  const sourceParty = partyOfPath(edge.sourcePath);
  if (targetParty && sourceParty && targetParty !== sourceParty) add(CODES.PARTY_CONTRADICTION, { targetParty, sourceParty, reason: `the form field speaks about the ${targetParty} but reads a ${sourceParty} path` });

  // derived metadata must follow the source path (stale derived data is an error)
  // a party rule's source is the rule's path, or the first path of its transform (PartyFieldMappingService: sourcePath = rule.transform.fields[0] || rule.to)
  if (edge.partyRule && edge.sourcePath !== (transform?.fields?.[0] || edge.partyRule)) add(CODES.STALE_DERIVED_METADATA, { field: "partyRule", partyRule: edge.partyRule, sourcePath: edge.sourcePath });
  if (edge.partyRule && edge.profileOwner) {
    const expected = String(edge.partyRule).startsWith("petitioner") ? "employer" : "employee";
    if (edge.profileOwner !== expected) add(CODES.STALE_DERIVED_METADATA, { field: "profileOwner", profileOwner: edge.profileOwner, expected });
  }

  if (edge.status !== undefined && !EDGE_STATUSES.includes(edge.status)) add(CODES.STATUS_INVALID, { status: edge.status });
  if (edge.origin !== undefined && !ORIGINS.includes(edge.origin)) add(CODES.ORIGIN_INVALID, { origin: edge.origin });
  return found.filter((violation) => !isAcknowledged(edge, violation.code));
}

/**
 * A person has looked at this finding on this edge and decided it is not a defect (for example a form field whose extracted label names one party while its real PDF
 * name and the authored note name the other). Recorded ON the edge as { code, reason, at, by } so the decision is visible, dated and reversible; it silences ONLY that
 * code on ONLY that edge, and an exception with no written reason does not count.
 */
function isAcknowledged(edge, code) {
  return (edge.contractExceptions || []).some((item) => item && item.code === code && String(item.reason || "").trim().length >= 10);
}

const SKIP_TYPES = new Set(["signature", "button", "barcode", "image", "pushbutton"]);

/** How an UNMAPPED form field is classified: intentional (not data), out_of_scope (for office use), unresolved (required, nobody mapped it) or optional. */
function classifyUnmapped(field = {}) {
  const type = norm(field.fieldType || field.type || field.semanticType);
  const text = norm([field.label, field.fieldLabel, field.sectionTitle, field.section, field.pdfFieldName, field.fieldName].join(" "));
  if (SKIP_TYPES.has(type) || /barcode|signature/.test(text)) return "intentional";
  if (/for (uscis|office|government) use only|office use|a-?file number block|action block/.test(text)) return "out_of_scope";
  if (field.required || field.validation?.required || field.validationRules?.required) return "unresolved";
  return "optional";
}

/**
 * The whole graph. Returns:
 *   errors         violations of ENFORCED edges (new / changed)  - these make the graph invalid for activation
 *   legacy         violations of LEGACY edges                     - report only, with remediation "needs_fix"
 *   unmapped       { intentional, out_of_scope, optional, unresolved } counts + the first unresolved fields
 *   summary        counts
 */
function validateGraphContract(graph = {}, template = {}, { universe, getTemplateFields } = {}) {
  const fields = (getTemplateFields ? getTemplateFields(template) : template.formFields || []);
  const targetsById = new Map(fields.map((field) => [field.targetFieldId || field.fieldId || field.id || field.fieldName, field]));
  const errors = [];
  const legacy = [];
  let enforcedEdges = 0;
  let legacyEdges = 0;
  for (const edge of graph.edges || []) {
    const violations = checkEdge(edge, { universe, target: targetsById.get(edge.targetFieldId) });
    if (originOf(edge) === "legacy") { legacyEdges += 1; legacy.push(...violations.map((violation) => ({ ...violation, remediation: "needs_fix" }))); } else { enforcedEdges += 1; errors.push(...violations); }
  }
  const mapped = new Set((graph.edges || []).filter((edge) => edge.status === "active").map((edge) => edge.targetFieldId));
  const unmapped = { intentional: 0, out_of_scope: 0, optional: 0, unresolved: 0, keptBlank: 0, unresolvedFields: [] };
  const keptBlank = new Set((graph.keepBlank || []).map((entry) => entry.targetFieldId));
  for (const field of fields) {
    const id = field.targetFieldId || field.fieldId || field.id || field.fieldName;
    if (!id || mapped.has(id)) continue;
    if (keptBlank.has(id)) { unmapped.keptBlank += 1; continue; } // a person decided this box stays empty
    const kind = classifyUnmapped(field);
    unmapped[kind] += 1;
    if (kind === "unresolved" && unmapped.unresolvedFields.length < 50) unmapped.unresolvedFields.push(id);
  }
  const byCode = {};
  [...errors, ...legacy].forEach((item) => { byCode[item.code] = (byCode[item.code] || 0) + 1; });
  return {
    valid: errors.length === 0,
    errors,
    legacy: legacy.slice(0, 200),
    unmapped,
    summary: { enforcedEdges, legacyEdges, errors: errors.length, legacyViolations: legacy.length, byCode },
  };
}

module.exports = { CODES, isAcknowledged, checkEdge, validateGraphContract, classifyUnmapped, partyOfText, partyOfPath, conditionPaths };
