// Phase 0 safety-net invariants for the canonical-profile / manual-override boundary.
// These are tripwires for the USCIS-forms re-architecture (Phases 1-5): later phases must not
// silently cross this boundary without a deliberate, reviewed decision. This file is additive
// only - it characterizes and guards existing behavior, it does not change any pipeline file.
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const CanonicalProfileService = require("../services/CanonicalProfileService");
const AutoFillService = require("../../form-mapping/services/AutoFillService");
const Case = require("../../../models/Case");
const CaseForm = require("../../../models/CaseForm");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");

// Allowlist of CanonicalProfileService's public surface as of Phase 0. `rebuild` and
// `resolveConflict` and `validate` DO write, but only to the whole profile (rebuild-from-sources
// or resolve-a-detected-conflict) - none of them apply a single manually-overridden field value,
// the way AutoFillService.overrideField does for CaseForm. If Phase 3 adds a field-level
// apply/override method here, that's a deliberate, reviewed architectural change - this test
// exists so it can't happen silently as a side effect of unrelated work.
const EXPECTED_CANONICAL_PROFILE_SERVICE_METHODS = ["userId", "audit", "get", "rebuild", "resolveConflict", "validate", "history"];

test("Phase 0 invariant: CanonicalProfileService's public method surface matches the Phase 0 baseline allowlist", () => {
  const actual = Object.getOwnPropertyNames(CanonicalProfileService)
    .filter((name) => typeof CanonicalProfileService[name] === "function")
    .sort();
  const expected = [...EXPECTED_CANONICAL_PROFILE_SERVICE_METHODS].sort();
  assert.deepEqual(
    actual,
    expected,
    "CanonicalProfileService gained or lost a public method since the Phase 0 baseline was recorded " +
      "(docs/forms/PHASE0_BASELINE.md §3). If this is a deliberate Phase 3+ change (e.g. a new " +
      "field-level apply/override method), update EXPECTED_CANONICAL_PROFILE_SERVICE_METHODS here " +
      "and cross-reference the baseline doc - do not just widen this list to make the test pass."
  );
});

test("Phase 0 invariant: AutoFillService.overrideField mutates only the CaseForm, never Case.canonicalProfile", async (t) => {
  await connectTestDB();
  const caseNumber = `PHASE0-INV-${new mongoose.Types.ObjectId().toString()}`;
  let caseDoc;
  let caseFormDoc;
  t.after(async () => {
    if (caseFormDoc) await CaseForm.deleteOne({ _id: caseFormDoc._id });
    if (caseDoc) await Case.deleteOne({ _id: caseDoc._id });
    await disconnectTestDB();
  });

  const template = await USCISFormTemplate.findOne({ formCode: "I-129" }).select("_id formCode version").lean();
  assert.ok(template, "expected at least one I-129 USCISFormTemplate to be seeded in the test DB (npm run seed:i129)");

  caseDoc = await Case.create({
    caseNumber,
    visaType: "H-1B",
    status: "active",
    canonicalProfile: { profile: { person: { firstName: "Baseline", lastName: "Untouched" } }, version: 1, status: "valid", lastBuiltAt: new Date() },
  });
  caseFormDoc = await CaseForm.create({
    caseId: caseDoc._id,
    formTemplateId: template._id,
    formCode: "I-129",
    formVersion: template.version || "1",
    filledData: {},
    fieldValues: {},
    sourceAttribution: {},
    manualOverrides: {},
  });

  const beforeProfile = (await Case.findById(caseDoc._id).select("canonicalProfile").lean()).canonicalProfile;

  await AutoFillService.overrideField(
    caseDoc._id,
    "I-129",
    "form1[0].#subform[2].Line8a_StreetNumberName[0]",
    "123 Main St",
    { _id: new mongoose.Types.ObjectId(), role: "attorney" },
    {},
    "phase0 invariant probe"
  );

  const afterCaseForm = await CaseForm.findById(caseFormDoc._id).lean();
  assert.equal(afterCaseForm.fieldValues["form1[0].#subform[2].Line8a_StreetNumberName[0]"], "123 Main St", "overrideField should have written the CaseForm field value");
  assert.ok(afterCaseForm.manualOverrides["form1[0].#subform[2].Line8a_StreetNumberName[0]"], "overrideField should record a manualOverrides entry");

  const afterProfile = (await Case.findById(caseDoc._id).select("canonicalProfile").lean()).canonicalProfile;
  assert.deepEqual(
    afterProfile.profile,
    beforeProfile.profile,
    "AutoFillService.overrideField must never mutate Case.canonicalProfile - a manual field override " +
      "is scoped to the one CaseForm only. If this fails, either a regression was introduced, or Phase " +
      "3's new canonical write-back API is now being called from overrideField (a deliberate, reviewed change)."
  );
  assert.equal(afterProfile.version, beforeProfile.version, "canonicalProfile.version must not bump from a CaseForm-only override");
});
