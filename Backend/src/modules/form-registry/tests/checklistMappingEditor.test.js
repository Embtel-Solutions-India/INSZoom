// Form Governance checklist-mapping editor: pure validation - no database.
const test = require("node:test");
const assert = require("node:assert/strict");

const { sanitizeChecklistMappings, sanitizeCondition } = require("../checklist-mapping.service");

const knownKeys = new Set(["h1b_employer_checklist", "i907_premium_processing_profile"]);
const roles = ["employer", "employee", "client", ""];
const clean = (entries) => sanitizeChecklistMappings(entries, { knownKeys, roles });

test("a compulsory checklist is kept as AUTO with no condition, even if one is sent", () => {
  const [entry] = clean([{ checklistKey: "h1b_employer_checklist", assignmentType: "AUTO", role: "employer", condition: { field: "visaType", operator: "equals", value: "H-1B" } }]);
  assert.deepEqual(entry, { checklistKey: "h1b_employer_checklist", assignmentType: "AUTO", role: "employer", condition: null, notes: "" });
});

test("a conditional checklist needs a valid condition built from the approved case fields", () => {
  assert.throws(() => clean([{ checklistKey: "h1b_employer_checklist", assignmentType: "CONDITIONAL" }]), /needs a condition|at least one/);
  assert.throws(() => clean([{ checklistKey: "h1b_employer_checklist", assignmentType: "CONDITIONAL", condition: { field: "password", operator: "equals", value: "x" } }]), /whitelist/);
  const [entry] = clean([{ checklistKey: "h1b_employer_checklist", assignmentType: "CONDITIONAL", condition: { all: [{ field: "newOfficePetition", operator: "equals", value: "yes" }, { field: "processingPath", operator: "in", value: "CONSULAR, NVC" }] } }]);
  assert.deepEqual(entry.condition, { all: [{ field: "newOfficePetition", operator: "equals", value: "yes" }, { field: "processingPath", operator: "in", value: ["CONSULAR", "NVC"] }] });
});

test("unknown checklists, unknown roles, bad assignment types and duplicates are refused", () => {
  assert.throws(() => clean([{ checklistKey: "nope", assignmentType: "AUTO" }]), /does not exist/);
  assert.throws(() => clean([{ checklistKey: "h1b_employer_checklist", assignmentType: "AUTO", role: "wizard" }]), /unknown role/);
  assert.throws(() => clean([{ checklistKey: "h1b_employer_checklist", assignmentType: "SOMETIMES" }]), /assignment must be one of/);
  assert.throws(() => clean([{ checklistKey: "h1b_employer_checklist", assignmentType: "AUTO" }, { checklistKey: "h1b_employer_checklist", assignmentType: "EXPLICIT_CM" }]), /listed twice/);
  assert.throws(() => clean("nope"), /must be a list/);
});

test("the same checklist may appear once per role, and an empty list clears the row", () => {
  assert.equal(clean([{ checklistKey: "h1b_employer_checklist", assignmentType: "AUTO", role: "employer" }, { checklistKey: "h1b_employer_checklist", assignmentType: "AUTO", role: "employee" }]).length, 2);
  assert.deepEqual(clean([]), []);
});

test("conditions: exists is a boolean, empty comparison values are refused", () => {
  assert.deepEqual(sanitizeCondition({ field: "attorneyOnRecord", operator: "exists", value: "true" }), { field: "attorneyOnRecord", operator: "exists", value: true });
  assert.throws(() => sanitizeCondition({ field: "visaType", operator: "equals", value: "  " }), /give a value/);
  assert.equal(sanitizeCondition(null), null);
});

// Template scope: a registry row for a visa type must be matched by the form template's own scope, or a case shows "Configuration issue".
const { missingFromScope, qualifies } = require("../template-scope-sync.service");

test("scope sync: only the visa types a template lacks are added; an authoritative assignmentRules list is kept in step", () => {
  const template = { visaTypes: ["EB-2 PERM", "EB-2 NIW"], assignmentRules: { visaTypes: [] } };
  assert.deepEqual(missingFromScope(template, ["EB-2", "EB-2 NIW"]), { visaTypes: ["EB-2"], assignmentRules: [] });
  const ruled = { visaTypes: ["H-1B"], assignmentRules: { visaTypes: ["H-1B"] } };
  assert.deepEqual(missingFromScope(ruled, ["H-1B", "L-1A"]), { visaTypes: ["L-1A"], assignmentRules: ["L-1A"] });
  assert.deepEqual(missingFromScope({}, []), { visaTypes: [], assignmentRules: [] });
});

test("scope sync: only an active Automatic or Conditional row puts a visa type into a form's scope", () => {
  assert.equal(qualifies({ active: true, provisioningType: "AUTO_CREATE" }), true);
  assert.equal(qualifies({ provisioningType: "CONDITIONAL" }), true);
  assert.equal(qualifies({ active: true, provisioningType: "LATER_STAGE" }), false);
  assert.equal(qualifies({ active: false, provisioningType: "AUTO_CREATE" }), false);
  assert.equal(qualifies(null), false);
});
