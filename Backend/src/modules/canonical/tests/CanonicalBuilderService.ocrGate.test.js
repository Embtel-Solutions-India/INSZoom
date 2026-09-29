const assert = require("node:assert/strict");
const test = require("node:test");
const CanonicalBuilderService = require("../services/CanonicalBuilderService");
const CanonicalMergeService = require("../services/CanonicalMergeService");

// Phase 3C/3D: OCR -> canonical wiring. These are the field-level gating
// rules addOcrCandidates now applies before an extracted value is even
// pushed as a merge candidate - no DB required, since addOcrCandidates only
// ever needs the extractions array shape (a plain object mirroring
// DocumentExtraction.extractedData), matching the DB-free style already
// used by CanonicalBuilderService.test.js in this same directory.

function extractionWith(field) {
  return {
    _id: "extraction-1",
    documentId: "document-1",
    documentType: "passport",
    confidence: 90,
    reviewStatus: "auto_accepted",
    extractedData: [
      {
        key: "firstName",
        value: "Ada",
        ...field,
      },
    ],
  };
}

test("addOcrCandidates/addDocumentExtractionCandidates: a high-confidence, unreviewed field (auto_accepted, no validationIssues) DOES reach canonical", () => {
  const extraction = extractionWith({ reviewStatus: "auto_accepted", confidenceScore: 96, validationIssues: [] });
  const candidates = [];
  CanonicalBuilderService.addDocumentExtractionCandidates(candidates, [extraction]);
  assert.equal(candidates.length, 1, "an auto_accepted field with no validation issues must be pushed as a candidate");
  assert.equal(candidates[0].path, "person.firstName");
  assert.equal(candidates[0].sourceType, "ocr");
  assert.equal(candidates[0].sourceId, "extraction-1");
  assert.equal(candidates[0].sourceDocumentId, "document-1");

  const merged = CanonicalMergeService.merge(candidates);
  assert.equal(merged.profile.person.firstName, "Ada");
  assert.equal(merged.fieldMetadata["person.firstName"].sourceType, "ocr");
  assert.equal(merged.fieldMetadata["person.firstName"].sourceId, "extraction-1");
});

test("addOcrCandidates: a low-confidence, unreviewed field (needs_review/manual_review) does NOT reach canonical", () => {
  const lowConfidenceExtraction = extractionWith({ reviewStatus: "manual_review", confidenceScore: 40 });
  const needsReviewExtraction = extractionWith({ reviewStatus: "needs_review", confidenceScore: 85 });
  const candidates = [];
  CanonicalBuilderService.addOcrCandidates(candidates, [lowConfidenceExtraction, needsReviewExtraction]);
  assert.equal(candidates.length, 0, "neither manual_review nor needs_review fields should ever be pushed as canonical candidates");
});

test("addOcrCandidates: a flagged field (validationIssues present) does NOT reach canonical even at auto_accepted confidence, unless a human has reviewed it", () => {
  const flaggedUnreviewed = extractionWith({ reviewStatus: "auto_accepted", confidenceScore: 97, validationIssues: ["Passport expiration date is in the past"] });
  const candidates = [];
  CanonicalBuilderService.addOcrCandidates(candidates, [flaggedUnreviewed]);
  assert.equal(candidates.length, 0, "a flagged field must land in needs-review, not canonical, until a human confirms it");

  const flaggedButHumanReviewed = extractionWith({
    reviewStatus: "approved",
    confidenceScore: 97,
    validationIssues: ["Passport expiration date is in the past"],
    reviewedBy: "case-manager-1",
    reviewedAt: new Date(),
  });
  const reviewedCandidates = [];
  CanonicalBuilderService.addOcrCandidates(reviewedCandidates, [flaggedButHumanReviewed]);
  assert.equal(reviewedCandidates.length, 1, "once a human has reviewed/approved a flagged field, it should reach canonical");
  assert.equal(reviewedCandidates[0].verifiedBy, "case-manager-1");
});

test("addOcrCandidates: a human-edited field (editedValue + reviewStatus edited) reaches canonical using the edited value, even below auto_accepted confidence", () => {
  const humanEdited = extractionWith({
    reviewStatus: "edited",
    confidenceScore: 55,
    value: "Ada (raw OCR misread)",
    editedValue: "Ada",
    editedBy: "case-manager-1",
    editedAt: new Date(),
  });
  const candidates = [];
  CanonicalBuilderService.addOcrCandidates(candidates, [humanEdited]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].value, "Ada", "the human-edited value must win over the raw OCR value once reviewed");
});

test("addOcrCandidates: a case-manager-verified canonical value (case_manager_verified, priority 500) still outranks a same-path OCR candidate (priority 350/450) at merge time", () => {
  const ocrExtraction = extractionWith({ reviewStatus: "auto_accepted", confidenceScore: 99 });
  const candidates = [];
  CanonicalBuilderService.addOcrCandidates(candidates, [ocrExtraction]);
  candidates.push({
    path: "person.firstName",
    value: "Adaline",
    // Mirrors addProfileCandidates' own profileSourceType() output for an
    // EmployerProfile/EmployeeProfile field whose source is
    // "case_manager_edit"/"form_edit" - see CanonicalBuilderService.js.
    sourceType: "case_manager_verified",
    source: "EmployeeProfile",
    sourceId: "profile-1",
    confidence: 100,
    verificationStatus: "case_manager_verified",
    collectedAt: new Date(),
  });

  const merged = CanonicalMergeService.merge(candidates);
  assert.equal(merged.profile.person.firstName, "Adaline", "a case-manager override must win over OCR regardless of OCR confidence");
  assert.equal(merged.fieldMetadata["person.firstName"].sourceType, "case_manager_verified");
});
