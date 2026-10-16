// Phase 2: MappingContractValidator, MappingCoverageService and the default-value classes. Pure, DB-free.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createPathUniverse } = require("../contract/PathUniverse");
const { checkEdge, validateGraphContract, classifyUnmapped, partyOfText, CODES } = require("../contract/MappingContractValidator");
const { computeCoverage, persistCoverage } = require("../contract/MappingCoverageService");
const { classifyDefault, summarizeDefaults, CATEGORIES } = require("../contract/defaultValueClassifier");
const { buildSnapshot, compareSnapshots, SNAPSHOT_FILE } = require("../../../scripts/defaultValueReport");
const FormMappingService = require("../services/FormMappingService");

const universe = createPathUniverse({
  registry: [{ path: "person.firstName", type: "text" }, { path: "person.dob", type: "date" }, { path: "person.gender", type: "boolean" }, { path: "contact.email", type: "email" }, { path: "beneficiary.firstName", type: "text" }, { path: "petitioner.name", type: "text" }, { path: "company.name", type: "text" }],
  alias: [], profile: [], library: [], rules: [],
});
const good = (over = {}) => ({ mappingId: "m1", targetFieldId: "f1", sourcePath: "person.firstName", targetType: "text", targetLabel: "Given Name", section: "Part 1", mappingType: "direct", transform: { type: "direct" }, status: "active", origin: "authored", ...over });
const codes = (edge, target) => checkEdge(edge, { universe, target }).map((item) => item.code);

test("a clean edge has no violations", () => assert.deepEqual(codes(good()), []));

test("an unknown source path, fallback, transform path or condition path is named", () => {
  assert.deepEqual(codes(good({ sourcePath: "made.up.path" })), [CODES.PATH_UNKNOWN]);
  assert.deepEqual(codes(good({ sourcePath: "" })), [CODES.PATH_UNKNOWN]);
  assert.deepEqual(codes(good({ fallback: "nope.nothing" })), [CODES.FALLBACK_PATH_UNKNOWN]);
  assert.deepEqual(codes(good({ transform: { type: "concat", fields: ["person.firstName", "gone.field"] } })), [CODES.TRANSFORM_PATH_UNKNOWN]);
  assert.deepEqual(codes(good({ condition: { field: "case.unknownThing", operator: "equals", value: 1 } })), [CODES.CONDITION_PATH_UNKNOWN]);
  assert.deepEqual(codes(good({ condition: { all: [{ field: "person.firstName", operator: "exists" }, { any: [{ field: "no.such", operator: "exists" }] }] } })), [CODES.CONDITION_PATH_UNKNOWN]);
  assert.deepEqual(codes(good({ condition: { field: "filledData.some_field", operator: "equals", value: "x" } })), [], "filledData references are form values, not source paths");
  assert.deepEqual(codes(good({ condition: { field: "raw.questionnaireAnswers.k.value", operator: "exists" } })), []);
});

test("an unsupported transform or condition operator is refused; every supported one is accepted", () => {
  assert.deepEqual(codes(good({ transform: { type: "teleport" } })), [CODES.TRANSFORM_UNSUPPORTED]);
  assert.deepEqual(codes(good({ condition: { field: "person.firstName", operator: "kinda" } })), [CODES.CONDITION_OPERATOR_UNSUPPORTED]);
  for (const type of ["direct", "date", "boolean", "checkbox", "digits", "address", "country", "usState", "phone", "ssn", "alienNumber", "constant", "join", "concat", "fullName"]) {
    assert.deepEqual(codes(good({ transform: { type } })), [], type);
  }
  for (const operator of ["equals", "in", "exists", "not_in", "gte", "contains"]) assert.deepEqual(codes(good({ condition: { field: "person.firstName", operator } })), [], operator);
});

test("type compatibility: only clear contradictions are errors (a date into a checkbox, a yes/no into a date box)", () => {
  assert.deepEqual(codes(good({ sourcePath: "person.dob", targetType: "checkbox", transform: { type: "direct" } })), [CODES.TYPE_INCOMPATIBLE]);
  assert.deepEqual(codes(good({ sourcePath: "person.dob", targetType: "checkbox", transform: { type: "checkbox" } })), [], "with a checkbox transform it is fine");
  assert.deepEqual(codes(good({ sourcePath: "person.gender", targetType: "date" })), [CODES.TYPE_INCOMPATIBLE]);
  assert.deepEqual(codes(good({ sourcePath: "contact.email", targetType: "radio" })), [CODES.TYPE_INCOMPATIBLE]);
  assert.deepEqual(codes(good({ sourcePath: "person.firstName", targetType: "dropdown" })), [], "text into a dropdown is normal");
  assert.deepEqual(codes(good({ sourcePath: "person.gender", targetType: "checkbox", transform: { type: "boolean" } })), []);
});

test("party ownership: a field that speaks about one side must not read the other side's path", () => {
  assert.deepEqual(codes(good({ sourcePath: "company.name", targetLabel: "Name of Beneficiary", section: "Part 2" })), [CODES.PARTY_CONTRADICTION]);
  assert.deepEqual(codes(good({ sourcePath: "beneficiary.firstName", targetLabel: "Petitioner's Name", section: "Part 1" })), [CODES.PARTY_CONTRADICTION]);
  assert.deepEqual(codes(good({ sourcePath: "beneficiary.firstName", targetLabel: "Beneficiary Name" })), []);
  assert.deepEqual(codes(good({ sourcePath: "company.name", targetLabel: "Petitioner or Beneficiary name" })), [], "both sides named: nothing is provable");
  assert.deepEqual(codes(good({ sourcePath: "person.firstName", targetLabel: "Given Name" })), [], "no side named");
  assert.equal(partyOfText("Name of the petitioner"), "petitioner");
  assert.equal(partyOfText("Employer name"), "petitioner");
  assert.equal(partyOfText("applicant"), "beneficiary");
  assert.equal(partyOfText("both petitioner and beneficiary"), null);
});

test("derived metadata must follow the source path: a stale partyRule or profile owner is an error", () => {
  assert.deepEqual(codes(good({ sourcePath: "petitioner.name", partyRule: "petitioner.name", profileOwner: "employer" })), []);
  assert.deepEqual(codes(good({ sourcePath: "petitioner.name", partyRule: "petitioner.name", profileOwner: "employee" })), [CODES.STALE_DERIVED_METADATA]);
  assert.deepEqual(codes(good({ sourcePath: "person.firstName", partyRule: "beneficiary.firstName" })), [CODES.STALE_DERIVED_METADATA]);
  // a rule whose source is the first path of its transform is NOT stale (PartyFieldMappingService: sourcePath = rule.transform.fields[0] || rule.to)
  assert.deepEqual(codes(good({ sourcePath: "person.firstName", partyRule: "beneficiary.fullName", profileOwner: "employee", transform: { type: "concat", fields: ["person.firstName"] } })), []);
  assert.deepEqual(codes(good({ profileOwner: "employee" })), [], "an edge with no party rule has nothing derived to check");
});

test("a broken repeating edge, an invalid status or an invalid origin is named", () => {
  assert.deepEqual(codes(good({ mappingType: "repeating" })), [CODES.ARRAY_REFERENCE_BROKEN]);
  assert.deepEqual(codes(good({ mappingType: "repeating", repeatable: { sourceCollection: "x" } })), []);
  assert.deepEqual(codes(good({ transform: { type: "arrayItem", collection: "person.firstName" } })), []);
  assert.deepEqual(codes(good({ status: "maybe" })), [CODES.STATUS_INVALID]);
  assert.deepEqual(codes(good({ origin: "magic" })), [CODES.ORIGIN_INVALID]);
});

const template = { formFields: [
  { fieldId: "f1", pdfFieldName: "A", label: "Given", type: "text", required: true }, { fieldId: "f2", pdfFieldName: "B", label: "Sig", type: "signature" },
  { fieldId: "f3", pdfFieldName: "C", label: "Box", sectionTitle: "For USCIS Use Only", type: "text" }, { fieldId: "f4", pdfFieldName: "D", label: "Middle", type: "text" },
  { fieldId: "f5", pdfFieldName: "E", label: "Barcode", type: "barcode" },
] };

test("unmapped fields are classified: intentional, out of scope, unresolved (required) or optional", () => {
  assert.equal(classifyUnmapped({ type: "signature" }), "intentional");
  assert.equal(classifyUnmapped({ type: "text", label: "Signature of applicant" }), "intentional");
  assert.equal(classifyUnmapped({ type: "text", sectionTitle: "For USCIS Use Only" }), "out_of_scope");
  assert.equal(classifyUnmapped({ type: "text", required: true, label: "Given Name" }), "unresolved");
  assert.equal(classifyUnmapped({ type: "text", label: "Middle" }), "optional");
});

test("enforced edges (new / changed) can invalidate a graph; legacy edges are only reported, with a remediation status", () => {
  const graph = { edges: [good({ mappingId: "n", targetFieldId: "f1", sourcePath: "made.up" }), good({ mappingId: "l", targetFieldId: "f4", sourcePath: "also.made.up", origin: undefined })] };
  const result = validateGraphContract(graph, template, { universe });
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map((item) => item.mappingId), ["n"]);
  assert.deepEqual(result.legacy.map((item) => [item.mappingId, item.remediation]), [["l", "needs_fix"]]);
  assert.deepEqual([result.summary.enforcedEdges, result.summary.legacyEdges, result.summary.byCode.PATH_UNKNOWN], [1, 1, 2]);
  const onlyLegacy = validateGraphContract({ edges: [good({ sourcePath: "made.up", origin: undefined })] }, template, { universe });
  assert.equal(onlyLegacy.valid, true, "legacy violations never invalidate");
});

test("the unmapped fields of a graph are counted by class and the unresolved ones are listed", () => {
  const result = validateGraphContract({ edges: [good({ targetFieldId: "f4" })] }, template, { universe });
  assert.deepEqual([result.unmapped.intentional, result.unmapped.out_of_scope, result.unmapped.unresolved, result.unmapped.optional], [2, 1, 1, 0]);
  assert.deepEqual(result.unmapped.unresolvedFields, ["f1"]);
});

test("coverage: fields, edges by origin / status, questions without a field, unpopulated sources, duplicate targets, defaults - compact and capped", () => {
  const graph = { mappingVersion: 3, edges: [good({ targetFieldId: "f1" }), good({ mappingId: "x", targetFieldId: "f1", sourcePath: "made.up", origin: undefined }), good({ mappingId: "y", targetFieldId: "f4", status: "needs_review", origin: "scored" })], conflicts: [{}] };
  const withDefaults = { ...template, formCode: "X-1", version: "2026-01-01", formFields: [...template.formFields.slice(0, 4), { fieldId: "f9", type: "checkbox", defaultValue: false }] };
  const report = computeCoverage({ template: withDefaults, graph, universe, libraryItems: [{ canonicalPath: "person.firstName" }, { canonicalPath: "person.dob" }, { canonicalPath: "person.gender" }] });
  assert.deepEqual([report.formCode, report.mappingVersion], ["X-1", 3]);
  assert.equal(report.fields.total, 5);
  assert.equal(report.fields.mapped, 1);
  assert.deepEqual(report.edges.byStatus, { active: 2, needs_review: 1 });
  assert.deepEqual(report.edges.byOrigin, { authored: 1, legacy: 1, scored: 1 });
  assert.equal(report.edges.legacy, 1);
  assert.deepEqual(report.questions.paths, ["person.dob", "person.gender"]);
  assert.deepEqual(report.unpopulatedSources.paths, ["made.up"]);
  assert.deepEqual([report.conflicts.duplicateTargets, report.conflicts.targets, report.conflicts.recorded], [1, ["f1"], 1]);
  assert.equal(report.defaults.categories.checkbox_unchecked, 1);
  assert.ok(report.warnings.some((item) => item.code === "LEGACY_CONTRACT_VIOLATIONS"));
  assert.ok(JSON.stringify(report).length < 6000, "a report, not an export");
  const many = computeCoverage({ template: { formFields: Array.from({ length: 300 }, (_, index) => ({ fieldId: `r${index}`, type: "text", required: true })) }, graph: { edges: [] }, universe });
  assert.equal(many.fields.requiredUnmapped, 50, "required-unmapped list is capped");
});

test("persistCoverage stores the report on the mapping VERSION document and never throws", async () => {
  let call;
  const model = { updateOne: async (...args) => { call = args; } };
  assert.equal(await persistCoverage("v1", { a: 1 }, { model }), true);
  assert.deepEqual(call, [{ _id: "v1" }, { $set: { "validation.coverage": { a: 1 } } }]);
  assert.equal(await persistCoverage(null, {}, { model }), false);
  assert.equal(await persistCoverage("v1", {}, { model: { updateOne: async () => { throw new Error("down"); } } }), false);
});

// ---------------------------------------------------------------- default values ----
test("default-value classes: unchecked boxes, empty dropdowns, empty values, barcode tokens, the PRESENT constant; person-shaped or unknown defaults are FLAGGED", () => {
  const c = (field) => classifyDefault(field);
  assert.equal(c({ type: "checkbox", defaultValue: false }), "checkbox_unchecked");
  assert.equal(c({ fieldType: "radio", defaultValue: "Off" }), "checkbox_unchecked");
  assert.equal(c({ type: "dropdown", defaultValue: [] }), "empty_dropdown");
  assert.equal(c({ type: "dropdown", defaultValue: [""] }), "empty_dropdown");
  assert.equal(c({ type: "dropdown", defaultValue: [" "] }), "empty_dropdown");
  assert.equal(c({ type: "text", defaultValue: "" }), "empty_value");
  assert.equal(c({ type: "number", defaultValue: "" }), "empty_value");
  assert.equal(c({ type: "textarea", defaultValue: "I-131|01/20/25|3" }), "barcode_token");
  assert.equal(c({ type: "text", pdfFieldName: "form1[0].PDF417BarCode1[0]", defaultValue: "x" }), "barcode_token");
  assert.equal(c({ type: "date", defaultValue: "PRESENT" }), "constant");
  assert.equal(c({ type: "text", defaultValue: "jane@example.com" }), "party_looking");
  assert.equal(c({ type: "ssn", defaultValue: "123-45-6789" }), "party_looking");
  assert.equal(c({ type: "text", defaultValue: "(555) 123-4567" }), "party_looking");
  assert.equal(c({ type: "text", defaultValue: "A123456789" }), "party_looking");
  assert.equal(c({ type: "text", defaultValue: "Some other text" }), "other");
  assert.equal(c({ type: "text" }), null);
  assert.equal(c({ type: "text", defaultValue: null }), null);
  const summary = summarizeDefaults([{ type: "checkbox", defaultValue: false }, { type: "text", defaultValue: "x@y.co", fieldId: "e" }, { type: "text", defaultValue: "weird", fieldId: "w" }, { type: "text" }]);
  assert.deepEqual([summary.total, summary.categories.checkbox_unchecked, summary.flagged], [3, 1, [{ fieldId: "e", category: "party_looking" }, { fieldId: "w", category: "other" }]]);
});

test("autofill output for defaults is UNCHANGED: a default is used only when a field has no mapping, in every category", () => {
  const fields = [
    { fieldId: "box", type: "checkbox", defaultValue: false }, { fieldId: "drop", type: "dropdown", defaultValue: [] }, { fieldId: "txt", type: "text", defaultValue: "" },
    { fieldId: "bar", type: "textarea", defaultValue: "I-131|01/20/25|1" }, { fieldId: "end", type: "date", defaultValue: "PRESENT" },
  ];
  for (const field of fields) {
    const resolved = FormMappingService.resolveField(field, {}, {});
    assert.equal(resolved.source, "default", field.fieldId);
    assert.deepEqual(resolved.value, field.defaultValue, field.fieldId);
  }
  // a graph mapping always wins over the default
  const mapped = FormMappingService.resolveField({ fieldId: "txt", type: "text", defaultValue: "DEFAULT", mappings: [{ source: "canonical", path: "person.firstName" }] }, { person: { firstName: "Ada" } }, {});
  assert.equal(mapped.value, "Ada");
});

test("the committed default-value snapshot is well-formed, self-consistent and contains nothing person-shaped", () => {
  const snapshot = require(SNAPSHOT_FILE);
  assert.equal(snapshot.version, 1);
  assert.deepEqual(Object.keys(snapshot.totals).sort(), [...CATEGORIES].sort());
  assert.equal(Object.values(snapshot.totals).reduce((a, b) => a + b, 0), snapshot.fieldsWithDefault);
  const perFormTotal = Object.values(snapshot.perForm).reduce((sum, counts) => sum + Object.values(counts).reduce((a, b) => a + b, 0), 0);
  assert.equal(perFormTotal, snapshot.fieldsWithDefault);
  assert.equal(snapshot.totals.party_looking, 0, "no default looks like a person's data");
  assert.equal(snapshot.flagged.length, snapshot.totals.other + snapshot.totals.party_looking);
  assert.match(snapshot.contentHash, /^[0-9a-f]{64}$/);
});

test("buildSnapshot is deterministic and order-independent, and compareSnapshots names what changed", () => {
  const a = { formCode: "A-1", formFields: [{ fieldId: "x", type: "checkbox", defaultValue: false }, { fieldId: "y", type: "text", defaultValue: "" }] };
  const b = { formCode: "B-1", formFields: [{ fieldId: "z", type: "dropdown", defaultValue: [] }] };
  const one = buildSnapshot([a, b]);
  assert.deepEqual(buildSnapshot([b, a]).contentHash, one.contentHash);
  assert.equal(compareSnapshots(one, buildSnapshot([a, b])).same, true);
  const changedValue = buildSnapshot([a, { ...b, formFields: [{ fieldId: "z", type: "dropdown", defaultValue: [""] }] }]);
  assert.equal(compareSnapshots(one, changedValue).same, false);
  const newDefault = buildSnapshot([a, b, { formCode: "C-1", formFields: [{ fieldId: "q", type: "text", defaultValue: "who@x.co" }] }]);
  const drift = compareSnapshots(one, newDefault);
  assert.match(drift.differences.join("\n"), /form C-1: new form/);
  assert.match(drift.differences.join("\n"), /newly flagged defaults: C-1\|q\|party_looking/);
  assert.equal(crypto.createHash("sha256").update("").digest("hex").length, 64);
});
