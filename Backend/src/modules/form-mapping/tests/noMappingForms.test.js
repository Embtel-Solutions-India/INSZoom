// DB-free: a form with nothing to map is released on certification alone - the two configured forms, and any form the pipeline itself marked (lifecycle.autoNoMapping).
const assert = require("node:assert/strict");
const test = require("node:test");
const { isNoMappingForm, NO_MAPPING_FORMS } = require("../config/partyFormSpecs");

test("the configured no-mapping forms are recognised by code alone", () => {
  for (const formCode of NO_MAPPING_FORMS) assert.equal(isNoMappingForm({ formCode }), true);
});

test("a form the pipeline marked as having nothing to map is a no-mapping form", () => {
  assert.equal(isNoMappingForm({ formCode: "X-1", lifecycle: { autoNoMapping: { by: "system:pipeline", reason: "no authored or inferable rules for this form" } } }), true);
});

test("an ordinary form, an unmarked lifecycle and a missing template are not", () => {
  assert.equal(isNoMappingForm({ formCode: "I-129", lifecycle: {} }), false);
  assert.equal(isNoMappingForm({ formCode: "I-129" }), false);
  assert.equal(isNoMappingForm(null), false);
  assert.equal(isNoMappingForm(undefined), false);
});
