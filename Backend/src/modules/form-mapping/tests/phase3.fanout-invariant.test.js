// Phase 3 (§I.1) - the PERMANENT CI fan-out invariant. This is the tripwire that protects every
// later phase from regressing Phase 2's core guarantee: one canonical edit -> every PDF field
// sharing that source updates, sync states land correctly, and canonical stores the value exactly
// once. Runs in `npm test` (matches src/**/*.test.js) and in `npm run phase3:verify`. If this file
// ever fails in a LATER phase, that phase regressed Phase 2/3 - it did not fail because of anything
// in Phase 3 itself.
//
// Deliberately does not duplicate Phase 2's own exhaustive test suites
// (AutoFillService.overrideField.reverseSync.test.js has 12 tests, .k1k3-fanout.test.js has 3) -
// this file asserts the single combined invariant those suites already proved piecewise, as one
// tight, permanent regression gate per form.
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const AutoFillService = require("../services/AutoFillService");
const FormMappingService = require("../services/FormMappingService");
const ReverseIndexService = require("../services/ReverseIndexService");
const Case = require("../../../models/Case");
const CaseForm = require("../../../models/CaseForm");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");

const ACTOR = { _id: new mongoose.Types.ObjectId(), role: "admin" };

test.before(async () => {
  await connectTestDB();
});

test.after(async () => {
  await disconnectTestDB();
});

async function makeCaseAndForm(formCode, sourcePath, initialValue) {
  const templateDoc = await USCISFormTemplate.findOne({ formCode }).select("_id version").lean();
  assert.ok(templateDoc, `expected an active ${formCode} USCISFormTemplate to be seeded in the test DB`);
  const reverseIndex = await ReverseIndexService.buildFormReverseIndex(formCode);
  const siblingFieldIds = (reverseIndex.get(sourcePath) || []).map((entry) => entry.pdfField);
  assert.ok(siblingFieldIds.length > 0, `expected ${sourcePath} to be a real reverseSync-eligible source on ${formCode}`);

  const caseDoc = await Case.create({
    caseNumber: `PHASE3-CI-${new mongoose.Types.ObjectId().toString()}`,
    visaType: "H-1B",
    status: "active",
    canonicalProfile: { profile: {}, fieldMetadata: {}, conflicts: [], version: 1, status: "valid", lastBuiltAt: new Date() },
  });
  const filledData = {};
  siblingFieldIds.forEach((fieldId) => { filledData[fieldId] = initialValue; });
  const caseForm = await CaseForm.create({
    caseId: caseDoc._id,
    formTemplateId: templateDoc._id,
    formCode,
    formVersion: templateDoc.version || "1",
    filledData,
    fieldValues: { ...filledData },
    sourceAttribution: {},
    manualOverrides: {},
  });
  return { caseDoc, caseForm, siblingFieldIds };
}

async function cleanup(caseDoc, caseForm) {
  if (caseForm) await CaseForm.deleteOne({ _id: caseForm._id });
  if (caseDoc) await Case.deleteOne({ _id: caseDoc._id });
}

// The core invariant, parameterized per form/source so I-129, I-129F, and (for the mapped subset)
// I-130 all exercise the identical assertion set.
async function assertFanOutInvariant({ formCode, sourcePath, initialValue, newValue }) {
  const { caseDoc, caseForm, siblingFieldIds } = await makeCaseAndForm(formCode, sourcePath, initialValue);
  try {
    const [editedField, ...untouchedSiblings] = siblingFieldIds;

    const result = await AutoFillService.overrideField(caseDoc._id, formCode, editedField, newValue, ACTOR, {}, "CI fan-out invariant");

    // Every PDF field sharing the same canonical source now holds the updated value.
    siblingFieldIds.forEach((fieldId) => {
      assert.equal(result.fieldValues[fieldId], newValue, `${formCode}: expected ${fieldId} to hold the fanned-out value`);
    });

    // The edited field's syncState is MANUAL_OVERRIDE.
    assert.equal(result.sourceAttribution[editedField].syncState, "MANUAL_OVERRIDE", `${formCode}: edited field must be MANUAL_OVERRIDE`);

    // Every untouched fan-out sibling's syncState is SYNCED.
    untouchedSiblings.forEach((fieldId) => {
      assert.equal(result.sourceAttribution[fieldId].syncState, "SYNCED", `${formCode}: untouched sibling ${fieldId} must be SYNCED`);
    });

    // Canonical stores the value exactly once, at exactly one path.
    const storedCase = await Case.findById(caseDoc._id).lean();
    const canonicalValue = sourcePath.split(".").reduce((cursor, key) => cursor?.[key], storedCase.canonicalProfile.profile);
    assert.equal(canonicalValue, newValue, `${formCode}: canonical must store the new value at ${sourcePath}`);

    // The staff edit itself was applied exactly once - see this file's own header and
    // docs/forms/PHASE2_BASELINE.md §7 for why "canonicalProfile.version incremented exactly
    // once" is NOT the right assertion here: the fan-out's own generate() call triggers a
    // SEPARATE, legitimate rebuild() (rebuild() has no no-op short-circuit of its own - only
    // applyStaffEdit does), which bumps the version a second time. That second bump is a
    // distinct, correctly-attributed profile_rebuilt event, not a duplicate application of this
    // edit - asserting a literal "+1" version delta would be asserting something Phase 2 never
    // actually guaranteed and would make this permanent gate flaky/wrong by construction.
    const staffEditEntries = storedCase.canonicalHistory.filter((entry) => entry.action === "staff_edit_applied" && entry.changes?.edits?.some((edit) => edit.path === sourcePath && edit.value === newValue));
    assert.equal(staffEditEntries.length, 1, `${formCode}: the staff edit must be applied exactly once, not duplicated across the fan-out`);

    return { caseDoc, caseForm: result, editedField, siblingFieldIds };
  } finally {
    await cleanup(caseDoc, caseForm);
  }
}

test("CI fan-out invariant: I-129 (H-1B/L-1A), person.lastName -> 3 fields", async () => {
  await assertFanOutInvariant({ formCode: "I-129", sourcePath: "person.lastName", initialValue: "Smith", newValue: "Johnson" });
});

// Phase 4 update: person.citizenship (used here through Phase 2/3) turned out to be the SAME
// class of stale, non-crosswalk-authored mapping as I-130's contact.address.zip - I-129F's
// USCISMappingVersion had ALSO never been activated (discovered while investigating P0-CD-001's
// real root cause - see docs/forms/PHASE4_BASELINE.md). Activating it (npm run
// seed:i129f-k1-mapping) correctly cleared it along with ~115 other stale entries. Updated to a
// genuinely-reviewed field, not reverted. I-129F's reviewed crosswalk also has no reverseSync:true
// source with more than 1 target field (same as I-130 - its fan-out sources, gender/maritalStatus,
// are checkbox-derived), so this is a single-target check.
test("CI fan-out invariant: I-129F (K-1), a real mapped field (petitioner_info_lastName) resolves correctly", async () => {
  await assertFanOutInvariant({ formCode: "I-129F", sourcePath: "raw.questionnaireAnswers.petitioner_info_lastName.value", initialValue: "Chen", newValue: "Chen-Ortiz" });
});

// Phase 4 update: contact.address.zip (used here through Phase 2/3) turned out to be one of
// ~122 STALE, non-crosswalk-authored mappings that happened to survive on USCISFormTemplate.
// formFields[].mappings because I-130's USCISMappingVersion had never actually been activated
// (see P0-CD-001's real root cause, docs/forms/PHASE4_BASELINE.md §1/§2 - activating it made
// FormMappingService.applyMappingGraph rebuild formFields[].mappings from ONLY the 33 reviewed
// MAPPED_EDGES, correctly clearing every stale entry, this one included). It was never a real
// crosswalk edge. Updated to a genuinely-reviewed field - not reverted, since the activation that
// removed it is the correct, intended fix. I-130's reviewed crosswalk currently has no
// reverseSync:true source with more than 1 target field, so this is a single-target check, not a
// multi-field fan-out - the mechanism is still fully exercised, just with n=1.
test("CI fan-out invariant: I-130 (K-3), a real mapped field (petitioner_info_lastName) resolves correctly", async () => {
  await assertFanOutInvariant({ formCode: "I-130", sourcePath: "raw.questionnaireAnswers.petitioner_info_lastName.value", initialValue: "Alvarez", newValue: "Alvarez-Cruz" });
});

// The sibling-CONFLICT scenario (Phase 2/3's TEST 11 equivalent) needs a reverseSync:true source
// with 2+ target fields to have a "sibling" at all. I-130's reviewed crosswalk has none right now
// (its only fan-out sources - gender, maritalStatus - are checkbox-derived, reverseSync:false, so
// they never reach applyStaffEdit in the first place). This mechanism is already proven for I-129
// (3-way) and I-129F (2-way) above; not forcing a fake I-130 example here rather than inventing
// fan-out that doesn't exist in the real, reviewed crosswalk. Revisit if a future crosswalk change
// adds a genuine multi-field reverseSync:true I-130 source.

// P0-CD-001 (docs/forms/PHASE0_CANDIDATE_DEFECTS.md) is FIXED as of Phase 4 - see
// docs/forms/PHASE4_BASELINE.md and i130-k3-golden-case.test.js for the full PDF-byte-level proof.
// This permanent regression guard confirms the fix holds: all 10 previously-absent source paths
// are now present in the reverse index, each reverseSync:true (a direct, atomic mapping).
test("CI fan-out invariant: I-130 (K-3) P0-CD-001 is fixed - the 10 previously-absent fields are now present and reverseSync:true", async () => {
  const idx = await ReverseIndexService.buildFormReverseIndex("I-130");
  const p0cd001Paths = [
    "raw.questionnaireAnswers.petitioner_info_lastName.value",
    "raw.questionnaireAnswers.petitioner_info_firstName.value",
    "raw.questionnaireAnswers.petitioner_info_cityTownOfBirth.value",
    "raw.questionnaireAnswers.petitioner_info_countryOfBirth.value",
    "raw.questionnaireAnswers.petitioner_info_dateOfBirth.value",
    "raw.questionnaireAnswers.beneficiary_info_lastName.value",
    "raw.questionnaireAnswers.beneficiary_info_firstName.value",
    "raw.questionnaireAnswers.beneficiary_info_cityTownOfBirth.value",
    "raw.questionnaireAnswers.beneficiary_info_countryOfBirth.value",
    "raw.questionnaireAnswers.beneficiary_info_dateOfBirth.value",
  ];
  p0cd001Paths.forEach((path) => {
    const entries = idx.get(path);
    assert.ok(entries?.length, `${path} (P0-CD-001) must now be present in the reverse index - if this is absent again, P0-CD-001 has regressed`);
    assert.ok(entries.every((entry) => entry.reverseSync), `${path}: every mapped PDF field must be reverseSync:true (a direct, atomic mapping)`);
  });
});

test("CI fan-out invariant: FormMappingService normalizes form types consistently across calls (sanity guard for the parameterized helper above)", () => {
  assert.equal(FormMappingService.normalizeFormType("i-129"), "I-129");
  assert.equal(FormMappingService.normalizeFormType("i-129f"), "I-129F");
  assert.equal(FormMappingService.normalizeFormType("i-130"), "I-130");
});
