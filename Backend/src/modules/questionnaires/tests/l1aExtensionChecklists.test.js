// L-1A Extension = its own copy of every L-1A checklist (same questions/documents/logic), under its own keys and visa type.
const assert = require("node:assert/strict");
const test = require("node:test");
const { EMPLOYMENT_CHECKLIST_DEFINITIONS } = require("../employmentChecklists");
const questionnaireRegistry = require("../../employment-workflow/questionnaires/registry");
const { ENTRIES } = require("../../form-registry/seeds/checklistMappings.seed");

const byKey = (key) => EMPLOYMENT_CHECKLIST_DEFINITIONS.find((d) => d.key === key);
const ROLES = ["employer", "employee", "business_plan"];

test("l1aext_* checklists exist for employer, employee and business plan, scoped to L-1A Extension only", () => {
  for (const role of ROLES) {
    const copy = byKey(`l1aext_${role}_checklist`);
    assert.ok(copy, `l1aext_${role}_checklist`);
    assert.equal(copy.visaType, "L1AEXTENSION");
    assert.deepEqual(copy.visaTypes, ["L1AEXTENSION", "L-1A Extension"]);
    assert.ok(!/L-1A(?! Extension)/.test(`${copy.title} ${copy.description}`), "titles say L-1A Extension, not plain L-1A");
  }
  assert.ok(!byKey("l1a_employer_checklist").visaTypes.includes("L-1A Extension"), "plain L-1A checklists do not serve extension cases");
});

test("each extension checklist has exactly the same sections and questions as the L-1A one", () => {
  for (const role of ROLES) {
    const original = byKey(`l1a_${role}_checklist`);
    const copy = byKey(`l1aext_${role}_checklist`);
    assert.deepEqual(copy.sections, original.sections);
    assert.deepEqual(copy.questions.map((q) => q.key), original.questions.map((q) => q.key));
    assert.deepEqual(copy.assignmentRules, original.assignmentRules, "same assignment rules (business plan stays New-Office only)");
    assert.equal(copy.checklistRole, original.checklistRole);
  }
});

test("the L-1A employment workflow (employer data entry / invite employee) serves an L-1A Extension case", () => {
  assert.ok(questionnaireRegistry.getDefinition("L-1A Extension"));
  assert.equal(questionnaireRegistry.getDefinition("L-1A Extension"), questionnaireRegistry.getDefinition("L-1A"));
  assert.ok(questionnaireRegistry.standardDocuments("L-1A Extension").length > 0);
});

test("L-1A Extension maps the same forms to the same checklists as L-1A", () => {
  const rows = (visaType) => ENTRIES.filter((e) => e.visaType === visaType).map((e) => `${e.formNumber}:${e.checklistMappings.map((c) => c.checklistKey.replace(/^l1a(ext)?_/, "")).join(",")}`).sort();
  assert.ok(ENTRIES.some((e) => e.visaType === "L-1A Extension"));
  assert.deepEqual(rows("L-1A Extension"), rows("L-1A"));
});
