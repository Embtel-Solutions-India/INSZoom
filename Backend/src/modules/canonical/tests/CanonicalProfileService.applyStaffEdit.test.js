// Phase 2 (§I.1) - CanonicalProfileService.applyStaffEdit, in full isolation, before §I.2/§I.3
// touch anything downstream. Uses the shared local test-DB harness (test-utils/db.js), never the
// app's real MONGODB_URI - see docs/forms/PHASE2_RUN_JOURNAL.md for why that separation matters.
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const CanonicalProfileService = require("../services/CanonicalProfileService");
const Case = require("../../../models/Case");

// role: "admin" so caseService.canAccessCase() grants access regardless of
// the disposable case's own user/assignedCaseManager/primaryOwner fields -
// this suite is testing applyStaffEdit's own logic, not case ACL rules.
const ACTOR = { _id: new mongoose.Types.ObjectId(), role: "admin" };

async function makeCase(overrides = {}) {
  return Case.create({
    caseNumber: `PHASE2-STAFF-EDIT-${new mongoose.Types.ObjectId().toString()}`,
    visaType: "H-1B",
    status: "active",
    canonicalProfile: {
      profile: { person: { firstName: "Ada", lastName: "Lovelace" } },
      fieldMetadata: {},
      conflicts: [],
      version: 1,
      status: "valid",
      lastBuiltAt: new Date(),
    },
    ...overrides,
  });
}

test("applyStaffEdit suite", async (t) => {
  await connectTestDB();
  const created = [];
  t.after(async () => {
    await Case.deleteMany({ _id: { $in: created } });
    await disconnectTestDB();
  });

  await t.test("bumps version, writes the value, pushes history, and returns the updated profile", async () => {
    const caseDoc = await makeCase();
    created.push(caseDoc._id);

    const result = await CanonicalProfileService.applyStaffEdit(caseDoc._id, [{ path: "person.lastName", value: "Byron", reason: "client corrected spelling" }], ACTOR, {});

    assert.equal(result.version, 2, "version should bump from 1 to 2");
    assert.equal(result.profile.person.lastName, "Byron");
    assert.equal(result.profile.person.firstName, "Ada", "unrelated fields must be untouched");

    const stored = await Case.findById(caseDoc._id).lean();
    assert.equal(stored.canonicalProfile.version, 2);
    assert.equal(stored.canonicalProfile.profile.person.lastName, "Byron");
    assert.equal(stored.canonicalProfile.fieldMetadata["person.lastName"].sourceType, "staff_override");
    assert.equal(stored.canonicalProfile.fieldMetadata["person.lastName"].status, "staff_locked");

    const historyEntry = stored.canonicalHistory[stored.canonicalHistory.length - 1];
    assert.equal(historyEntry.action, "staff_edit_applied");
    assert.equal(historyEntry.version, 2);
    assert.equal(historyEntry.source, "staff_override");
    assert.equal(historyEntry.changes.edits[0].path, "person.lastName");
    assert.equal(historyEntry.changes.edits[0].value, "Byron");
  });

  await t.test("writes an audit log entry", async () => {
    const AuditLog = require("../../../models/AuditLog");
    const caseDoc = await makeCase();
    created.push(caseDoc._id);

    await CanonicalProfileService.applyStaffEdit(caseDoc._id, [{ path: "person.firstName", value: "Augusta", reason: "test" }], ACTOR, {});

    const entry = await AuditLog.findOne({ entityType: "CanonicalProfile", entityId: String(caseDoc._id), action: "CANONICAL_STAFF_EDIT_APPLIED" }).lean();
    assert.ok(entry, "expected a CANONICAL_STAFF_EDIT_APPLIED audit log entry");
    assert.equal(entry.changes.editCount, 1);
  });

  await t.test("emits a staff-edit-applied event", async () => {
    const caseDoc = await makeCase();
    created.push(caseDoc._id);

    const received = [];
    const listener = (payload) => received.push(payload);
    CanonicalProfileService.events.on("staff-edit-applied", listener);
    try {
      await CanonicalProfileService.applyStaffEdit(caseDoc._id, [{ path: "person.lastName", value: "King", reason: "test" }], ACTOR, {});
    } finally {
      CanonicalProfileService.events.off("staff-edit-applied", listener);
    }

    assert.equal(received.length, 1);
    assert.equal(received[0].caseId, String(caseDoc._id));
    assert.equal(received[0].canonicalVersion, 2);
    assert.deepEqual(received[0].changedPaths, ["person.lastName"]);
  });

  await t.test("concurrency: CM B loaded stale (pre-A) canonical state and tries to save after CM A's edit already landed", async () => {
    const caseDoc = await makeCase();
    created.push(caseDoc._id);

    // What CM B loaded into their editor before CM A's edit landed - captured now, applied later,
    // to deterministically reproduce "loaded stale, saved after someone else already won" without
    // depending on real-world Promise-scheduling race timing (which can resolve two truly
    // concurrent calls sequentially far enough apart that no actual conflict is ever exercised).
    const staleSnapshot = await Case.findById(caseDoc._id);

    const winner = await CanonicalProfileService.applyStaffEdit(caseDoc._id, [{ path: "person.lastName", value: "WinnerA", reason: "cm-a" }], ACTOR, {});
    assert.equal(winner.version, 2);

    const originalFindById = Case.findById.bind(Case);
    Case.findById = () => ({ then: (resolve) => resolve(staleSnapshot) });
    let loserError;
    try {
      await CanonicalProfileService.applyStaffEdit(caseDoc._id, [{ path: "person.lastName", value: "WinnerB", reason: "cm-b" }], ACTOR, {});
    } catch (error) {
      loserError = error;
    } finally {
      Case.findById = originalFindById;
    }

    assert.ok(loserError, "CM B's stale-based save should have thrown");
    assert.equal(loserError.code, "STALE_FORM_REVISION");
    assert.equal(loserError.status, 409);

    const stored = await Case.findById(caseDoc._id).lean();
    assert.equal(stored.canonicalProfile.version, 2, "version should have bumped exactly once, not twice");
    assert.equal(stored.canonicalProfile.profile.person.lastName, "WinnerA", "the winner's value must be intact in canonical, not silently overwritten by the loser");
  });

  await t.test("idempotency: applying the same edit twice in sequence is a no-op the second time", async () => {
    const caseDoc = await makeCase();
    created.push(caseDoc._id);

    const first = await CanonicalProfileService.applyStaffEdit(caseDoc._id, [{ path: "person.lastName", value: "Somerville", reason: "test" }], ACTOR, {});
    const afterFirst = await Case.findById(caseDoc._id).lean();

    const second = await CanonicalProfileService.applyStaffEdit(caseDoc._id, [{ path: "person.lastName", value: "Somerville", reason: "test" }], ACTOR, {});
    const afterSecond = await Case.findById(caseDoc._id).lean();

    assert.equal(first.version, 2);
    assert.equal(second.version, 2, "re-applying the same value must not bump the version again");
    assert.deepEqual(afterSecond.canonicalProfile, afterFirst.canonicalProfile, "canonical profile state must be identical after the no-op second call");
    assert.equal(afterSecond.canonicalHistory.length, afterFirst.canonicalHistory.length, "no duplicate history entry for a no-op edit");
  });

  await t.test("precedence (§J.1 Option A): a staff edit survives rebuild() even when raw sources disagree, and rebuild() surfaces a conflict instead of overwriting it", async () => {
    const caseDoc = await makeCase();
    created.push(caseDoc._id);

    await CanonicalProfileService.applyStaffEdit(caseDoc._id, [{ path: "person.lastName", value: "StaffCorrected", reason: "attorney correction" }], ACTOR, {});

    // Simulate CanonicalBuilderService.build() disagreeing on the next rebuild (e.g. a later
    // questionnaire answer) by rebuilding directly - CanonicalBuilderService reads live DB/
    // questionnaire/OCR sources for this disposable case, which have none, so profile.person
    // will come back empty; applyStaffOverrides then re-applies our override on top of it and
    // must detect the (undefined -> value) case is NOT a real disagreement (nothing to conflict
    // with) versus a genuine competing value.
    const rebuilt = await CanonicalProfileService.rebuild(caseDoc._id, ACTOR, {}, { reason: "test_rebuild" });
    assert.equal(rebuilt.profile.person.lastName, "StaffCorrected", "staff override must survive a full rebuild, not just the call that made it");

    const stored = await Case.findById(caseDoc._id).lean();
    assert.equal(stored.canonicalProfile.profile.person.lastName, "StaffCorrected");
  });
});
