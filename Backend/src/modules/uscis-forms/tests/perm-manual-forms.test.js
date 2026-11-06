const assert = require("node:assert/strict");
const test = require("node:test");
const { hasNoForms, allowsManualForms } = require("../../../config/visaCategories");
const service = require("../uscis-form.service");

// DB-free: PERM never gets a form AUTOMATICALLY, but it no longer hides forms - a Case Manager can add one by hand (the DOL ETA-9089 forms today, others in future).
test("PERM: still no automatic forms, and manual forms are allowed; GC-NVC and ordinary case types are unchanged", () => {
  assert.equal(hasNoForms("PERM"), true);
  assert.equal(allowsManualForms("PERM"), true);
  assert.equal(hasNoForms("GC-NVC"), true);
  assert.equal(allowsManualForms("GC-NVC"), false);
  assert.equal(allowsManualForms("H-1B"), false);
  assert.equal(allowsManualForms(undefined), false);
});

test("nothing is assigned automatically to PERM (no selection) or to a no-forms type that does not allow manual forms (even with templates)", async () => {
  assert.deepEqual(await service.ensureAssignedForms({ visaType: "PERM" }, null, {}, {}), []);
  assert.deepEqual(await service.ensureAssignedForms({ visaType: "PERM" }, null, {}, { templates: [] }), []);
  assert.deepEqual(await service.ensureAssignedForms({ visaType: "GC-NVC" }, null, {}, { templates: [{ formCode: "ETA-9089A" }] }), []);
});
