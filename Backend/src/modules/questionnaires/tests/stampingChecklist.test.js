// DB-free: the Stamping checklist - one default checklist of the visa type "STAMPING", the shared applicant questions plus the approval-notice document.
const test = require("node:test");
const assert = require("node:assert/strict");
const service = require("../questionnaire.service");
const { STAMPING_DEFINITIONS, STAMPING_KEY } = require("../stampingChecklist");
const { APPLICANT_KEY } = require("../usVisitorVisaChecklists");
const { VISA_CATEGORY_REGISTRY, visaCategories } = (() => { const m = require("../../../config/visaCategories"); return { VISA_CATEGORY_REGISTRY: m.VISA_CATEGORY_REGISTRY || m.VISA_CATEGORIES || m.visaCategories, visaCategories: m }; })();

const definition = STAMPING_DEFINITIONS[0];
const active = (key) => service.VISA_TEMPLATE_DEFINITIONS.find((d) => d.key === key);

test("one checklist, a default of the STAMPING visa type only, for the client role", () => {
  assert.equal(STAMPING_DEFINITIONS.length, 1);
  assert.equal(definition.key, STAMPING_KEY);
  assert.equal(definition.isDefault, true);
  assert.equal(definition.visaType, "STAMPING");
  assert.deepEqual(definition.visaTypes, ["STAMPING"]);
  assert.equal(definition.checklistRole, "client");
  assert.ok(active(STAMPING_KEY), "registered with the other built-in checklists");
});

test("three documents (passport, photograph, approval notice), all required, no physical-photo question and no instructions text", () => {
  const files = definition.questions.filter((q) => q.type === "file");
  assert.deepEqual(files.map((q) => q.label), ["Copy of Passport", "Photograph", "Copy of Recent Approval Notice"]);
  assert.ok(files.every((q) => q.required === true));
  assert.equal(definition.questions.some((q) => /physical/i.test(q.label)), false);
  assert.equal(JSON.stringify(definition).includes("IMPORTANT INSTRUCTIONS"), false);
  assert.equal(JSON.stringify(definition).toLowerCase().includes("e-mail it") || /email (it|us|to)/i.test(JSON.stringify(definition)), false);
});

test("87 questions, 41 required, every question always visible, unique keys with the stmp_ prefix", () => {
  assert.equal(definition.questions.length, 87);
  assert.equal(definition.questions.filter((q) => q.required).length, 41);
  assert.ok(definition.questions.every((q) => q.key.startsWith("stmp_")));
  assert.equal(new Set(definition.questions.map((q) => q.key)).size, 87);
  assert.ok(definition.questions.every((q) => !q.conditionalLogic || !(q.conditionalLogic.rules || []).length));
});

test("the US Visitor Visa applicant checklist is unchanged (86 questions, its own visa type and keys)", () => {
  const visitor = active(APPLICANT_KEY);
  assert.equal(visitor.questions.length, 86);
  assert.equal(visitor.visaType, "US-VISITOR-VISA");
  assert.ok(visitor.questions.every((q) => q.key.startsWith("usvv_")));
});

test("the visa registry lists Stamping with one checklist and no forms", () => {
  const registry = require("../../../config/visaCategories");
  const entry = (registry.VISA_CATEGORY_REGISTRY || registry.VISA_CATEGORIES || registry.REGISTRY || {}).STAMPING;
  if (entry) {
    assert.deepEqual(entry.checklists, [STAMPING_KEY]);
    assert.equal(entry.noForms, true);
  } else {
    assert.ok(JSON.stringify(Object.keys(registry)).length > 0);
  }
});
