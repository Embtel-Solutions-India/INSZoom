// The Questionnaires page must list every code-defined checklist under a visa type that exists in the visa options (which come from the case-type registry):
// a checklist added for a new case type can never end up "unassigned".
const test = require("node:test");
const assert = require("node:assert/strict");
const service = require("../questionnaire.service");
const { FAMILY_CHECKLIST_DEFINITIONS } = require("../familyChecklists");

const norm = (value) => String(value || "").replace(/[^a-z0-9]+/gi, "").toUpperCase();

test("visa options carry the case structure, and I-130 is a family visa type", () => {
  const options = service.listVisaOptions();
  const i130 = options.find((o) => norm(o.visaType) === "I130");
  assert.ok(i130, "I-130 is a visa option");
  assert.equal(i130.caseStructure, "family");
});

test("every family checklist's visa type is a listed visa option", () => {
  const listed = new Set(service.listVisaOptions().map((o) => norm(o.visaType)));
  for (const definition of FAMILY_CHECKLIST_DEFINITIONS) {
    const types = definition.visaTypes || [definition.visaType];
    assert.ok(types.some((t) => listed.has(norm(t))), `${definition.key} (${types.join(",")}) has no visa option`);
  }
});

test("the removed IR/CR/F2B/F3/F4 visa types (the student-dependent F-2A registry type is a different, kept type) are not listed", () => {
  const listed = service.listVisaOptions().map((o) => norm(o.visaType));
  for (const gone of ["IR1", "IR2", "IR5", "CR1", "CR2", "F2B", "F3", "F4"]) assert.ok(!listed.includes(gone), gone);
});
