// Safe case migration (plan Rule G), the PURE part: no database, no network. The carry plan, verification against the pre-image, canonical checksums and state diffs.
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../services/CaseFormMigrationRecovery");

const field = (fieldId, over = {}) => ({ fieldId, fieldName: fieldId, pdfFieldName: fieldId, ...over });
const matcherOf = (fields) => { const byId = new Map(fields.map((item) => [item.fieldId, item])); return (path) => byId.get(path); };
const image = (answers = {}, pointers = {}) => R.imageOf({ filledData: null, fieldValues: {}, manualOverrides: {}, fieldValueProvenance: {}, sourceAttribution: {}, fieldReviews: {}, sectionReviews: {}, status: "ai_filled", formTemplateId: "old", ...answers, ...pointers });
const dispositionOf = (plan, oldKey, bag) => plan.dispositions.find((item) => item.oldKey === oldKey && (!bag || item.bag === bag));

test("canonical form: key order, undefined and empty objects do not change a checksum; a real change does", () => {
  const a = { x: 1, y: { b: 2, a: 1 }, z: {}, w: undefined };
  const b = { y: { a: 1, b: 2 }, x: 1, z: null };
  assert.equal(R.canonical(a), R.canonical(b));
  assert.equal(R.sha256(R.canonical(a)), R.sha256(R.canonical(b)));
  assert.notEqual(R.canonical(a), R.canonical({ ...a, x: 2 }));
  assert.equal(R.canonical({ d: new Date("2026-01-01T00:00:00Z") }), R.canonical({ d: new Date("2026-01-01T00:00:00.000Z") }));
});

test("an image holds the answer records and edition pointers; provenance keys are decoded to the real field id and Maps are read", () => {
  const map = new Map([["part1․given", { source: "case_manager_override" }]]);
  const img = R.imageOf({ filledData: { part1: { given: "Ana" } }, fieldValueProvenance: map, status: "draft", formTemplateId: "t1", auditHistory: [{ action: "x" }], updatedAt: new Date() });
  assert.deepEqual(img.answers.fieldValueProvenance, { "part1.given": { source: "case_manager_override" } });
  assert.equal(img.pointers.status, "draft");
  assert.equal(JSON.stringify(img).includes("auditHistory"), false, "volatile fields are not part of the image");
  assert.equal(R.encodeKey("a.b.c"), "a․b․c");
  assert.equal(R.decodeKey("a․b․c"), "a.b.c");
});

test("diffImages lists exactly what differs", () => {
  const before = image({ filledData: { a: "1", b: "2" } });
  const after = image({ filledData: { a: "1", b: "3", c: "4" } });
  assert.deepEqual(R.diffImages(before, after).map((item) => item.path).sort(), ["answers.filledData.b", "answers.filledData.c"]);
  assert.deepEqual(R.diffImages(before, before), []);
});

test("plan: a plain rename is preserved with its provenance and review travelling to the new key", () => {
  const img = image({ filledData: { given: "Ana" }, fieldValueProvenance: { given: { source: "case_manager_override", overriddenAt: new Date("2026-01-01") } }, fieldReviews: { given: { status: "approved" } }, manualOverrides: { given: "Ana" } });
  const plan = R.planCarry(img, (path) => (path === "given" ? field("first") : undefined));
  assert.equal(plan.unresolved.length, 0, "the rename has a counterpart");
  assert.equal(plan.writes.filledData.first, "Ana");
  assert.equal(plan.writes.fieldValueProvenance.first.source, "case_manager_override");
  assert.equal(plan.writes.fieldReviews.first.status, "approved");
  assert.equal(plan.writes.manualOverrides.first, "Ana");
  assert.equal(dispositionOf(plan, "given", "filledData").disposition, "preserved");
});

test("plan: two old records with DIFFERENT values on one new box are unresolved; with EQUAL values they merge and the loser is archived with a reason", () => {
  const target = field("box");
  const different = R.planCarry(image({ fieldValues: { a: "x", b: "y" } }), () => target);
  assert.equal(different.unresolved.length, 1);
  assert.equal(different.unresolved[0].code, "COLLISION");
  assert.deepEqual(different.unresolved[0].oldKeys.sort(), ["a", "b"]);
  const equal = R.planCarry(image({ fieldValues: { a: "same", b: "same" } }), () => target);
  assert.equal(equal.unresolved.length, 0);
  assert.equal(equal.writes.fieldValues.box, "same");
  assert.equal(equal.archive.merged.length, 1);
  assert.equal(equal.dispositions.filter((item) => item.reason === "equal_value_collision_merge").length, 1);
  assert.equal(equal.counts.total, 2);
  assert.equal(equal.counts.carried + equal.counts.archived, 2, "every old record is accounted for exactly once");
});

test("plan: a blank beside a real value is not a collision; a user-typed false is a real answer", () => {
  const target = field("box");
  const withBlank = R.planCarry(image({ fieldValues: { a: "", b: "real" } }), () => target);
  assert.equal(withBlank.unresolved.length, 0);
  assert.equal(withBlank.writes.fieldValues.box, "real");
  const typedFalse = R.planCarry(image({ fieldValues: { a: false, b: "yes" }, manualOverrides: { a: false } }), (path) => (path === "a" || path === "b" ? target : undefined));
  assert.equal(typedFalse.unresolved.some((item) => item.bag === "fieldValues"), true, "a person's false and a different value disagree: unresolved, never overwritten");
});

test("plan: a typed or verified value with no box in the new edition BLOCKS the case; an ordinary value with none is archived with the reason", () => {
  const img = image({ filledData: { gone: "typed", plain: "auto", other: "x" }, manualOverrides: { gone: "typed" }, fieldValueProvenance: { plain: { source: "canonical" } } });
  const plan = R.planCarry(img, (path) => (path === "other" ? field("other") : undefined));
  assert.equal(plan.unresolved.some((item) => item.code === "NO_COUNTERPART_FOR_PROTECTED_VALUE"), true);
  const verified = R.planCarry(image({ filledData: { v: "1" }, fieldReviews: { v: { status: "approved" } } }), () => undefined);
  assert.equal(verified.unresolved[0].code, "NO_COUNTERPART_FOR_PROTECTED_VALUE");
  const ordinary = R.planCarry(image({ filledData: { plain: "auto" }, fieldValueProvenance: { plain: { source: "canonical" } } }), () => undefined);
  assert.equal(ordinary.unresolved.length, 0);
  assert.equal(ordinary.archive.unmatchedValues.filledData.plain, "auto");
  assert.equal(dispositionOf(ordinary, "plain").reason, "no_counterpart");
});

test("plan: a value of unknown origin is preserved AND flagged, never dropped; a box the new edition hides is archived as inapplicable", () => {
  const unknown = R.planCarry(image({ filledData: { a: "mystery", b: "kept" } }), (path) => field(path));
  assert.deepEqual(unknown.flags.provenanceUnknown.sort(), ["a", "b"]);
  assert.equal(unknown.writes.filledData.a, "mystery");
  const hidden = R.planCarry(image({ filledData: { a: "x" } }), () => field("a", { hidden: true }), { isApplicable: (target) => target.hidden !== true });
  assert.equal(hidden.archive.unmatchedValues.filledData.a, "x");
  assert.equal(dispositionOf(hidden, "a").reason, "inapplicable_in_new_edition");
});

test("plan: a flat bag with dotted keys stays flat; a nested bag stays nested", () => {
  const flat = R.planCarry(image({ fieldValues: { "part1.given": "Ana" } }), (path) => field(path));
  assert.equal(flat.writes.fieldValues["part1.given"], "Ana");
  const nested = R.planCarry(image({ filledData: { part1: { given: "Ana" } } }), (path) => field(path));
  assert.deepEqual(nested.writes.filledData, { part1: { given: "Ana" } });
});

test("verify: protected values must be exactly equal, unknown-origin values must not be blanked, archived values must be on the case form, and it must be on the new edition", () => {
  const pre = image({ filledData: { typed: "T", mystery: "M", auto: "A" }, manualOverrides: { typed: "T" }, fieldValueProvenance: { typed: { source: "case_manager_override" }, auto: { source: "canonical" } } });
  const plan = R.planCarry(pre, (path) => field(path));
  const good = image({ filledData: { typed: "T", mystery: "M2", auto: "changed by autofill" }, manualOverrides: { typed: "T" }, fieldValueProvenance: { typed: { source: "case_manager_override" }, auto: { source: "canonical" } } }, { formTemplateId: "new" });
  assert.deepEqual(R.verifyAgainstPlan({ preImage: pre, dispositions: plan.dispositions, current: good, newTemplateId: "new" }), []);
  const changed = image({ filledData: { typed: "ALTERED", mystery: "M", auto: "A" }, manualOverrides: { typed: "T" }, fieldValueProvenance: { typed: { source: "case_manager_override" }, auto: { source: "canonical" } } }, { formTemplateId: "new" });
  assert.equal(R.verifyAgainstPlan({ preImage: pre, dispositions: plan.dispositions, current: changed, newTemplateId: "new" })[0].code, "PROTECTED_VALUE_CHANGED");
  const blanked = image({ filledData: { typed: "T", mystery: "", auto: "A" }, manualOverrides: { typed: "T" }, fieldValueProvenance: { typed: { source: "case_manager_override" }, auto: { source: "canonical" } } }, { formTemplateId: "new" });
  assert.equal(R.verifyAgainstPlan({ preImage: pre, dispositions: plan.dispositions, current: blanked, newTemplateId: "new" })[0].code, "VALUE_BLANKED");
  assert.equal(R.verifyAgainstPlan({ preImage: pre, dispositions: plan.dispositions, current: good, newTemplateId: "other" }).some((item) => item.code === "NOT_ON_NEW_EDITION"), true);
  const archivedPlan = R.planCarry(image({ filledData: { gone: "keep me" } }), () => undefined);
  const archivedPre = image({ filledData: { gone: "keep me" } });
  assert.equal(R.verifyAgainstPlan({ preImage: archivedPre, dispositions: archivedPlan.dispositions, current: good, archiveEntry: { unmatchedValues: { filledData: { gone: "keep me" } } }, newTemplateId: "new" }).length, 0);
  assert.equal(R.verifyAgainstPlan({ preImage: archivedPre, dispositions: archivedPlan.dispositions, current: good, archiveEntry: { unmatchedValues: {} }, newTemplateId: "new" })[0].code, "ARCHIVED_VALUE_MISSING");
});

test("put back after autofill: a blanked value a person saved comes back (including a typed false); a false the system derived does not", () => {
  const pre = image({ filledData: { typedFalse: false, typedText: "hello", derivedFalse: false, plain: "p" }, manualOverrides: { typedFalse: false }, fieldValueProvenance: { typedText: { source: "case_manager_override" }, derivedFalse: { source: "canonical" } } });
  const plan = R.planCarry(pre, (path) => field(path));
  const restore = R.valuesToRestore(pre, plan.dispositions, { typedFalse: undefined, typedText: "", derivedFalse: undefined, plain: undefined });
  const keys = restore.map((item) => item.key).sort();
  assert.deepEqual(keys, ["plain", "typedFalse", "typedText"]);
  assert.equal(restore.find((item) => item.key === "typedFalse").value, false);
  assert.deepEqual(R.valuesToRestore(pre, plan.dispositions, { typedFalse: false, typedText: "hello", derivedFalse: false, plain: "p" }), [], "nothing to restore when nothing was blanked");
});

test("a flat or nested bag value is found and written the way the bag is shaped", () => {
  assert.equal(R.bagValue({ "a.b": 1 }, "a.b"), 1);
  assert.equal(R.bagValue({ a: { b: 2 } }, "a.b"), 2);
  const nested = { a: { b: 2 } };
  R.setBagValue(nested, "a.c", 3);
  assert.deepEqual(nested, { a: { b: 2, c: 3 } });
  const flat = { "a.b": 1 };
  R.setBagValue(flat, "a.c", 3);
  assert.deepEqual(flat, { "a.b": 1, "a.c": 3 });
});
