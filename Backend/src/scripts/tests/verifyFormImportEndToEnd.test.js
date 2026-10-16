// Phase 0: the end-to-end import check deletes only ids it recorded, and refuses anything ambiguous. DB-free (pure planning step).
const test = require("node:test");
const assert = require("node:assert/strict");
const { planCleanup, runFile } = require("../verifyFormImportEndToEnd");

const tpl = (id, formCode = "I-912") => ({ _id: id, formCode });

test("only the recorded templates are deleted, never everything under the form code", () => {
  const plan = planCleanup({ code: "I-912", recordedIds: ["a", "b"], templates: [tpl("a"), tpl("b"), tpl("c")], referencedIds: [] });
  assert.deepEqual([plan.ok, plan.deleteIds], [true, ["a", "b"]]);
});

test("refuses (deletes nothing) when nothing was recorded, when a recorded id belongs to another form, or when a case form references a recorded template", () => {
  assert.equal(planCleanup({ code: "I-912", recordedIds: [], templates: [tpl("a")], referencedIds: [] }).ok, false);
  assert.match(planCleanup({ code: "I-912", recordedIds: [], templates: [], referencedIds: [] }).refusal, /no template id was recorded/);
  const foreign = planCleanup({ code: "I-912", recordedIds: ["a"], templates: [tpl("a", "I-131")], referencedIds: [] });
  assert.deepEqual([foreign.ok, foreign.deleteIds], [false, []]);
  assert.match(foreign.refusal, /another form code/);
  const used = planCleanup({ code: "I-912", recordedIds: ["a", "b"], templates: [tpl("a"), tpl("b")], referencedIds: ["b"] });
  assert.deepEqual([used.ok, used.deleteIds], [false, []]);
  assert.match(used.refusal, /referenced by case forms/);
});

test("a case form that references some OTHER template does not block the clean-up; ids compare as strings", () => {
  const id = { toString: () => "a" };
  const plan = planCleanup({ code: "I-912", recordedIds: [id], templates: [tpl(id)], referencedIds: ["zzz"] });
  assert.equal(plan.ok, true);
});

test("each form code has its own run file, safe for any code", () => {
  assert.notEqual(runFile("I-912"), runFile("I-131"));
  assert.match(runFile("I-485 SUPPLEMENT A"), /verify-form-import-I-485_SUPPLEMENT_A\.json$/);
});
