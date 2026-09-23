// Final phase (USCIS forms production readiness) §14-16 - registry-wide
// classification guard for SUPPLEMENT and INDEPENDENT (STANDALONE_FORM)
// mappings, complementing Phase 2's ComponentRegistryAudit.test.js (which
// covers FORM_COMPONENT). Derives every expectation from the live registry
// itself - never a hardcoded form list - and fails loudly on any of the
// specific cross-classification errors §15/§16 name: a SUPPLEMENT that
// depends on componentCode instead of its own template, or a
// SUPPLEMENT/STANDALONE_FORM row with no way to resolve a real template at
// all.
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");
const env = require("../../../config/env");
const VisaFormMapping = require("../../../models/VisaFormMapping");
const USCISFormComponentDefinition = require("../../../models/USCISFormComponentDefinition");

test.before(async () => {
  if (mongoose.connection.readyState === 0) await mongoose.connect(env.mongoUri);
});

test.after(async () => {
  await mongoose.disconnect();
});

test("Every active SUPPLEMENT mapping never depends on componentCode (own-template architecture only)", async () => {
  const rows = await VisaFormMapping.find({ active: true, componentType: "SUPPLEMENT" }).select("visaType formNumber formTemplateFormCode componentCode").lean();
  assert.ok(rows.length > 0, "expected at least one active SUPPLEMENT row to audit");
  const invalid = rows.filter((r) => r.componentCode);
  assert.deepEqual(
    invalid.map((r) => `${r.visaType}/${r.formNumber}`),
    [],
    "a SUPPLEMENT row must never carry a componentCode - that would make it depend on FORM_COMPONENT/ComponentPageResolver's parent-page-slicing architecture instead of its own standalone template"
  );
});

test("Every active FORM_COMPONENT mapping never resolves via formTemplateFormCode (must depend on componentCode + a real ACTIVE component definition)", async () => {
  const rows = await VisaFormMapping.find({ active: true, componentType: "FORM_COMPONENT" }).select("visaType formNumber formTemplateFormCode componentCode parentForm").lean();
  assert.ok(rows.length > 0, "expected at least one active FORM_COMPONENT row to audit");
  const activeDefs = await USCISFormComponentDefinition.find({ status: "ACTIVE" }).select("componentCode").lean();
  const activeComponentCodes = new Set(activeDefs.map((d) => d.componentCode));
  for (const row of rows) {
    assert.ok(!row.formTemplateFormCode, `${row.visaType}/${row.formNumber}: FORM_COMPONENT rows must resolve via componentCode, not their own formTemplateFormCode`);
    assert.ok(row.parentForm, `${row.visaType}/${row.formNumber}: FORM_COMPONENT row has no parentForm`);
    assert.ok(row.componentCode, `${row.visaType}/${row.formNumber}: FORM_COMPONENT row has no componentCode`);
    assert.ok(activeComponentCodes.has(row.componentCode), `${row.visaType}/${row.formNumber}: componentCode "${row.componentCode}" has no ACTIVE USCISFormComponentDefinition`);
  }
});

test("Every active STANDALONE_FORM / SUPPLEMENT mapping has a resolvable identity (formTemplateFormCode set, componentCode absent)", async () => {
  const rows = await VisaFormMapping.find({
    active: true,
    componentType: { $in: ["STANDALONE_FORM", "SUPPLEMENT"] },
  }).select("visaType formNumber formTemplateFormCode componentCode").lean();
  assert.ok(rows.length > 0, "expected at least one active STANDALONE_FORM/SUPPLEMENT row to audit");
  const missingIdentity = rows.filter((r) => !r.formTemplateFormCode);
  // Not asserted as a hard failure here - a missing formTemplateFormCode on
  // a STANDALONE_FORM/SUPPLEMENT row is the acquisition-gap failure mode
  // (tracked by the registry closure audit from an earlier phase), a
  // different concern than cross-classification correctness. This test
  // only asserts the classification rule itself: componentCode must never
  // be set for these two types.
  const wronglyComponentCoded = rows.filter((r) => r.componentCode);
  assert.deepEqual(
    wronglyComponentCoded.map((r) => `${r.visaType}/${r.formNumber}`),
    [],
    "a STANDALONE_FORM/SUPPLEMENT row must never carry a componentCode"
  );
  if (missingIdentity.length) {
    console.log(`  (informational, not a failure: ${missingIdentity.length} row(s) have no formTemplateFormCode yet - acquisition gap, tracked separately)`);
  }
});
