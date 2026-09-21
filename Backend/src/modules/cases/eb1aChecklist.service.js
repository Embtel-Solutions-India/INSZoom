// Computes the criterion-grouped view of an EB-1A case's checklist —
// "X of 10 criteria qualified", never "X documents uploaded". Written as a
// plain function over a criteria config + case-shaped data (no Mongoose
// calls), both so it's unit-testable in isolation and so the same pattern
// could be reused for another criterion-based visa later without EB-1A's
// config being hardcoded into it. Not applied to EB-1B today — see
// config/eb1a.js's header comment.
const eb1a = require("../../config/eb1a");

// A criterion is "satisfied" for threshold purposes ONLY when a staff member
// has explicitly set its status to QUALIFIED via PUT /:id/eb1a-criteria/:id.
// Uploading evidence alone can only ever reach EVIDENCE_UPLOADED — the
// business's explicit "don't auto-qualify on upload count" requirement.
function deriveDisplayStatus(manualStatus, items) {
  if (manualStatus && manualStatus !== "NOT_STARTED") return manualStatus;
  const hasUpload = items.some((item) => (item.uploadedFiles || []).length > 0);
  if (hasUpload) return "EVIDENCE_UPLOADED";
  const hasRequest = items.some((item) => item.status && item.status !== "pending");
  return hasRequest ? "IN_PROGRESS" : "NOT_STARTED";
}

function uploadedDocumentCount(items) {
  return items.reduce((count, item) => count + (item.uploadedFiles || []).length, 0);
}

function buildCriteriaView(caseData, criteriaConfig = eb1a.EB1A_CRITERIA, minRequired = eb1a.MIN_CRITERIA_REQUIRED) {
  const checklistItems = caseData?.checklistItems || [];
  const criteriaStatusEntries = caseData?.criteriaStatus || [];
  const statusByCriterionId = new Map(criteriaStatusEntries.map((entry) => [entry.criterionId, entry]));

  const criteria = criteriaConfig.map((criterion) => {
    const items = checklistItems.filter((item) => item.criterionId === criterion.criterionId);
    const statusEntry = statusByCriterionId.get(criterion.criterionId);
    const status = deriveDisplayStatus(statusEntry?.status, items);
    return {
      criterionId: criterion.criterionId,
      criterionNumber: criterion.number,
      criterionTitle: criterion.title,
      criterionDescription: criterion.description,
      fieldSpecific: Boolean(criterion.fieldSpecific),
      applicability: status === "NOT_APPLICABLE" ? "not_applicable" : "applicable",
      comparableEvidenceAllowed: true,
      evidenceRequirements: criterion.items,
      uploadedDocuments: uploadedDocumentCount(items),
      uploadedDocumentsCount: uploadedDocumentCount(items),
      checklistItemIds: items.map((item) => item._id),
      completionStatus: status,
      comparableEvidenceDescription: statusEntry?.comparableEvidenceDescription || "",
      notes: statusEntry?.reviewerNotes || "",
      markedBy: statusEntry?.markedBy || null,
      markedAt: statusEntry?.markedAt || null,
    };
  });

  // Only QUALIFIED counts toward the threshold — never document/file
  // quantity, never NOT_APPLICABLE or COMPARABLE_EVIDENCE_REVIEW (an
  // unreviewed comparable-evidence claim isn't a qualifying criterion yet;
  // COMPARABLE_EVIDENCE_ACCEPTED does, since that's staff's explicit signoff).
  const qualifyingCriteriaCount = criteria.filter(
    (criterion) => criterion.completionStatus === "QUALIFIED" || criterion.completionStatus === "COMPARABLE_EVIDENCE_ACCEPTED"
  ).length;
  const minimumThresholdReached = qualifyingCriteriaCount >= minRequired;

  return {
    visaType: "EB-1A",
    totalCriteria: criteriaConfig.length,
    minimumCriteria: minRequired,
    qualifyingCriteriaCount,
    minimumThresholdReached,
    criteria,
    finalMerits: {
      status: caseData?.criteriaBasedReview?.finalMeritsReviewStatus || "NOT_STARTED",
      notes: caseData?.criteriaBasedReview?.finalMeritsNotes || "",
    },
  };
}

module.exports = { buildCriteriaView, deriveDisplayStatus, uploadedDocumentCount };
