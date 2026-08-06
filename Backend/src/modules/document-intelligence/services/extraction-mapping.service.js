// This used to re-export a `document-intelligence/autofill/` module that no
// longer exists anywhere in the checkout (no git history either — it's not
// recoverable). notifyUsers is rebuilt below on notification.service.js's
// existing createFromEvent event pattern.
//
// applyExtractionMappings used to project extracted document fields directly
// into Beneficiary/Case/Questionnaire records via the (also-lost)
// config/field-mapping.registry.js and was left a no-op rather than guessed
// at, since writing wrong data into those records is worse than not syncing.
// Phase H2 gives it a real, narrowly-scoped implementation: routing
// masterData-targeted semantic-matcher matches into the EXISTING
// questionnaireData.masterDataPrefill review queue (Case.js) - the same
// structure prefillSummaryForCase/reviewMasterDataField already read/write.
// It never writes masterData directly; a human still accepts/rejects/edits
// via that existing review flow. Answer-targeted matches are handled
// entirely in document-intelligence.service.js (this file only owns the
// masterData suggestion upsert, per the task's own division of concerns).
// Callers that don't pass `options.matches` (the pre-existing
// processDocument/updateFieldReview/approveExtraction/
// overrideExtractionClassification call sites) get the same no-op behavior
// as before - this function only acts when explicitly given matches to
// route, so it stays backward compatible with every existing caller.
const lodash = require("lodash");
const Case = require("../../../models/Case");
const notificationService = require("../../notifications/notification.service");
const participantService = require("../../cases/case-participant.service");

const EVENT_META = {
  google_drive_failed: {
    title: "Document Sync to Google Drive Failed",
    message: "A document's Google Drive sync failed and needs attention.",
  },
  excel_generation_failed: {
    title: "Case Workbook Generation Failed",
    message: "Regenerating a case's Excel workbook failed and needs attention.",
  },
  processing_failed: {
    title: "Document Processing Failed",
    message: "Document intelligence processing failed and needs attention.",
  },
};

async function notifyUsers(extraction, eventName, user, req, metadata = {}) {
  const meta = EVENT_META[eventName] || { title: "Document Intelligence Event", message: `Event: ${eventName}` };
  const context = {
    title: meta.title,
    message: metadata.error ? `${meta.message} (${metadata.error})` : meta.message,
    roles: ["case_manager", "admin"],
    metadata: {
      extractionId: extraction?._id,
      documentId: extraction?.documentId,
      caseId: extraction?.caseId,
      ...metadata,
    },
  };
  try {
    return await notificationService.createFromEvent(`document_intelligence.${eventName}`, context, user, req);
  } catch (error) {
    console.error("extraction-mapping.service: notifyUsers failed to send notification", { eventName, extractionId: extraction?._id, error: error.message });
    return null;
  }
}

async function applyExtractionMappings(extraction, user, req, options = {}) {
  const { caseId, participantId, matches = [] } = options;
  if (!matches.length || !caseId) return [];

  const caseData = await Case.findById(caseId);
  if (!caseData) return [];
  const participant = participantId ? participantService.findParticipant(caseData, { participantId }) : null;
  caseData.questionnaireData = caseData.questionnaireData || {};
  const prefillList = caseData.questionnaireData.masterDataPrefill || [];
  const participantPrefillList = participant ? (participant.canonicalProfile?.masterDataPrefill || []) : null;
  const masterData = participant?.canonicalProfile?.profile || caseData.questionnaireData.masterData || {};

  const items = [];
  for (const match of matches) {
    const targetPrefillList = participantPrefillList || prefillList;
    const existing = targetPrefillList.find((entry) => entry.path === match.targetPath);
    if (existing && existing.status !== "pending") {
      // A human already accepted/rejected/edited this field - that decision
      // stands; never overwrite it or push a duplicate suggestion for the
      // same path (idempotent across repeated uploads of the same document).
      items.push({
        key: match.targetPath, value: match.value, label: match.label,
        confidence: match.combinedConfidence, sourceDocumentType: match.sourceDocumentType,
        targetSystem: "masterData", applied: false, conflict: false,
      });
      continue;
    }
    const entryData = {
      path: match.targetPath,
      value: match.value,
      label: match.label,
      sourceDocumentId: match.sourceDocumentId,
      extractionId: extraction._id,
      confidenceScore: match.combinedConfidence,
      status: "pending",
      existingValue: lodash.get(masterData, match.targetPath),
      extractedAt: new Date(),
    };
    if (existing) Object.assign(existing, entryData);
    else targetPrefillList.push({ ...entryData, participantId });
    items.push({
      key: match.targetPath, value: match.value, label: match.label,
      confidence: match.combinedConfidence, sourceDocumentType: match.sourceDocumentType,
      targetSystem: "masterData", applied: false, conflict: false,
    });
  }
  caseData.questionnaireData.masterDataPrefill = prefillList;
  if (participant) {
    participant.canonicalProfile = {
      ...(participant.canonicalProfile?.toObject?.() || participant.canonicalProfile || {}),
      profile: participant.canonicalProfile?.profile || {},
      masterDataPrefill: participantPrefillList,
      lastPrefillAt: new Date(),
    };
  }
  caseData.markModified("questionnaireData.masterDataPrefill");
  if (participant) caseData.markModified("participants");
  await caseData.save();
  return items;
}

// Highest-rank-wins order for a resume's education[] array - NOT chronological
// (a beneficiary's doctorate from 2005 outranks a bachelor's from 2020; date
// order alone would pick the wrong entry). Mirrors the I-129 H-1B Data
// Collection Supplement's own Item 2 checkbox set exactly (see
// i129-h1b-crosswalk.js's MAPPED_EDGES and resume-extraction.schema.js's
// DEGREE_TYPES) - lowest rank first so `indexOf` doubles as the rank number.
const EDUCATION_LEVEL_RANK = [
  "no_diploma",
  "high_school",
  "some_college",
  "college_no_degree",
  "associates",
  "bachelors",
  "masters",
  "professional",
  "doctorate",
];

function educationLevelRank(degreeType) {
  return EDUCATION_LEVEL_RANK.indexOf(degreeType);
}

// field-mapping.registry.js's FIELD_MAPPINGS.resume comment documents this
// function's contract: a resume's "education" field is an ARRAY (no single
// questionnaire question can accept it as-is), so the granular checklist
// questions (employee_education_highestLevel, etc.) are instead filled from
// ONE projected "primary" entry - the highest-ranked degree across the whole
// array, not the most recently dated one. Returns extra field-extraction-
// shaped entries {key, value, confidence} for document-intelligence.service.js's
// applyQuestionnairePrefill to fold into the fields it matches/writes -
// never mutates the caller's array and never touches the DB itself (that
// stays the job of applyExtractionMappings/applyAnswerMatches, so the
// human-review boundary for masterData targets is unaffected by this
// derivation step).
function deriveEducationScalarFields(fields = []) {
  const educationField = (fields || []).find((field) => field.key === "education");
  const entries = Array.isArray(educationField?.value) ? educationField.value : [];
  if (!entries.length) return [];

  let primary = null;
  let bestRank = -1;
  entries.forEach((entry) => {
    const rank = educationLevelRank(entry?.degreeType);
    if (rank > bestRank) {
      bestRank = rank;
      primary = entry;
    }
  });
  // Every entry had an unrecognized/missing degreeType - nothing rankable,
  // so there's no defensible "primary" entry to project from.
  if (!primary) return [];

  const confidence = Math.max(0, Math.min(100, Number(primary.confidence) || Number(educationField.confidence) || 0));
  const derived = [];
  // educationDegreeType and educationHighestLevel both project the SAME
  // enum token deliberately: a resume extraction only ever yields the one
  // ranked degreeType signal (no separate free-text "type of degree"
  // field exists on the resume schema), so there is no second, more
  // specific value to give educationDegreeType instead.
  if (primary.degreeType) {
    derived.push({ key: "educationDegreeType", value: primary.degreeType, confidence });
    derived.push({ key: "educationHighestLevel", value: primary.degreeType, confidence });
  }
  if (primary.major) derived.push({ key: "educationMajorFieldOfStudy", value: primary.major, confidence });
  if (primary.institution) derived.push({ key: "educationInstitutionName", value: primary.institution, confidence });
  if (primary.awardDate) derived.push({ key: "educationDegreeAwardDate", value: primary.awardDate, confidence });
  return derived;
}

module.exports = { notifyUsers, applyExtractionMappings, deriveEducationScalarFields, EDUCATION_LEVEL_RANK };
