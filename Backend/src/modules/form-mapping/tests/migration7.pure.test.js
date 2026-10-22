// Phase 7.7 (pure, no database): the value rules, the conflict policy, the conservation proof, the field-name remap and the v7 carry plan.
const test = require("node:test");
const assert = require("node:assert/strict");
const ValueRules = require("../services/migration/ValueRules");
const ConflictPolicy = require("../services/migration/ConflictPolicy");
const MigrationProof = require("../services/migration/MigrationProof");
const MetaRemap = require("../services/migration/MetaRemap");
const R = require("../services/CaseFormMigrationRecovery");

const field = (fieldId, over = {}) => ({ fieldId, fieldName: fieldId, label: fieldId, fieldType: "text", ...over });
const opts = (...values) => values.map((value) => ({ value, label: value }));

test("ValueRules: blanks and untyped boxes are carried exactly as today; locked boxes never receive an answer", () => {
  assert.deepEqual(ValueRules.carry({ value: "", newField: field("a") }), { ok: true, value: "", rule: "blank", converted: false });
  assert.equal(ValueRules.carry({ value: "x", newField: { fieldId: "a" } }).rule, "no_type_info");
  assert.equal(ValueRules.carry({ value: "x", newField: field("sig", { fieldType: "signature" }) }).ok, false);
});

test("ValueRules: a text value that does not fit maxLength is REFUSED, never truncated", () => {
  assert.equal(ValueRules.carry({ value: "12345", newField: field("a", { maxLength: 5 }) }).ok, true);
  const refused = ValueRules.carry({ value: "123456", newField: field("a", { maxLength: 5 }) });
  assert.deepEqual([refused.ok, refused.reason], [false, "exceeds_max_length_5"]);
  assert.equal(ValueRules.carry({ value: true, newField: field("a") }).ok, false, "a boolean never turns into text");
});

test("ValueRules: checkbox <-> yes/no choice only when it is provable", () => {
  assert.deepEqual(ValueRules.carry({ value: false, newField: field("c", { fieldType: "checkbox" }) }).value, false);
  assert.equal(ValueRules.carry({ value: "Yes", newField: field("c", { fieldType: "checkbox" }) }).value, true);
  assert.equal(ValueRules.carry({ value: "Off", newField: field("c", { fieldType: "checkbox" }) }).value, false);
  assert.equal(ValueRules.carry({ value: "Maybe", newField: field("c", { fieldType: "checkbox" }) }).ok, false);
  const radio = field("r", { fieldType: "radio", options: opts("Y", "N", "NA") });
  assert.equal(ValueRules.carry({ value: true, newField: radio }).value, "Y");
  assert.equal(ValueRules.carry({ value: false, newField: radio }).value, "N");
  const ambiguous = field("r2", { fieldType: "radio", options: opts("Yes", "Y", "No") });
  assert.equal(ValueRules.carry({ value: true, newField: ambiguous }).ok, false, "two options say yes: no guess");
});

test("ValueRules: a choice must exist in the new option set (exact, or exactly one after trimming and ignoring case)", () => {
  const drop = field("d", { fieldType: "dropdown", options: opts("Single", "Married") });
  assert.deepEqual([ValueRules.carry({ value: "Single", newField: drop }).rule, ValueRules.carry({ value: "Single", newField: drop }).converted], ["option_exact", false]);
  const normalized = ValueRules.carry({ value: " married ", newField: drop });
  assert.deepEqual([normalized.ok, normalized.value, normalized.rule, normalized.converted], [true, "Married", "option_normalized", true]);
  assert.equal(ValueRules.carry({ value: "Divorced", newField: drop }).reason, "option_not_in_new_edition");
  assert.equal(ValueRules.carry({ value: "Divorced", newField: field("e", { fieldType: "dropdown" }) }).rule, "options_unknown", "no option list on the new box: carried as today, flagged");
});

test("ConflictPolicy: equal values merge; a person's value over the system's value merges; everything else parks", () => {
  const kind = (over) => ({ userSourced: false, verified: false, provenAutofill: false, unknownProvenance: false, ...over });
  const item = (path, value, k) => ({ path, value, kind: kind(k) });
  assert.equal(ConflictPolicy.decide([item("a", "X", { provenAutofill: true }), item("b", "X", { provenAutofill: true })]).action, "merge");
  const typedOverAuto = ConflictPolicy.decide([item("a", "123 Main St", { userSourced: true }), item("b", "9 Other Rd", { provenAutofill: true })]);
  assert.deepEqual([typedOverAuto.action, typedOverAuto.winner.path, typedOverAuto.reason], ["merge", "a", "person_value_over_system_value"]);
  assert.equal(ConflictPolicy.decide([item("a", "1", { userSourced: true }), item("b", "2", { userSourced: true })]).reason, "two_different_person_values");
  assert.equal(ConflictPolicy.decide([item("a", "1", { provenAutofill: true }), item("b", "2", { provenAutofill: true })]).reason, "two_different_system_values");
  assert.equal(ConflictPolicy.decide([item("a", "1", { userSourced: true }), item("b", "2", { unknownProvenance: true })]).action, "park", "a value of unknown origin is never overruled");
});

test("ConflictPolicy: a park record is current only for the same edition, rules, matcher and an unedited case form", () => {
  const at = new Date("2026-10-01T00:00:00Z");
  const record = ConflictPolicy.parkRecord({ unresolved: [{ code: "COLLISION", bag: "filledData", targetId: "t", oldKeys: ["a", "b"], values: ["SECRET", "SECRET2"] }], toTemplateId: "T1", updatedAt: at, matcherVersion: 1 });
  assert.equal(JSON.stringify(record).includes("SECRET"), false, "the answers themselves are not copied into the park record");
  assert.ok(record.releaseConditions.length >= 1);
  const same = { toTemplateId: "T1", updatedAt: at, matcherVersion: 1 };
  assert.equal(ConflictPolicy.isParkCurrent(record, same), true);
  assert.equal(ConflictPolicy.isParkCurrent(record, { ...same, matcherVersion: 2 }), false, "a matcher change re-evaluates");
  assert.equal(ConflictPolicy.isParkCurrent(record, { ...same, updatedAt: new Date(at.getTime() + 1000) }), false, "an edit re-evaluates");
  assert.equal(ConflictPolicy.isParkCurrent(record, { ...same, toTemplateId: "T2" }), false);
});

const imageWith = (answers) => R.imageOf({ filledData: {}, fieldValues: {}, manualOverrides: {}, fieldValueProvenance: {}, sourceAttribution: {}, fieldReviews: {}, sectionReviews: {}, ...answers });
const fieldsById = (list) => { const m = new Map(list.map((f) => [f.fieldId, f])); return (path) => m.get(path) || m.get(path.split(".").pop()) || null; };

test("planCarry (v7): a converted value is written converted, recorded with its rule, and the old value stays provable", () => {
  const image = imageWith({ filledData: { part1: { married: "Yes" } }, fieldValues: { "part1.married": "Yes" }, fieldValueProvenance: { [R.encodeKey("part1.married")]: { source: "canonical" } } });
  const match = (path) => (path === "part1.married" ? field("part1.maritalBox", { fieldType: "checkbox" }) : null);
  const plan = R.planCarry(image, match, { v7: { oldField: () => field("part1.married", { fieldType: "radio" }) } });
  assert.equal(plan.unresolved.length, 0);
  assert.equal(plan.writes.fieldValues["part1.maritalBox"], true);
  const entry = plan.proof.entries.find((e) => e.bag === "fieldValues");
  assert.deepEqual([entry.rule, entry.converted, entry.convertedTo], ["choice_to_checkbox", true, true]);
  assert.equal(plan.proof.ok, true);
  assert.match(plan.proof.checksum, /^[0-9a-f]{64}$/);
});

test("planCarry (v7): a PERSON's answer that cannot fit the new box parks the case form; a system value is archived with the reason", () => {
  const typed = imageWith({ filledData: { part1: { name: "Alexandria Montgomery" } }, fieldValues: { "part1.name": "Alexandria Montgomery" }, manualOverrides: { "part1.name": { value: "Alexandria Montgomery" } } });
  const match = () => field("part1.name", { maxLength: 8 });
  const parked = R.planCarry(typed, match, { v7: { oldField: () => field("part1.name") } });
  assert.equal(parked.unresolved.some((item) => item.code === "VALUE_NOT_CARRIABLE" && /exceeds_max_length_8/.test(item.policy)), true);

  const system = imageWith({ filledData: { part1: { name: "Alexandria Montgomery" } }, fieldValues: { "part1.name": "Alexandria Montgomery" }, fieldValueProvenance: { [R.encodeKey("part1.name")]: { source: "canonical" } } });
  const archived = R.planCarry(system, match, { v7: { oldField: () => field("part1.name") } });
  assert.equal(archived.unresolved.length, 0);
  assert.equal(archived.archive.unmatchedValues.filledData["part1.name"], "Alexandria Montgomery");
  assert.match(archived.dispositions.find((d) => d.disposition === "archived").reason, /^value_not_carriable:exceeds_max_length_8/);
  assert.equal(archived.proof.ok, true, "an archived value is accounted for");
});

test("planCarry (v7): typed-over-autofill merges and BOTH values are kept; two different typed values park", () => {
  const image = imageWith({
    fieldValues: { "a.addr": "1 Typed St", "b.addr": "9 System Rd" },
    manualOverrides: { "a.addr": { value: "1 Typed St" } },
    fieldValueProvenance: { [R.encodeKey("a.addr")]: { source: "case_manager_override" }, [R.encodeKey("b.addr")]: { source: "canonical" } },
  });
  const target = field("addr");
  const merged = R.planCarry(image, () => target, { v7: {} });
  const mergedValues = merged.unresolved.filter((item) => item.bag === "fieldValues");
  assert.equal(mergedValues.length, 0);
  assert.equal(merged.writes.fieldValues.addr, "1 Typed St");
  assert.equal(merged.archive.unmatchedValues.fieldValues["b.addr"], "9 System Rd", "the loser is archived, not dropped");

  const both = imageWith({ fieldValues: { "a.addr": "1 Typed St", "b.addr": "2 Typed Ave" }, manualOverrides: { "a.addr": { value: "1 Typed St" }, "b.addr": { value: "2 Typed Ave" } } });
  const parked = R.planCarry(both, () => target, { v7: {} });
  assert.equal(parked.unresolved.some((item) => item.code === "COLLISION" && item.policy === "two_different_person_values"), true);
});

test("planCarry without v7 is exactly today's plan (a typed-vs-autofill difference still blocks, nothing is converted)", () => {
  const image = imageWith({ fieldValues: { "a.addr": "1 Typed St", "b.addr": "9 System Rd" }, fieldValueProvenance: { [R.encodeKey("a.addr")]: { source: "case_manager_override" }, [R.encodeKey("b.addr")]: { source: "canonical" } } });
  const plan = R.planCarry(image, () => field("addr"));
  assert.equal(plan.unresolved[0].code, "COLLISION");
  assert.equal("proof" in plan, false);
});

test("MigrationProof: an answer with no documented destination makes the plan unproven", () => {
  const proof = MigrationProof.build({ enumerate: [["filledData", "a"], ["filledData", "b"]], plan: { dispositions: [{ kind: "value", bag: "filledData", oldKey: "a", newKey: "a", disposition: "preserved" }], archive: { unmatchedValues: {} } } });
  assert.equal(proof.ok, false);
  assert.deepEqual(proof.unaccounted.map((item) => item.oldKey), ["b"]);
  const archivedNotStored = MigrationProof.build({ enumerate: [["filledData", "z"]], plan: { dispositions: [{ kind: "value", bag: "filledData", oldKey: "z", disposition: "archived", reason: "x" }], archive: { unmatchedValues: {} } } });
  assert.equal(archivedNotStored.ok, false);
});

test("MigrationProof.reconcile finds a protected value that changed and an archived value that is missing", () => {
  const proof = { entries: [
    { bag: "fieldValues", oldKey: "a", newKey: "a2", disposition: "preserved", protected: true, convertedTo: "Y" },
    { bag: "fieldValues", oldKey: "b", disposition: "archived" },
  ] };
  const base = { proof, sameValue: (x, y) => JSON.stringify(x) === JSON.stringify(y), isMissing: (v) => v === undefined || v === null || v === "", readOld: (bag, key) => ({ a: "Yes", b: "gone" })[key] };
  assert.deepEqual(MigrationProof.reconcile({ ...base, read: () => "Y", archived: () => "gone" }), []);
  const problems = MigrationProof.reconcile({ ...base, read: () => "N", archived: () => undefined });
  assert.deepEqual(problems.map((p) => p.code).sort(), ["PROOF_ARCHIVED_VALUE_MISSING", "PROOF_CONVERTED_VALUE_CHANGED"]);
});

test("MetaRemap: comments, history and sync state follow the renamed field; unmatched records keep their name; the originals are returned for undo", () => {
  const doc = {
    comments: [{ _id: "c1", fieldName: "old.a", comment: "check" }, { _id: "c2", fieldName: "old.gone", comment: "x" }, { _id: "c3", scope: "form" }],
    fieldHistory: [{ _id: "h1", fieldName: "old.a", action: "edit" }],
    syncState: { changedFields: ["old.a", "old.gone"], affectedFields: [] },
  };
  const match = (name) => (name === "old.a" ? { fieldId: "new.a" } : null);
  const plan = MetaRemap.plan(doc, match, (t) => t.fieldId);
  assert.deepEqual(plan.set.comments.map((c) => c.fieldName), ["new.a", "old.gone", undefined]);
  assert.equal(plan.set.fieldHistory[0].fieldName, "new.a");
  assert.deepEqual(plan.set["syncState.changedFields"], ["new.a", "old.gone"]);
  assert.equal(plan.pre.comments[0].fieldName, "old.a");
  assert.equal(plan.changed, 3);
});

test("extraRestoreFor puts remapped names back BY RECORD ID, so a comment added after the migration is kept", () => {
  const current = { comments: [{ _id: "c1", fieldName: "new.a" }, { _id: "c9", fieldName: "new.a", comment: "added later" }] };
  const out = R.extraRestoreFor(current, { comments: [{ _id: "c1", fieldName: "old.a" }], stalePdf: true });
  assert.deepEqual(out.$set.comments.map((c) => [c._id, c.fieldName]), [["c1", "old.a"], ["c9", "new.a"]]);
  assert.equal(out.$unset.generatedPdfStale, "");
});

test("restoreKeep: autofill's status / version / history changes are detected and reversed; no change returns nothing", () => {
  const keep = R.pickKeep({ status: "in_review", versionNumber: 3, versions: [{ versionNumber: 2 }], reviewState: { status: "in_progress" } });
  assert.equal(R.restoreKeep({ status: "in_review", versionNumber: 3, versions: [{ versionNumber: 2 }], reviewState: { status: "in_progress" } }, keep), null);
  const back = R.restoreKeep({ status: "ai_filled", versionNumber: 4, versions: [{ versionNumber: 2 }, { versionNumber: 3 }], reviewState: { status: "in_progress" } }, keep);
  assert.deepEqual(Object.keys(back).sort(), ["status", "versionNumber", "versions"]);
  assert.equal(back.status, "in_review");
});

// ── autofill during a migration (options.preserveExisting) ───────────────────
const AutoFill = require("../services/AutoFillService");

test("AutoFillService.preserveExisting: only blanks and system-derived values are filled; a typed, un-attributed, confirmed or verified answer is never overwritten", () => {
  const caseForm = {
    filledData: { a: "typed", b: "unknown-origin", c: "system", d: "reviewed", e: "" },
    fieldValues: {}, sourceAttribution: {}, manualOverrides: {},
    fieldReviews: { d: { status: "confirmed" } },
    fieldValueProvenance: { a: { source: "case_manager_override" }, c: { source: "canonical" } },
  };
  const template = { formFields: ["a", "b", "c", "d", "e"].map((fieldId) => ({ fieldId, fieldName: fieldId })) };
  const mapped = { fieldValues: { a: "AUTO", b: "AUTO", c: "AUTO", d: "AUTO", e: "AUTO" }, sourceAttribution: {} };
  const merged = AutoFill.mergeMappedFields(caseForm, template, mapped, { fieldMetadata: {} }, { preserveExisting: true });
  assert.deepEqual({ a: merged.filledData.a, b: merged.filledData.b, c: merged.filledData.c, d: merged.filledData.d, e: merged.filledData.e }, { a: "typed", b: "unknown-origin", c: "AUTO", d: "reviewed", e: "AUTO" });
  assert.deepEqual(merged.skippedFields.map((s) => s.fieldId).sort(), ["a", "b", "d"]);
});

test("AutoFillService without preserveExisting is exactly as before (an un-attributed value IS refreshed)", () => {
  const caseForm = { filledData: { b: "unknown-origin" }, fieldValues: {}, sourceAttribution: {}, manualOverrides: {}, fieldReviews: {}, fieldValueProvenance: {} };
  const merged = AutoFill.mergeMappedFields(caseForm, { formFields: [{ fieldId: "b", fieldName: "b" }] }, { fieldValues: { b: "AUTO" }, sourceAttribution: {} }, { fieldMetadata: {} }, {});
  assert.equal(merged.filledData.b, "AUTO");
});
