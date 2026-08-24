// Phase 2 (§I.5) - fan-out invariant tests for K-1 (I-129F) and K-3 (I-130), extending §I.3's
// I-129 (H-1B/L-1A) coverage in AutoFillService.overrideField.reverseSync.test.js to the other two
// mapped forms. Runs against the REAL compiled mapping graphs for I-129F/I-130 and the local test
// DB only - never a hand-built mapping graph, never Atlas.
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const AutoFillService = require("../services/AutoFillService");
const ReverseIndexService = require("../services/ReverseIndexService");
const SyncStateService = require("../services/SyncStateService");
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

  const caseDoc = await Case.create({
    caseNumber: `PHASE2-I5-${new mongoose.Types.ObjectId().toString()}`,
    visaType: formCode === "I-129F" ? "K-1" : "K-3",
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

test("K-1 (I-129F) fan-out: a mapped field (petitioner_info_lastName) resolves correctly", async () => {
  // Phase 4 update: person.citizenship (used here through Phase 2/3) was the same class of
  // stale, non-crosswalk-authored mapping as I-130's contact.address.zip - I-129F's
  // USCISMappingVersion had ALSO never been activated (see docs/forms/PHASE4_BASELINE.md).
  // Activating it correctly cleared this stale entry along with ~115 others. Updated to a
  // genuinely-reviewed field, not reverted.
  const { caseDoc, caseForm, siblingFieldIds } = await makeCaseAndForm("I-129F", "raw.questionnaireAnswers.petitioner_info_lastName.value", "Chen");
  try {
    assert.equal(siblingFieldIds.length, 1, "petitioner_info_lastName's real I-129F mapping count");
    const [editedField] = siblingFieldIds;

    const result = await AutoFillService.overrideField(caseDoc._id, "I-129F", editedField, "Chen-Ortiz", ACTOR, {}, "K-1 fan-out test");

    assert.equal(result.fieldValues[editedField], "Chen-Ortiz");
    assert.equal(SyncStateService.getSyncState(result, editedField), SyncStateService.MANUAL_OVERRIDE);

    const storedCase = await Case.findById(caseDoc._id).lean();
    assert.equal(storedCase.canonicalProfile.profile.raw.questionnaireAnswers.petitioner_info_lastName.value, "Chen-Ortiz", "canonical stores the value exactly once");
  } finally {
    await cleanup(caseDoc, caseForm);
  }
});

test("K-3 (I-130) fan-out: a mapped field (petitioner_info_lastName) resolves correctly", async () => {
  // Phase 4 update: contact.address.zip (used here through Phase 2/3) was one of ~122 stale,
  // non-crosswalk-authored entries that happened to persist on USCISFormTemplate.formFields[]
  // .mappings because I-130's USCISMappingVersion had never actually been activated (P0-CD-001's
  // real root cause - see docs/forms/PHASE4_BASELINE.md). Activating it made
  // FormMappingService.applyMappingGraph rebuild formFields[].mappings from ONLY the 33 reviewed
  // MAPPED_EDGES, correctly clearing this stale entry along with the others. It was never a real
  // crosswalk edge - updated to a genuinely-reviewed field, not reverted. I-130's reviewed
  // crosswalk currently has no reverseSync:true source with more than 1 target field (its only
  // fan-out sources - gender, maritalStatus - are checkbox-derived, reverseSync:false), so this
  // is a single-target check; the mechanism itself is still fully exercised.
  const { caseDoc, caseForm, siblingFieldIds } = await makeCaseAndForm("I-130", "raw.questionnaireAnswers.petitioner_info_lastName.value", "Alvarez");
  try {
    assert.equal(siblingFieldIds.length, 1, "petitioner_info_lastName's real I-130 mapping count");
    const [editedField] = siblingFieldIds;

    const result = await AutoFillService.overrideField(caseDoc._id, "I-130", editedField, "Alvarez-Cruz", ACTOR, {}, "K-3 fan-out test");

    assert.equal(result.fieldValues[editedField], "Alvarez-Cruz");
    assert.equal(SyncStateService.getSyncState(result, editedField), SyncStateService.MANUAL_OVERRIDE);

    const storedCase = await Case.findById(caseDoc._id).lean();
    assert.equal(storedCase.canonicalProfile.profile.raw.questionnaireAnswers.petitioner_info_lastName.value, "Alvarez-Cruz", "canonical stores the value exactly once");
  } finally {
    await cleanup(caseDoc, caseForm);
  }
});

test("K-3 (I-130) P0-CD-001 is fixed: the 10 previously-absent petitioner/beneficiary identity fields are now present and reverseSync:true", async () => {
  // P0-CD-001 (docs/forms/PHASE0_CANDIDATE_DEFECTS.md) is FIXED as of Phase 4 - see
  // docs/forms/PHASE4_BASELINE.md and i130-k3-golden-case.test.js for the full PDF-byte-level
  // proof (reads the actual generated PDF via pdf-lib). The real root cause: I-130's
  // USCISMappingVersion had never been activated, so USCISFormTemplate.formFields[].mappings
  // still reflected stale, pre-crosswalk auto-suggested data (confirmed empirically - see the
  // ledger) for these 10 fields specifically, not a resolver-level bug in FormMappingService/
  // MappingResolver as originally hypothesized. Re-running `npm run seed:i130-k3-mapping`
  // (unchanged file - the crosswalk was already correct) fixed it. This permanent regression
  // guard confirms the fix holds.
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
    assert.ok(entries.every((entry) => entry.reverseSync), `${path}: every mapped PDF field must be reverseSync:true`);
  });
});
