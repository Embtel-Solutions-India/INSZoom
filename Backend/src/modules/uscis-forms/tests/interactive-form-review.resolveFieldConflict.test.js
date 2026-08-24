// Phase 3 (§I.4) - InteractiveFormReviewService.resolveFieldConflict, against a REAL sync-state
// CONFLICT produced the same way Phase 2's own tests produce one (AutoFillService.overrideField's
// fan-out over a sibling field that already carries its own independent manual override). Runs
// against the local test DB only - never Atlas, never a hand-built mapping graph.
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const InteractiveFormReviewService = require("../interactive-form-review.service");
const AutoFillService = require("../../form-mapping/services/AutoFillService");
const ReverseIndexService = require("../../form-mapping/services/ReverseIndexService");
const FormMappingService = require("../../form-mapping/services/FormMappingService");
const Case = require("../../../models/Case");
const CaseForm = require("../../../models/CaseForm");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");

const ADMIN = { _id: new mongoose.Types.ObjectId(), role: "admin" };
const READ_ONLY_USER = { _id: new mongoose.Types.ObjectId(), role: "client" };
const FORM_CODE = "I-129";

let templateDoc;
let lastNameFieldId;
let siblingLastNameFieldIds;

test.before(async () => {
  await connectTestDB();
  templateDoc = await USCISFormTemplate.findOne({ formCode: FORM_CODE }).select("_id version").lean();
  const template = await FormMappingService.loadTemplate(FORM_CODE);
  lastNameFieldId = template.formFields.find((f) => f.fieldName === "form1[0].#subform[1].Part3_Line2_FamilyName[0]").fieldId;
  const reverseIndex = await ReverseIndexService.buildFormReverseIndex(FORM_CODE);
  siblingLastNameFieldIds = reverseIndex.get("person.lastName").map((entry) => entry.pdfField);
});

test.after(async () => {
  await disconnectTestDB();
});

// Produces a real CONFLICT on `conflictedSibling` by: seeding it with its own independent manual
// override, then editing a DIFFERENT sibling field (which shares the same canonical source) via
// the real overrideField/applyStaffEdit/fan-out path - exactly the mechanism proven in
// AutoFillService.overrideField.reverseSync.test.js's TEST 11.
async function makeConflictedCase() {
  const caseDoc = await Case.create({
    caseNumber: `PHASE3-CONFLICT-${new mongoose.Types.ObjectId().toString()}`,
    visaType: "H-1B",
    status: "active",
    canonicalProfile: { profile: { person: { firstName: "Ada", lastName: "Smith" } }, fieldMetadata: {}, conflicts: [], version: 1, status: "valid", lastBuiltAt: new Date() },
  });
  const filledData = {};
  siblingLastNameFieldIds.forEach((fieldId) => { filledData[fieldId] = "Smith"; });
  const caseForm = await CaseForm.create({
    caseId: caseDoc._id,
    formTemplateId: templateDoc._id,
    formCode: FORM_CODE,
    formVersion: templateDoc.version || "1",
    status: "draft",
    filledData,
    fieldValues: { ...filledData },
    sourceAttribution: {},
    manualOverrides: {},
  });

  const [editedField, conflictedSibling] = siblingLastNameFieldIds;
  caseForm.set("manualOverrides", { [conflictedSibling]: { previousValue: "Smith", value: "Anderson", reason: "prior independent override", overriddenBy: ADMIN._id, overriddenAt: new Date() } });
  caseForm.set("fieldValues", { ...caseForm.fieldValues, [conflictedSibling]: "Anderson" });
  caseForm.set("filledData", { ...caseForm.filledData, [conflictedSibling]: "Anderson" });
  await caseForm.save();

  const result = await AutoFillService.overrideField(caseDoc._id, FORM_CODE, editedField, "Johnson", ADMIN, {}, "conflict setup");
  const conflictSyncState = result.sourceAttribution[conflictedSibling]?.syncState;
  if (conflictSyncState !== "CONFLICT") throw new Error(`test setup failed to produce a CONFLICT (got ${conflictSyncState})`);

  return { caseDoc, caseForm: result, conflictedSibling, editedField };
}

async function cleanup(caseDoc, caseForm) {
  if (caseForm) await CaseForm.deleteOne({ _id: caseForm._id });
  if (caseDoc) await Case.deleteOne({ _id: caseDoc._id });
}

test("resolveFieldConflict suite", async (t) => {
  await t.test("direction: canonical - field value becomes the canonical value, syncState SYNCED, fieldHistory recorded", async () => {
    const { caseDoc, caseForm, conflictedSibling } = await makeConflictedCase();
    try {
      const updated = await InteractiveFormReviewService.resolveFieldConflict(caseDoc._id, caseForm._id, { fieldName: conflictedSibling, direction: "canonical" }, ADMIN, {});

      assert.equal(updated.fieldValues[conflictedSibling], "Johnson", "field value must become the canonical value");
      assert.equal(updated.sourceAttribution[conflictedSibling].syncState, "SYNCED");
      assert.equal(updated.sourceAttribution[conflictedSibling].conflictCanonicalValue, undefined, "conflict markers must be cleared");
      const historyEntry = updated.fieldHistory.find((entry) => entry.fieldName === conflictedSibling && entry.action === "conflict_resolved");
      assert.ok(historyEntry, "expected a conflict_resolved fieldHistory entry");
      assert.equal(historyEntry.metadata.direction, "canonical");
      assert.equal(historyEntry.newValue, "Johnson");

      const storedCase = await Case.findById(caseDoc._id).lean();
      assert.equal(storedCase.canonicalProfile.profile.person.lastName, "Johnson", "canonical already held this value - applyStaffEdit is idempotent here");
    } finally {
      await cleanup(caseDoc, caseForm);
    }
  });

  await t.test("direction: manual - field value unchanged, syncState MANUAL_OVERRIDE, fieldHistory recorded", async () => {
    const { caseDoc, caseForm, conflictedSibling } = await makeConflictedCase();
    try {
      const updated = await InteractiveFormReviewService.resolveFieldConflict(caseDoc._id, caseForm._id, { fieldName: conflictedSibling, direction: "manual" }, ADMIN, {});

      assert.equal(updated.fieldValues[conflictedSibling], "Anderson", "the CM's kept value must not change");
      assert.equal(updated.sourceAttribution[conflictedSibling].syncState, "MANUAL_OVERRIDE");
      const historyEntry = updated.fieldHistory.find((entry) => entry.fieldName === conflictedSibling && entry.action === "conflict_resolved");
      assert.ok(historyEntry);
      assert.equal(historyEntry.metadata.direction, "manual");
      assert.equal(historyEntry.newValue, "Anderson");
    } finally {
      await cleanup(caseDoc, caseForm);
    }
  });

  await t.test("a field that is not in conflict is rejected (409)", async () => {
    const { caseDoc, caseForm, editedField } = await makeConflictedCase();
    try {
      await assert.rejects(
        () => InteractiveFormReviewService.resolveFieldConflict(caseDoc._id, caseForm._id, { fieldName: editedField, direction: "canonical" }, ADMIN, {}),
        (error) => error.status === 409 && /not in conflict/i.test(error.message)
      );
    } finally {
      await cleanup(caseDoc, caseForm);
    }
  });

  await t.test("an unauthorized (read-only) user is rejected (403)", async () => {
    const { caseDoc, caseForm, conflictedSibling } = await makeConflictedCase();
    try {
      await assert.rejects(
        () => InteractiveFormReviewService.resolveFieldConflict(caseDoc._id, caseForm._id, { fieldName: conflictedSibling, direction: "canonical" }, READ_ONLY_USER, {}),
        (error) => error.status === 403
      );
    } finally {
      await cleanup(caseDoc, caseForm);
    }
  });

  await t.test("a locked form is rejected (409)", async () => {
    const { caseDoc, caseForm, conflictedSibling } = await makeConflictedCase();
    try {
      await CaseForm.updateOne({ _id: caseForm._id }, { $set: { isLocked: true } });
      await assert.rejects(
        () => InteractiveFormReviewService.resolveFieldConflict(caseDoc._id, caseForm._id, { fieldName: conflictedSibling, direction: "canonical" }, ADMIN, {}),
        (error) => error.status === 409
      );
    } finally {
      await cleanup(caseDoc, caseForm);
    }
  });

  await t.test("an invalid direction is rejected (400)", async () => {
    const { caseDoc, caseForm, conflictedSibling } = await makeConflictedCase();
    try {
      await assert.rejects(
        () => InteractiveFormReviewService.resolveFieldConflict(caseDoc._id, caseForm._id, { fieldName: conflictedSibling, direction: "bogus" }, ADMIN, {}),
        (error) => error.status === 400
      );
    } finally {
      await cleanup(caseDoc, caseForm);
    }
  });
});
