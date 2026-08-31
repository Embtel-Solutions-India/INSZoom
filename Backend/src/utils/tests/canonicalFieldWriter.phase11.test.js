const assert = require("node:assert/strict");
const test = require("node:test");
const EmployerProfile = require("../../models/EmployerProfile");
const {
  buildCanonicalUpdate,
  resolveCanonicalWriteSource,
} = require("../canonicalFieldWriter");

test("Phase 11 canonical writer records full provenance and history", () => {
  const now = new Date("2026-08-28T00:00:00Z");
  const result = buildCanonicalUpdate({
    Model: EmployerProfile,
    existingDoc: null,
    fields: { legalName: "Acme Inc." },
    source: "questionnaire",
    userId: "user-1",
    now,
    sourceId: "answer-1",
    sourceFields: { legalName: "employer.legalName" },
    profileOwner: "employer",
    caseScope: { principalCaseId: "case-1" },
    changeId: "submit-1",
  });

  assert.equal(result.setOps["canonicalData.legalName.value"], "Acme Inc.");
  assert.equal(result.setOps["canonicalData.legalName.sourceId"], "answer-1");
  assert.equal(result.setOps["canonicalData.legalName.sourceField"], "employer.legalName");
  assert.equal(result.setOps["canonicalData.legalName.profileOwner"], "employer");
  assert.deepEqual(result.setOps["canonicalData.legalName.caseScope"], { principalCaseId: "case-1" });
  assert.equal(result.incOps["canonicalData.legalName.revision"], 1);
  assert.equal(result.pushOps["canonicalData.legalName.history"].$each[0].revision, 1);
});

test("Phase 11 canonical writer blocks non-staff overwrite of locked or staff-owned fields", () => {
  const existingDoc = {
    canonicalData: {
      legalName: {
        value: "Staff Value",
        source: "case_manager_edit",
        locked: true,
        revision: 3,
      },
    },
  };
  const result = buildCanonicalUpdate({
    Model: EmployerProfile,
    existingDoc,
    fields: { legalName: "Client Value" },
    source: "questionnaire",
    userId: "client-1",
  });

  assert.deepEqual(result.applied, []);
  assert.deepEqual(result.conflicted, ["legalName"]);
  assert.equal(result.setOps["canonicalData.legalName.value"], undefined);
  assert.equal(result.setOps["canonicalData.legalName.conflictPending"].conflictValue, "Client Value");
  assert.equal(result.setOps["canonicalData.legalName.conflictPending"].conflictReason, "locked_field");
});

test("Phase 11 canonical writer detects stale revisions", () => {
  const existingDoc = { canonicalData: { legalName: { value: "Current", source: "questionnaire", revision: 2 } } };
  const result = buildCanonicalUpdate({
    Model: EmployerProfile,
    existingDoc,
    fields: { legalName: "Attempted" },
    source: "questionnaire",
    userId: "client-1",
    expectedRevisions: { legalName: 1 },
  });

  assert.deepEqual(result.conflicted, ["legalName"]);
  assert.equal(result.setOps["canonicalData.legalName.value"], undefined);
  assert.equal(result.setOps["canonicalData.legalName.conflictPending"].conflictReason, "stale_revision");
});

test("Phase 11 canonical writer treats duplicate changeId as idempotent", () => {
  const existingDoc = {
    canonicalData: {
      legalName: {
        value: "Acme Inc.",
        source: "questionnaire",
        revision: 5,
        lastChangeId: "submit-1:legalName",
      },
    },
  };
  const result = buildCanonicalUpdate({
    Model: EmployerProfile,
    existingDoc,
    fields: { legalName: "Acme Inc." },
    source: "questionnaire",
    userId: "client-1",
    changeId: "submit-1",
  });

  assert.deepEqual(result.applied, ["legalName"]);
  assert.deepEqual(result.incOps, {});
  assert.deepEqual(result.pushOps, {});
});

test("Phase 11 source resolver refuses client-spoofed authoritative sources", () => {
  assert.equal(resolveCanonicalWriteSource({ role: "client" }, "case_manager_edit"), "questionnaire");
  assert.equal(resolveCanonicalWriteSource({ role: "case_manager" }, "form_edit"), "form_edit");
});
