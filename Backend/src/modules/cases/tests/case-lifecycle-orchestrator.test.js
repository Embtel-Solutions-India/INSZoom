const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");

if (!process.env.MONGODB_TEST_URI) process.env.MONGODB_TEST_URI = "mongodb://localhost:27017/immigrationcrm_test";

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const Case = require("../../../models/Case");
const AuditLog = require("../../../models/AuditLog");
const CaseLifecycleOrchestrator = require("../case-lifecycle-orchestrator.service");
const { templateAppliesToCase } = require("../../uscis-forms/uscis-form.service");

test("case lifecycle calculates the enterprise milestone progression", () => {
  // updated: attorney_review milestone removed from scope (attorney collaboration
  // descoped) — case_manager_review now absorbs its weight (25) and the journey
  // goes straight from case manager review to filed.
  const steps = [
    [{}, 5, "case_assigned"],
    [{ assigned: true }, 15, "questionnaire_completed"],
    [{ assigned: true, questionnaireComplete: true }, 40, "documents_completed"],
    [{ assigned: true, questionnaireComplete: true, documentsComplete: true }, 65, "case_manager_review"],
    [{ assigned: true, questionnaireComplete: true, documentsComplete: true, caseManagerReviewComplete: true }, 90, "filed"],
    [{ assigned: true, questionnaireComplete: true, documentsComplete: true, caseManagerReviewComplete: true, filed: true }, 100, "filed"],
  ];

  steps.forEach(([metrics, expectedPercent, expectedMilestone]) => {
    const progress = CaseLifecycleOrchestrator.calculateProgress(metrics);
    assert.equal(progress.percent, expectedPercent);
    assert.equal(progress.currentMilestone, expectedMilestone);
  });
});

test("case lifecycle derives operational statuses without skipping review", () => {
  assert.deepEqual(CaseLifecycleOrchestrator.deriveOperationalState({}), { status: "pending_assignment", stage: "intake" });
  assert.deepEqual(CaseLifecycleOrchestrator.deriveOperationalState({ assigned: true }), { status: "assigned", stage: "intake" });
  assert.deepEqual(CaseLifecycleOrchestrator.deriveOperationalState({ questionnaireComplete: true }), { status: "document_collection", stage: "evidence" });
  assert.deepEqual(CaseLifecycleOrchestrator.deriveOperationalState({ caseManagerReviewComplete: true }), { status: "under_review", stage: "legal_review" });
  // updated: attorney_review stage removed from scope; forms-generated now maps
  // straight to form_preparation for both status and stage.
  assert.deepEqual(CaseLifecycleOrchestrator.deriveOperationalState({ formsGenerated: true }), { status: "form_preparation", stage: "form_preparation" });
  assert.deepEqual(CaseLifecycleOrchestrator.deriveOperationalState({ pdfGenerated: true }), { status: "ready_to_file", stage: "filing" });
  assert.deepEqual(CaseLifecycleOrchestrator.deriveOperationalState({ filed: true }), { status: "filed", stage: "processing" });
});

test("form assignment is resolved from registry metadata", () => {
  assert.equal(templateAppliesToCase({
    formCode: "I-129",
    status: "active",
    assignmentRules: { visaTypes: ["H-1B"], required: true },
  }, { visaType: "H1B" }), true);
  assert.equal(templateAppliesToCase({
    formCode: "I-140",
    status: "active",
    assignmentRules: { visaTypes: ["EB-2 NIW"], required: true },
  }, { visaType: "H1B" }), false);
});

test("Case stores shared lifecycle progress and specialist ownership", () => {
  // updated: per-specialist-role ownership fields (assignedAttorney,
  // assignedProfessor, assignedFinance, assignedDocumentationSpecialist) were
  // consolidated away — attorney/professor collaboration is descoped, and
  // remaining non-case-manager assignees route through assignedAgentUser.
  assert.ok(Case.schema.path("journeyProgress.percent"));
  assert.ok(Case.schema.path("journeyProgress.milestones"));
  assert.ok(Case.schema.path("assignedCaseManager"));
  assert.ok(Case.schema.path("assignedTeamLead"));
  assert.ok(Case.schema.path("assignedAgentUser"));
  assert.ok(Case.schema.path("petitioner"));
  assert.ok(Case.schema.path("employer"));
  assert.ok(Case.schema.path("organization"));
  assert.ok(Case.schema.path("paymentReferences"));
  assert.ok(Case.schema.statics.lifecycleStages.some((stage) => stage.key === "ready_for_filing"));
});

// Perf fix: get() (backing GET /cases/:id/workflow) must skip the full
// recalculate()/save()/writeAuditLog() cycle when the case was already
// synced within the last 30s, and must still recalculate correctly once
// that window has passed or on a case that's never been synced.
async function makeMinimalCase(overrides = {}) {
  return Case.create({
    caseNumber: `TEST-WF-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    visaType: "H-1B",
    ...overrides,
  });
}

test("get(): within the freshness window, returns cached journeyProgress with no save()/AuditLog write", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const caseData = await makeMinimalCase({
    lastSyncedAt: new Date(Date.now() - 5000),
    journeyProgress: { percent: 42, currentMilestone: "documents_completed", milestones: [], metrics: { assigned: true }, lastCalculatedAt: new Date() },
  });
  try {
    const auditCountBefore = await AuditLog.countDocuments({ entityId: String(caseData._id) });
    const before = await Case.findById(caseData._id).lean();

    const result = await CaseLifecycleOrchestrator.get(String(caseData._id), { _id: new mongoose.Types.ObjectId(), role: "super_admin" }, {});

    const after = await Case.findById(caseData._id).lean();
    const auditCountAfter = await AuditLog.countDocuments({ entityId: String(caseData._id) });

    assert.equal(result.progress.percent, 42, "must return the cached journeyProgress, not a recomputed one");
    assert.deepEqual(after.updatedAt, before.updatedAt, "caseData.save() must not have run - updatedAt unchanged");
    assert.equal(auditCountAfter, auditCountBefore, "no new AuditLog entry from a cache-hit read");
  } finally {
    await Case.deleteOne({ _id: caseData._id });
    await AuditLog.deleteMany({ entityId: String(caseData._id) });
  }
});

test("get(): stale lastSyncedAt (>30s) still triggers a real recalculate() and updates lastSyncedAt", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const caseData = await makeMinimalCase({
    lastSyncedAt: new Date(Date.now() - 60000),
    journeyProgress: { percent: 5, currentMilestone: "case_assigned", milestones: [], metrics: {}, lastCalculatedAt: new Date(Date.now() - 60000) },
  });
  try {
    await CaseLifecycleOrchestrator.get(String(caseData._id), { _id: new mongoose.Types.ObjectId(), role: "super_admin" }, {});
    const after = await Case.findById(caseData._id).lean();
    assert.ok(new Date(after.lastSyncedAt).getTime() > Date.now() - 5000, "lastSyncedAt must be refreshed by a real recalculate()");
  } finally {
    await Case.deleteOne({ _id: caseData._id });
    await AuditLog.deleteMany({ entityId: String(caseData._id) });
  }
});

test("get(): a never-synced case (lastSyncedAt null) always recalculates", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const caseData = await makeMinimalCase();
  try {
    assert.ok(!caseData.lastSyncedAt, "a freshly-created case must have no lastSyncedAt yet");
    const result = await CaseLifecycleOrchestrator.get(String(caseData._id), { _id: new mongoose.Types.ObjectId(), role: "super_admin" }, {});
    const after = await Case.findById(caseData._id).lean();
    assert.ok(after.lastSyncedAt, "a first-ever call must run recalculate() and set lastSyncedAt");
    assert.ok(result.progress, "must return a real, freshly-calculated progress object");
  } finally {
    await Case.deleteOne({ _id: caseData._id });
    await AuditLog.deleteMany({ entityId: String(caseData._id) });
  }
});
