// Phase 4 (§I.3) - confirms the new "phone" transform actually reaches the real, compiled
// mapping graph (not just MappingResolver.applyTransform in isolation - see MappingResolver.test.js
// for the unit-level cases). Runs against the local test DB only.
const assert = require("node:assert/strict");
const test = require("node:test");

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const FormMappingService = require("../services/FormMappingService");

test.before(async () => {
  await connectTestDB();
});

test.after(async () => {
  await disconnectTestDB();
});

test("phone transform (§I.3): a raw 10-digit employer daytime phone number renders formatted in the real I-129 mapping output", async () => {
  const template = await FormMappingService.loadTemplate("I-129");
  const canonicalData = { raw: { questionnaireAnswers: { employer_company_daytimePhone: { value: "5125551234" } } } };
  const mapped = FormMappingService.mapTemplate(template, canonicalData);

  const field = template.formFields.find((f) => f.fieldName === "form1[0].#subform[0].Line2_DaytimePhoneNumber1_Part8[0]");
  assert.ok(field, "expected the daytime phone field to still exist on the active I-129 template");
  assert.equal(mapped.fieldValues[field.fieldId], "(512) 555-1234", "the raw digits-only phone value must be formatted as (xxx) xxx-xxxx in the real mapping output, not passed through raw");
});
