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
const ReverseIndexService = require("../../form-mapping/services/ReverseIndexService");
const FormMappingService = require("../../form-mapping/services/FormMappingService");
const Case = require("../../../models/Case");
const CaseForm = require("../../../models/CaseForm");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");

// Allowlist of CanonicalProfileService's public surface. `rebuild` and `resolveConflict` and
// `validate` DO write, but only to the whole profile (rebuild-from-sources or resolve-a-detected-
// conflict) - none of them apply a single manually-overridden field value, the way
// AutoFillService.overrideField does for CaseForm.
//
// Phase 2 (see docs/forms/PHASE2_BASELINE.md) deliberately adds exactly one: `applyStaffEdit`,
// the field-level canonical write-back this invariant's original comment anticipated. Its
// internals (collecting/re-applying durable staff overrides inside `rebuild()`) are static
// PRIVATE methods (`#collectStaffOverrides`/`#applyStaffOverrides`) precisely so they don't widen
// this list further - private class members never appear in `Object.getOwnPropertyNames`. If a
// later phase adds another field-level method here, that's a deliberate, reviewed architectural
// change - this test exists so it can't happen silently as a side effect of unrelated work.
const EXPECTED_CANONICAL_PROFILE_SERVICE_METHODS = ["userId", "audit", "get", "rebuild", "resolveConflict", "validate", "history", "applyStaffEdit"];

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

// ── Phase 0's original invariant here read: "AutoFillService.overrideField mutates only the
// CaseForm, never Case.canonicalProfile" - true for every field at the time it was written,
// because no field-level canonical write-back existed yet. Phase 2 (see
// docs/forms/PHASE2_BASELINE.md) deliberately makes this field-dependent: a reverseSync-eligible
// direct mapping (ReverseIndexService) now DOES reach Case.canonicalProfile, exclusively through
// CanonicalProfileService.applyStaffEdit (overrideField still never mutates canonicalProfile
// itself - it only decides whether to call applyStaffEdit and fans its result out to sibling PDF
// fields on the same form). A derived/composite mapping (reverseSync:false) or a form-only
// (unmapped) field retain the ORIGINAL invariant unchanged - split into the two tests below so
// each half of the new contract has its own explicit, reviewed regression guard.
const REVERSE_SYNC_ACTOR = { _id: new mongoose.Types.ObjectId(), role: "admin" };

test("Phase 2 invariant: AutoFillService.overrideField reaches Case.canonicalProfile ONLY through applyStaffEdit, for a reverseSync-eligible field", async (t) => {
  await connectTestDB();
  const caseNumber = `PHASE2-INV-${new mongoose.Types.ObjectId().toString()}`;
  let caseDoc;
  let caseFormDoc;
  t.after(async () => {
    if (caseFormDoc) await CaseForm.deleteOne({ _id: caseFormDoc._id });
    if (caseDoc) await Case.deleteOne({ _id: caseDoc._id });
    await disconnectTestDB();
  });

  const template = await USCISFormTemplate.findOne({ formCode: "I-129" }).select("_id formCode version").lean();
  assert.ok(template, "expected at least one I-129 USCISFormTemplate to be seeded in the test DB (npm run seed:i129)");

  // form1[0].#subform[2].Line8a_StreetNumberName[0] maps to contact.address.line1, a direct atomic
  // mapping - confirmed reverseSync:true via ReverseIndexService (see ReverseIndexService.test.js).
  // ReverseIndexService/overrideField operate on the template's normalized fieldId, not the raw
  // AcroForm fieldName, so it's resolved here the same way every other Phase 2 test does.
  const loadedTemplate = await FormMappingService.loadTemplate("I-129");
  const streetField = loadedTemplate.formFields.find((f) => f.fieldName === "form1[0].#subform[2].Line8a_StreetNumberName[0]").fieldId;
  const reverseIndex = await ReverseIndexService.buildFormReverseIndex("I-129");
  assert.ok(reverseIndex.get("contact.address.line1")?.some((entry) => entry.pdfField === streetField && entry.reverseSync === true), "expected this field to still be reverseSync:true - if this fails, the crosswalk changed and this test's premise needs a different field");

  caseDoc = await Case.create({
    caseNumber,
    visaType: "H-1B",
    status: "active",
    canonicalProfile: { profile: { person: { firstName: "Baseline", lastName: "Untouched" } }, fieldMetadata: {}, conflicts: [], version: 1, status: "valid", lastBuiltAt: new Date() },
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

  await AutoFillService.overrideField(caseDoc._id, "I-129", streetField, "123 Main St", REVERSE_SYNC_ACTOR, {}, "phase 2 invariant probe");

  const afterCaseForm = await CaseForm.findById(caseFormDoc._id).lean();
  assert.equal(afterCaseForm.fieldValues[streetField], "123 Main St", "overrideField should still have written the CaseForm field value");
  assert.ok(afterCaseForm.manualOverrides[streetField], "overrideField should still record a manualOverrides entry");

  const afterProfile = (await Case.findById(caseDoc._id).select("canonicalProfile canonicalHistory").lean());
  assert.equal(
    afterProfile.canonicalProfile.profile.contact?.address?.line1,
    "123 Main St",
    "a reverseSync-eligible field's edit MUST now reach Case.canonicalProfile - this is the deliberate Phase 2 change, made exclusively via applyStaffEdit"
  );
  assert.ok(
    afterProfile.canonicalHistory.some((entry) => entry.action === "staff_edit_applied"),
    "the canonical mutation must be attributable to applyStaffEdit's own history entry, not an ad-hoc write inside overrideField"
  );
});

test("Phase 0 invariant (still holds): a derived/composite or form-only field never reaches Case.canonicalProfile", async (t) => {
  await connectTestDB();
  const caseNumber = `PHASE2-INV-FORMONLY-${new mongoose.Types.ObjectId().toString()}`;
  let caseDoc;
  let caseFormDoc;
  t.after(async () => {
    if (caseFormDoc) await CaseForm.deleteOne({ _id: caseFormDoc._id });
    if (caseDoc) await Case.deleteOne({ _id: caseDoc._id });
    await disconnectTestDB();
  });

  const template = await USCISFormTemplate.findOne({ formCode: "I-129" }).select("_id formCode version").lean();
  assert.ok(template, "expected at least one I-129 USCISFormTemplate to be seeded in the test DB (npm run seed:i129)");

  // form1[0].#subform[13].Line2_BeneficiaryName[0] maps to person.fullName, a derived/composite
  // mapping - confirmed reverseSync:false via ReverseIndexService (see ReverseIndexService.test.js).
  const loadedTemplate = await FormMappingService.loadTemplate("I-129");
  const fullNameField = loadedTemplate.formFields.find((f) => f.fieldName === "form1[0].#subform[13].Line2_BeneficiaryName[0]").fieldId;
  const reverseIndex = await ReverseIndexService.buildFormReverseIndex("I-129");
  assert.ok(reverseIndex.get("person.fullName")?.some((entry) => entry.pdfField === fullNameField && entry.reverseSync === false), "expected this field to still be reverseSync:false - if this fails, the crosswalk changed and this test's premise needs a different field");

  caseDoc = await Case.create({
    caseNumber,
    visaType: "H-1B",
    status: "active",
    canonicalProfile: { profile: { person: { firstName: "Baseline", lastName: "Untouched" } }, fieldMetadata: {}, conflicts: [], version: 1, status: "valid", lastBuiltAt: new Date() },
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

  await AutoFillService.overrideField(caseDoc._id, "I-129", fullNameField, "John A. Smith", REVERSE_SYNC_ACTOR, {}, "phase 0 invariant probe");

  const afterCaseForm = await CaseForm.findById(caseFormDoc._id).lean();
  assert.equal(afterCaseForm.fieldValues[fullNameField], "John A. Smith", "overrideField should have written the CaseForm field value");
  assert.ok(afterCaseForm.manualOverrides[fullNameField], "overrideField should record a manualOverrides entry");

  const afterProfile = (await Case.findById(caseDoc._id).select("canonicalProfile").lean()).canonicalProfile;
  assert.deepEqual(
    afterProfile.profile,
    beforeProfile.profile,
    "AutoFillService.overrideField must never guess a reverse mapping for a derived/composite field - " +
      "canonicalProfile must stay byte-identical. If this fails, either a regression was introduced, or " +
      "a later phase now applies a reviewed, explicit reverse transform for this field type."
  );
  assert.equal(afterProfile.version, beforeProfile.version, "canonicalProfile.version must not bump for a non-reverse-sync field");
});
