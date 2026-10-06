// PERM stage gating: a new PERM case has no USCIS form; each later form appears only at its stage.
// Pure tests - no database.
const test = require("node:test");
const assert = require("node:assert/strict");

const { permStageFlags, permStageAllowsForm, permTriggerFor, PERM_STAGE_FORMS } = require("../../../config/permStages");
const { evaluateTrigger } = require("../visaFormMapping.service");
const { mappings } = require("../seeds/visaFormMappings.seed");
const VisaFormMapping = require("../../../models/VisaFormMapping");

const perm = (permWorkflow) => ({ visaType: "PERM", permWorkflow });
const registryAllows = (caseData, formNumber) => {
  const row = mappings.find((item) => item.visaType === "PERM" && item.formNumber === formNumber);
  return evaluateTrigger(row.triggerCondition, caseData);
};

test("PERM created: no USCIS form is allowed by either gate", () => {
  const fresh = perm({});
  for (const form of Object.keys(PERM_STAGE_FORMS)) {
    assert.equal(permStageAllowsForm(fresh, form), false, form);
    assert.equal(registryAllows(fresh, form), false, form);
  }
  assert.equal(permStageAllowsForm({ visaType: "PERM" }, "I-140"), false, "a case with no permWorkflow at all");
});

test("PERM certified: only I-140", () => {
  const certified = perm({ certified: true });
  assert.deepEqual(Object.keys(PERM_STAGE_FORMS).filter((form) => registryAllows(certified, form)), ["I-140"]);
  assert.equal(permStageAllowsForm(certified, "I-485"), false);
});

test("adjustment stage: I-485, but not I-765 / I-131 until they apply", () => {
  const aos = perm({ certified: true, adjustmentOfStatus: true });
  assert.deepEqual(Object.keys(PERM_STAGE_FORMS).filter((form) => registryAllows(aos, form)), ["I-140", "I-485"]);
});

test("I-765 and I-131 are independent conditions at the adjustment stage", () => {
  const ead = perm({ certified: true, adjustmentOfStatus: true, employmentAuthorization: true });
  assert.deepEqual(Object.keys(PERM_STAGE_FORMS).filter((form) => registryAllows(ead, form)), ["I-140", "I-485", "I-765"]);
  const ap = perm({ certified: true, adjustmentOfStatus: true, advanceParole: true });
  assert.deepEqual(Object.keys(PERM_STAGE_FORMS).filter((form) => registryAllows(ap, form)), ["I-140", "I-485", "I-131"]);
});

test("a later flag without its prerequisite stage opens nothing extra", () => {
  const skipped = perm({ adjustmentOfStatus: true, employmentAuthorization: true, advanceParole: true });
  assert.deepEqual(permStageFlags(skipped), { permCertified: false, permAdjustmentStage: false, permEmploymentAuthorization: false, permAdvanceParole: false });
});

test("only PERM cases are gated; other visa types and unlisted forms are untouched", () => {
  assert.equal(permStageAllowsForm({ visaType: "H-1B" }, "I-485"), true);
  assert.equal(permStageAllowsForm({ visaType: "EB-2 PERM" }, "I-140"), true);
  assert.equal(permStageAllowsForm(perm({}), "I-907"), true);
});

test("registry rows: PERM stage forms are CONDITIONAL, never created with the case; ETA forms are DOL", () => {
  const rows = mappings.filter((item) => item.visaType === "PERM");
  for (const form of Object.keys(PERM_STAGE_FORMS)) {
    const row = rows.find((item) => item.formNumber === form);
    assert.equal(row.provisioningType, "CONDITIONAL", form);
    assert.equal(row.initialCaseCreation, false, form);
    assert.equal(row.agency, "USCIS");
    assert.deepEqual(row.triggerCondition, permTriggerFor(form));
  }
  for (const form of ["ETA-9141", "ETA-9089"]) assert.equal(rows.find((item) => item.formNumber === form).agency, "DOL");
  assert.ok(!rows.some((item) => item.provisioningType === "AUTO_CREATE"), "no PERM form is auto-created");
});

test("every PERM trigger field is on the model's whitelist", () => {
  for (const flag of ["permCertified", "permAdjustmentStage", "permEmploymentAuthorization", "permAdvanceParole"]) {
    assert.ok(VisaFormMapping.TRIGGER_FIELD_WHITELIST.includes(flag), flag);
  }
});
