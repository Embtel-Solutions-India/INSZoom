const assert = require("node:assert/strict");
const { test } = require("node:test");
const { buildCriteriaView } = require("../eb1aChecklist.service");
const { EB1A_CRITERIA, MIN_CRITERIA_REQUIRED } = require("../../../config/eb1a");

function item(criterionId, overrides = {}) {
  return { criterionId, uploadedFiles: [], status: "pending", ...overrides };
}

function caseWith(checklistItems, criteriaStatus = []) {
  return { checklistItems, criteriaStatus };
}

test("uploading multiple documents under one criterion does not count as multiple qualifying criteria", () => {
  const caseData = caseWith([
    item("EB1A_CRITERION_1", { uploadedFiles: [{}] }),
    item("EB1A_CRITERION_1", { uploadedFiles: [{}] }),
    item("EB1A_CRITERION_1", { uploadedFiles: [{}] }),
  ]);
  const view = buildCriteriaView(caseData);
  const criterion1 = view.criteria.find((c) => c.criterionId === "EB1A_CRITERION_1");
  assert.equal(criterion1.completionStatus, "EVIDENCE_UPLOADED");
  assert.equal(view.qualifyingCriteriaCount, 0);
});

test("qualifying 3 criteria reaches the minimum threshold", () => {
  const caseData = caseWith(
    [item("EB1A_CRITERION_1"), item("EB1A_CRITERION_2"), item("EB1A_CRITERION_3")],
    [
      { criterionId: "EB1A_CRITERION_1", status: "QUALIFIED" },
      { criterionId: "EB1A_CRITERION_2", status: "QUALIFIED" },
      { criterionId: "EB1A_CRITERION_3", status: "QUALIFIED" },
    ]
  );
  const view = buildCriteriaView(caseData);
  assert.equal(view.qualifyingCriteriaCount, 3);
  assert.equal(view.minimumThresholdReached, true);
});

test("qualifying 5 criteria still counts all 5 — threshold does not cap the count", () => {
  const criteriaStatus = [1, 2, 3, 4, 5].map((n) => ({ criterionId: `EB1A_CRITERION_${n}`, status: "QUALIFIED" }));
  const checklistItems = [1, 2, 3, 4, 5].map((n) => item(`EB1A_CRITERION_${n}`));
  const view = buildCriteriaView(caseWith(checklistItems, criteriaStatus));
  assert.equal(view.qualifyingCriteriaCount, 5);
  assert.equal(view.minimumThresholdReached, true);
});

test("documents uploaded with no criterion marked qualified yields zero qualifying criteria", () => {
  const checklistItems = EB1A_CRITERIA.map((c) => item(c.criterionId, { uploadedFiles: [{}] }));
  const view = buildCriteriaView(caseWith(checklistItems));
  assert.equal(view.qualifyingCriteriaCount, 0);
  assert.equal(view.minimumThresholdReached, false);
});

test("NOT_APPLICABLE criteria (e.g. #9/#10) never count toward the threshold", () => {
  const caseData = caseWith(
    [item("EB1A_CRITERION_9"), item("EB1A_CRITERION_10")],
    [
      { criterionId: "EB1A_CRITERION_9", status: "NOT_APPLICABLE" },
      { criterionId: "EB1A_CRITERION_10", status: "NOT_APPLICABLE" },
    ]
  );
  const view = buildCriteriaView(caseData);
  assert.equal(view.qualifyingCriteriaCount, 0);
  const c9 = view.criteria.find((c) => c.criterionId === "EB1A_CRITERION_9");
  assert.equal(c9.applicability, "not_applicable");
});

test("comparable evidence stays under review and does not auto-count until accepted", () => {
  const caseData = caseWith(
    [item("EB1A_CRITERION_4")],
    [{ criterionId: "EB1A_CRITERION_4", status: "COMPARABLE_EVIDENCE_REVIEW", comparableEvidenceDescription: "N/A field substitute" }]
  );
  const view = buildCriteriaView(caseData);
  assert.equal(view.qualifyingCriteriaCount, 0);
  const c4 = view.criteria.find((c) => c.criterionId === "EB1A_CRITERION_4");
  assert.equal(c4.completionStatus, "COMPARABLE_EVIDENCE_REVIEW");

  const accepted = caseWith(
    [item("EB1A_CRITERION_4")],
    [{ criterionId: "EB1A_CRITERION_4", status: "COMPARABLE_EVIDENCE_ACCEPTED" }]
  );
  assert.equal(buildCriteriaView(accepted).qualifyingCriteriaCount, 1);
});

test("the same document (shared checklist item reference) can support two criteria independently", () => {
  const sharedFile = { document: "doc-1" };
  const caseData = caseWith(
    [item("EB1A_CRITERION_5", { uploadedFiles: [sharedFile] }), item("EB1A_CRITERION_7", { uploadedFiles: [sharedFile] })],
    [
      { criterionId: "EB1A_CRITERION_5", status: "QUALIFIED" },
      { criterionId: "EB1A_CRITERION_7", status: "QUALIFIED" },
    ]
  );
  const view = buildCriteriaView(caseData);
  assert.equal(view.qualifyingCriteriaCount, 2);
});

test("removing the qualifying evidence's manual status un-qualifies the criterion", () => {
  const withStatus = buildCriteriaView(caseWith([item("EB1A_CRITERION_2", { uploadedFiles: [{}] })], [{ criterionId: "EB1A_CRITERION_2", status: "QUALIFIED" }]));
  assert.equal(withStatus.qualifyingCriteriaCount, 1);
  const withoutStatus = buildCriteriaView(caseWith([item("EB1A_CRITERION_2", { uploadedFiles: [] })], []));
  assert.equal(withoutStatus.qualifyingCriteriaCount, 0);
});

test("reaching the minimum threshold leaves all 10 criteria present and open for further evidence", () => {
  const criteriaStatus = [1, 2, 3].map((n) => ({ criterionId: `EB1A_CRITERION_${n}`, status: "QUALIFIED" }));
  const view = buildCriteriaView(caseWith([], criteriaStatus));
  assert.equal(view.criteria.length, 10);
  assert.equal(view.totalCriteria, 10);
});

test("minimum threshold is 3, never conflated with case approval", () => {
  assert.equal(MIN_CRITERIA_REQUIRED, 3);
  const view = buildCriteriaView(caseWith([], []));
  assert.equal(view.finalMerits.status, "NOT_STARTED");
});
