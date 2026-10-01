const test = require("node:test");
const assert = require("node:assert/strict");
const { EMPLOYMENT_CHECKLIST_DEFINITIONS } = require("../employmentChecklists");
const ImmigrationKnowledgeEngineService = require("../../cases/immigration-knowledge-engine.service");

const byKey = Object.fromEntries(EMPLOYMENT_CHECKLIST_DEFINITIONS.map((d) => [d.key, d]));

test("O-2 has its own employer and employee checklists, scoped to O-2 only", () => {
  for (const key of ["o2_employer_checklist", "o2_employee_checklist"]) {
    assert.ok(byKey[key], key);
    assert.deepEqual(byKey[key].visaTypes, ["O2", "O-2"]);
    assert.equal(byKey[key].isDefault, true);
  }
  assert.ok(!byKey.o1_employer_checklist.visaTypes.includes("O2"));
  assert.ok(!byKey.o1_employee_checklist.visaTypes.includes("O-2"));
});

test("O-2 employer: 3 required documents, no O-1 classification selector or extra docs", () => {
  const files = byKey.o2_employer_checklist.questions.filter((q) => q.type === "file");
  assert.equal(files.length, 3);
  assert.ok(files.every((q) => q.required));
  assert.ok(!byKey.o2_employer_checklist.questions.some((q) => /oClassification/.test(q.key)));
});

test("O-2 employee: 11 documents, no O-1A/O-1B criteria groups, typed + required fields", () => {
  const questions = byKey.o2_employee_checklist.questions;
  assert.equal(questions.filter((q) => q.type === "file").length, 11);
  assert.ok(!questions.some((q) => /criteri/i.test(q.key)));
  const q = (suffix) => questions.find((item) => item.key === `employee_${suffix}`);
  assert.equal(q("personal_dateOfBirth").type, "date");
  assert.equal(q("personal_dateOfBirth").required, true);
  assert.equal(q("personal_passportNumber").required, true);
  assert.equal(q("personal_socialSecurityNumber").required, false);
  assert.equal(q("personal_middleName").required, false);
  assert.equal(q("otherInformation_hasDependents").type, "radio");
  assert.equal(q("otherInformation_numberOfDependents").type, "number");
});

test("a new O-1A / O-1B / O-2 case (dropdown spellings) is assigned the right checklists", () => {
  const apply = (visaType, key) => ImmigrationKnowledgeEngineService.questionnaireApplies(byKey[key], { visaType });
  for (const visaType of ["o1a", "O-1A", "o1b", "O-1B"]) {
    assert.ok(apply(visaType, "o1_employer_checklist") && apply(visaType, "o1_employee_checklist"), visaType);
    assert.ok(!apply(visaType, "o2_employer_checklist") && !apply(visaType, "o2_employee_checklist"), visaType);
  }
  for (const visaType of ["o2", "O-2"]) {
    assert.ok(apply(visaType, "o2_employer_checklist") && apply(visaType, "o2_employee_checklist"), visaType);
    assert.ok(!apply(visaType, "o1_employer_checklist") && !apply(visaType, "o1_employee_checklist"), visaType);
  }
});
