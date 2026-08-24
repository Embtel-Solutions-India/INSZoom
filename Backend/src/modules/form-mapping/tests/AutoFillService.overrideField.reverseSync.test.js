// Phase 2 (§I.3) - AutoFillService.overrideField rerouted through CanonicalProfileService.applyStaffEdit
// for reverseSync-eligible fields. Runs against the REAL compiled I-129 mapping graph and the local
// test DB only (never Atlas, never a hand-built mapping graph) - see ReverseIndexService.test.js for
// why that matters. applyStaffEdit's own version/history/audit/concurrency/idempotency mechanics are
// NOT re-tested here in isolation (see CanonicalProfileService.applyStaffEdit.test.js for that) - this
// file tests that overrideField correctly DELEGATES to it rather than duplicating that logic.
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const AutoFillService = require("../services/AutoFillService");
const FormMappingService = require("../services/FormMappingService");
const ReverseIndexService = require("../services/ReverseIndexService");
const SyncStateService = require("../services/SyncStateService");
const CanonicalProfileService = require("../../canonical/services/CanonicalProfileService");
const InteractiveFormReviewService = require("../../uscis-forms/interactive-form-review.service");
const Case = require("../../../models/Case");
const CaseForm = require("../../../models/CaseForm");
const Beneficiary = require("../../../models/Beneficiary");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const AuditLog = require("../../../models/AuditLog");

const ACTOR = { _id: new mongoose.Types.ObjectId(), role: "admin" };
const FORM_CODE = "I-129";

let templateDoc;
let lastNameFieldId; // reverseSync:true, fans out to 3 I-129 fields
let siblingLastNameFieldIds;
let fullNameFieldId; // mapped but derived - reverseSync:false
let unmappedFieldId; // no reverse-index hit at all

test.before(async () => {
  await connectTestDB();
  templateDoc = await USCISFormTemplate.findOne({ formCode: FORM_CODE }).select("_id version").lean();
  const template = await FormMappingService.loadTemplate(FORM_CODE);
  const byName = new Map(template.formFields.map((f) => [f.fieldName, f.fieldId]));
  lastNameFieldId = byName.get("form1[0].#subform[1].Part3_Line2_FamilyName[0]");
  fullNameFieldId = byName.get("form1[0].#subform[13].Line2_BeneficiaryName[0]");
  unmappedFieldId = (template.formFields.find((f) => !f.mappings || !f.mappings.length))?.fieldId;

  const reverseIndex = await ReverseIndexService.buildFormReverseIndex(FORM_CODE);
  siblingLastNameFieldIds = reverseIndex.get("person.lastName").map((entry) => entry.pdfField);
});

test.after(async () => {
  await disconnectTestDB();
});

async function makeCaseAndForm({ lastName = "Smith" } = {}) {
  const caseDoc = await Case.create({
    caseNumber: `PHASE2-I3-${new mongoose.Types.ObjectId().toString()}`,
    visaType: "H-1B",
    status: "active",
    canonicalProfile: { profile: { person: { firstName: "Ada", lastName } }, fieldMetadata: {}, conflicts: [], version: 1, status: "valid", lastBuiltAt: new Date() },
  });
  const filledData = {};
  siblingLastNameFieldIds.forEach((fieldId) => { filledData[fieldId] = lastName; });
  const caseForm = await CaseForm.create({
    caseId: caseDoc._id,
    formTemplateId: templateDoc._id,
    formCode: FORM_CODE,
    formVersion: templateDoc.version || "1",
    filledData,
    fieldValues: { ...filledData },
    sourceAttribution: {},
    manualOverrides: {},
  });
  return { caseDoc, caseForm };
}

async function cleanup(caseDoc, caseForm, beneficiary) {
  if (caseForm) await CaseForm.deleteOne({ _id: caseForm._id });
  if (caseDoc) await Case.deleteOne({ _id: caseDoc._id });
  if (beneficiary) await Beneficiary.deleteOne({ _id: beneficiary._id });
}

test("overrideField reverseSync suite", async (t) => {
  await t.test("TEST 1 - direct reverse sync: the PDF edit flows through applyStaffEdit exactly once", async () => {
    const { caseDoc, caseForm } = await makeCaseAndForm({ lastName: "Smith" });
    try {
      const received = [];
      const listener = (payload) => received.push(payload);
      CanonicalProfileService.events.on("staff-edit-applied", listener);
      let result;
      try {
        result = await AutoFillService.overrideField(caseDoc._id, FORM_CODE, lastNameFieldId, "Johnson", ACTOR, {}, "cm correction");
      } finally {
        CanonicalProfileService.events.off("staff-edit-applied", listener);
      }

      assert.equal(result.fieldValues[lastNameFieldId], "Johnson", "the edited field itself must hold the new value");

      const storedCase = await Case.findById(caseDoc._id).lean();
      assert.equal(storedCase.canonicalProfile.profile.person.lastName, "Johnson", "canonical must reflect the staff edit");

      // "version increments once" is asserted as "applyStaffEdit's own staff_edit_applied history
      // entry appears exactly once" (no duplicate canonical mutation of THIS edit) rather than a
      // literal +1 on the whole call: the fan-out below legitimately triggers ITS OWN separate
      // rebuild() (via generate() -> CanonicalDataService.build()), which bumps the version again
      // as a distinct, correctly-attributed event - a pre-existing rebuild() characteristic
      // (it has no no-op short-circuit), not a duplicate application of the staff edit.
      const staffEntries = storedCase.canonicalHistory.filter((entry) => entry.action === "staff_edit_applied");
      assert.equal(staffEntries.length, 1, "exactly one staff_edit_applied history entry");
      assert.equal(staffEntries[0].changes.edits[0].path, "person.lastName");
      assert.equal(staffEntries[0].changes.edits[0].value, "Johnson");

      const auditCount = await AuditLog.countDocuments({ entityType: "CanonicalProfile", entityId: String(caseDoc._id), action: "CANONICAL_STAFF_EDIT_APPLIED" });
      assert.equal(auditCount, 1, "exactly one canonical staff-edit audit entry - no duplicate canonical mutation");

      assert.equal(received.length, 1, "event emitted exactly once");
      assert.deepEqual(received[0].changedPaths, ["person.lastName"]);
    } finally {
      await cleanup(caseDoc, caseForm);
    }
  });

  await t.test("TEST 2 - repeated-field fan-out: all 3 I-129 lastName fields update, canonical stores the value once", async () => {
    const { caseDoc, caseForm } = await makeCaseAndForm({ lastName: "Smith" });
    try {
      assert.equal(siblingLastNameFieldIds.length, 3, "Phase 0 baseline: person.lastName fans out to exactly 3 I-129 fields");

      const result = await AutoFillService.overrideField(caseDoc._id, FORM_CODE, lastNameFieldId, "Johnson", ACTOR, {}, "fan-out test");

      siblingLastNameFieldIds.forEach((fieldId) => {
        assert.equal(result.fieldValues[fieldId], "Johnson", `expected ${fieldId} to fan out to the new value`);
      });

      const storedCase = await Case.findById(caseDoc._id).lean();
      assert.equal(storedCase.canonicalProfile.profile.person.lastName, "Johnson", "canonical stores the value exactly once, at one path - fan-out only affects PDF fields, never duplicates canonical storage");
    } finally {
      await cleanup(caseDoc, caseForm);
    }
  });

  await t.test("TEST 3 - a derived/composite field (person.fullName, reverseSync:false) must never reverse-sync canonical", async () => {
    const { caseDoc, caseForm } = await makeCaseAndForm({ lastName: "Smith" });
    try {
      const beforeCase = await Case.findById(caseDoc._id).lean();
      const result = await AutoFillService.overrideField(caseDoc._id, FORM_CODE, fullNameFieldId, "John A. Smith", ACTOR, {}, "cm edits full name field");

      assert.equal(result.fieldValues[fullNameFieldId], "John A. Smith", "the PDF/form override itself must still be saved");
      assert.equal(result.sourceAttribution[fullNameFieldId].source, "AttorneyOverride");
      assert.equal(result.sourceAttribution[fullNameFieldId].validationStatus, "manual_override");
      assert.ok(result.manualOverrides[fullNameFieldId], "manualOverrides must record provenance");

      const afterCase = await Case.findById(caseDoc._id).lean();
      assert.deepEqual(afterCase.canonicalProfile.profile, beforeCase.canonicalProfile.profile, "canonical must be byte-identical - no guessed firstName/middleName/lastName decomposition from a composite full-name edit");
      assert.equal(afterCase.canonicalProfile.version, beforeCase.canonicalProfile.version, "no canonical version bump for a non-reverse-sync field");
    } finally {
      await cleanup(caseDoc, caseForm);
    }
  });

  await t.test("TEST 4 - staff-wins conflict: a later conflicting DB update does not silently overwrite the staff correction", async () => {
    const { caseDoc, caseForm } = await makeCaseAndForm({ lastName: "Smith" });
    let beneficiary;
    try {
      const staffResult = await AutoFillService.overrideField(caseDoc._id, FORM_CODE, lastNameFieldId, "Johnson", ACTOR, {}, "staff correction");
      assert.equal(staffResult.fieldValues[lastNameFieldId], "Johnson");

      // Simulate a later external/canonical update via a REAL DB source (a Beneficiary record) -
      // exactly what CanonicalBuilderService.build() reads on the next rebuild. Not a mocked
      // mapping graph or invented field.
      beneficiary = await Beneficiary.create({ firstName: "Ada", lastName: "Brown" });
      await Case.updateOne({ _id: caseDoc._id }, { $set: { beneficiary: beneficiary._id } });

      const rebuilt = await CanonicalProfileService.rebuild(caseDoc._id, ACTOR, {}, { reason: "test_conflicting_rebuild" });

      assert.equal(rebuilt.profile.person.lastName, "Johnson", "staff-wins: the DB's conflicting 'Brown' must NOT silently overwrite the staff correction");
      const conflict = rebuilt.conflicts.find((c) => c.path === "person.lastName");
      assert.ok(conflict, "a pending conflict must be recorded for person.lastName");
      assert.equal(conflict.selectedValue, "Johnson");
      assert.equal(conflict.selectedSource, "staff_override");
      assert.equal(conflict.status, "pending_review");

      // rebuild() only recomputes Case.canonicalProfile - it never touches CaseForm, so the PDF
      // stays exactly as the staff edit left it (Johnson) until someone explicitly regenerates.
      const storedForm = await CaseForm.findById(caseForm._id).lean();
      assert.equal(storedForm.fieldValues[lastNameFieldId], "Johnson", "PDF remains Johnson - conflict is surfaced, not silently resolved in either direction");
    } finally {
      await cleanup(caseDoc, caseForm, beneficiary);
    }
  });

  await t.test("TEST 5 - idempotency: resubmitting the same value is a no-op, no unnecessary fan-out", async () => {
    const { caseDoc, caseForm } = await makeCaseAndForm({ lastName: "Smith" });
    try {
      await AutoFillService.overrideField(caseDoc._id, FORM_CODE, lastNameFieldId, "Johnson", ACTOR, {}, "first edit");
      const afterFirst = await Case.findById(caseDoc._id).lean();
      const formAfterFirst = await CaseForm.findById(caseForm._id).lean();

      const received = [];
      const listener = (payload) => received.push(payload);
      CanonicalProfileService.events.on("staff-edit-applied", listener);
      let secondResult;
      try {
        secondResult = await AutoFillService.overrideField(caseDoc._id, FORM_CODE, lastNameFieldId, "Johnson", ACTOR, {}, "resubmit same value");
      } finally {
        CanonicalProfileService.events.off("staff-edit-applied", listener);
      }

      const afterSecond = await Case.findById(caseDoc._id).lean();
      assert.equal(afterSecond.canonicalProfile.version, afterFirst.canonicalProfile.version, "no version bump on a no-op resubmit");
      assert.equal(afterSecond.canonicalHistory.length, afterFirst.canonicalHistory.length, "no duplicate history entry");
      assert.equal(received.length, 0, "no event emitted for a no-op resubmit");
      assert.equal(secondResult.versionNumber, formAfterFirst.versionNumber, "no unnecessary CaseForm regenerate/version bump - fan-out is skipped when canonical didn't actually change");
    } finally {
      await cleanup(caseDoc, caseForm);
    }
  });

  await t.test("TEST 6 - optimistic concurrency: a stale-based overrideField save is rejected with STALE_FORM_REVISION, never half-applied", async () => {
    const { caseDoc, caseForm } = await makeCaseAndForm({ lastName: "Smith" });
    try {
      // What CM B loaded before CM A's edit landed - see the equivalent, more thoroughly-commented
      // technique in CanonicalProfileService.applyStaffEdit.test.js for why this (not a raw
      // Promise.all race) is the deterministic way to reproduce "loaded stale, saved late".
      const staleSnapshot = await Case.findById(caseDoc._id);
      const staleLean = staleSnapshot.toObject();
      const staleChain = { select: () => staleChain, lean: () => Promise.resolve(staleLean), then: (resolve, reject) => Promise.resolve(staleSnapshot).then(resolve, reject) };

      const winner = await AutoFillService.overrideField(caseDoc._id, FORM_CODE, lastNameFieldId, "WinnerA", ACTOR, {}, "cm-a");
      assert.equal(winner.fieldValues[lastNameFieldId], "WinnerA");

      const originalFindById = Case.findById.bind(Case);
      Case.findById = () => staleChain;
      let loserError;
      try {
        await AutoFillService.overrideField(caseDoc._id, FORM_CODE, lastNameFieldId, "WinnerB", ACTOR, {}, "cm-b");
      } catch (error) {
        loserError = error;
      } finally {
        Case.findById = originalFindById;
      }

      assert.ok(loserError, "CM B's stale-based override should have thrown");
      assert.equal(loserError.code, "STALE_FORM_REVISION");
      assert.equal(loserError.status, 409);

      const storedCase = await Case.findById(caseDoc._id).lean();
      assert.equal(storedCase.canonicalProfile.profile.person.lastName, "WinnerA", "the winner's canonical value must be intact");
      const storedForm = await CaseForm.findById(caseForm._id).lean();
      assert.equal(storedForm.fieldValues[lastNameFieldId], "WinnerA", "CM B's CaseForm write must NOT have applied - canonical write happens BEFORE the CaseForm write, so a stale save never half-applies");
    } finally {
      await cleanup(caseDoc, caseForm);
    }
  });

  await t.test("TEST 7 - a form-only (unmapped) field never triggers a reverse mapping", async () => {
    const { caseDoc, caseForm } = await makeCaseAndForm({ lastName: "Smith" });
    try {
      assert.ok(unmappedFieldId, "expected to find at least one genuinely unmapped I-129 field for this test");
      const beforeCase = await Case.findById(caseDoc._id).lean();

      const result = await AutoFillService.overrideField(caseDoc._id, FORM_CODE, unmappedFieldId, "some barcode override", ACTOR, {}, "cm edits an unmapped field");

      assert.equal(result.fieldValues[unmappedFieldId], "some barcode override");
      assert.equal(result.sourceAttribution[unmappedFieldId].source, "AttorneyOverride");
      assert.ok(result.manualOverrides[unmappedFieldId]);

      const afterCase = await Case.findById(caseDoc._id).lean();
      assert.deepEqual(afterCase.canonicalProfile, beforeCase.canonicalProfile, "canonicalProfile must be completely untouched for a field with no reverse-index hit at all");
    } finally {
      await cleanup(caseDoc, caseForm);
    }
  });

  await t.test("TEST 8 - rebuild durability: a staff edit made via overrideField survives a subsequent full rebuild + regenerate", async () => {
    const { caseDoc, caseForm } = await makeCaseAndForm({ lastName: "Smith" });
    try {
      await AutoFillService.overrideField(caseDoc._id, FORM_CODE, lastNameFieldId, "Johnson", ACTOR, {}, "staff correction");

      const rebuilt = await CanonicalProfileService.rebuild(caseDoc._id, ACTOR, {}, { reason: "test_durability" });
      assert.equal(rebuilt.profile.person.lastName, "Johnson", "staff edit must survive a full rebuild");

      const { caseForm: regenerated } = await AutoFillService.generate(caseDoc._id, FORM_CODE, ACTOR, {}, { regenerate: true });
      siblingLastNameFieldIds.forEach((fieldId) => {
        assert.equal(regenerated.fieldValues[fieldId], "Johnson", `expected ${fieldId} to remain Johnson after rebuild + regenerate`);
      });
    } finally {
      await cleanup(caseDoc, caseForm);
    }
  });

  await t.test("TEST 9 - caller regression: InteractiveFormReviewService.saveField (a real overrideField caller) still works end-to-end", async () => {
    const { caseDoc, caseForm } = await makeCaseAndForm({ lastName: "Smith" });
    try {
      const updated = await InteractiveFormReviewService.saveField(
        caseDoc._id,
        caseForm._id,
        { fieldName: lastNameFieldId, value: "Johnson", reason: "interactive review edit" },
        ACTOR,
        {}
      );

      assert.equal(updated.fieldValues[lastNameFieldId], "Johnson", "saveField's caller-side contract (returns the updated CaseForm) is unchanged");
      assert.equal(updated.status, "under_review", "saveField's own post-override bookkeeping (status transition) is unchanged");

      const storedCase = await Case.findById(caseDoc._id).lean();
      assert.equal(storedCase.canonicalProfile.profile.person.lastName, "Johnson", "the reverse-sync side effect reaches canonical even through this caller, unchanged from overrideField's own behavior");
    } finally {
      await cleanup(caseDoc, caseForm);
    }
  });

  await t.test("TEST 10 - sync state (§I.4): the edited field is MANUAL_OVERRIDE, untouched siblings become SYNCED", async () => {
    const { caseDoc, caseForm } = await makeCaseAndForm({ lastName: "Smith" });
    try {
      const result = await AutoFillService.overrideField(caseDoc._id, FORM_CODE, lastNameFieldId, "Johnson", ACTOR, {}, "sync state test");

      assert.equal(SyncStateService.getSyncState(result, lastNameFieldId), SyncStateService.MANUAL_OVERRIDE, "the field the CM actually edited must be MANUAL_OVERRIDE, not SYNCED");
      siblingLastNameFieldIds.filter((fieldId) => fieldId !== lastNameFieldId).forEach((fieldId) => {
        assert.equal(SyncStateService.getSyncState(result, fieldId), SyncStateService.SYNCED, `sibling ${fieldId} was re-filled from canonical, not manually edited - it must be SYNCED`);
      });
    } finally {
      await cleanup(caseDoc, caseForm);
    }
  });

  await t.test("TEST 11 - sync state (§I.4): fanning out over a sibling that already carries its own manual override raises a CONFLICT instead of overwriting it", async () => {
    const { caseDoc, caseForm } = await makeCaseAndForm({ lastName: "Smith" });
    try {
      const [editedField, preOverriddenSibling] = siblingLastNameFieldIds;
      assert.notEqual(editedField, preOverriddenSibling, "test setup requires at least 2 distinct sibling fields");

      // A pre-existing, independent manual override on a DIFFERENT sibling field on this same
      // form - the realistic origin of this state is cross-form fan-out (§I.5, not yet built) or
      // a pre-Phase-2 override; simulated directly here to test the CONFLICT-marking mechanism
      // itself in isolation, on the one form this phase's scope covers.
      // Mixed-type fields need a fresh object copy + .set() - an in-place bracket mutation of the
      // existing object reference is invisible to Mongoose's change detection (see AutoFillService
      // .overrideField's own comment on this exact pattern).
      caseForm.set("manualOverrides", { [preOverriddenSibling]: { previousValue: "Smith", value: "Anderson", reason: "an earlier independent override", overriddenBy: ACTOR._id, overriddenAt: new Date() } });
      caseForm.set("fieldValues", { ...caseForm.fieldValues, [preOverriddenSibling]: "Anderson" });
      caseForm.set("filledData", { ...caseForm.filledData, [preOverriddenSibling]: "Anderson" });
      await caseForm.save();

      const result = await AutoFillService.overrideField(caseDoc._id, FORM_CODE, editedField, "Johnson", ACTOR, {}, "conflict test");

      assert.equal(SyncStateService.getSyncState(result, editedField), SyncStateService.MANUAL_OVERRIDE);
      assert.equal(SyncStateService.getSyncState(result, preOverriddenSibling), SyncStateService.CONFLICT, "a sibling with its own independent manual override must be marked CONFLICT, not silently resynced");
      assert.equal(result.fieldValues[preOverriddenSibling], "Anderson", "the pre-existing manual override's value must NOT be overwritten by the fan-out");
      assert.equal(result.sourceAttribution[preOverriddenSibling].conflictCanonicalValue, "Johnson");
      assert.equal(result.sourceAttribution[preOverriddenSibling].conflictManualValue, "Anderson");
      assert.ok(result.auditHistory.some((entry) => entry.action === "CONFLICT_DETECTED"), "the conflict must be recorded in auditHistory");

      const untouchedSiblings = siblingLastNameFieldIds.filter((fieldId) => fieldId !== editedField && fieldId !== preOverriddenSibling);
      untouchedSiblings.forEach((fieldId) => {
        assert.equal(SyncStateService.getSyncState(result, fieldId), SyncStateService.SYNCED);
        assert.equal(result.fieldValues[fieldId], "Johnson");
      });
    } finally {
      await cleanup(caseDoc, caseForm);
    }
  });
});
