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

// A passport prints one "place of birth" string ("MUMBAI, MAHARASHTRA" or
// "TORONTO, CANADA") and no separate country of birth. Split it into the two
// checklist fields: country of birth - ONLY when the last part is a
// recognised country name (never guessed: "MAHARASHTRA" is a state) - and
// province/state of birth (everything before the country, or the whole
// string when no country is recognised).
const COUNTRY_ALIASES = {
  USA: "United States", "U.S.A.": "United States", "U.S.": "United States", US: "United States",
  "UNITED STATES OF AMERICA": "United States", UK: "United Kingdom", "U.K.": "United Kingdom",
  UAE: "United Arab Emirates", "SOUTH KOREA": "South Korea", "REPUBLIC OF KOREA": "South Korea",
};
let countryNames = null;
function knownCountryNames() {
  if (countryNames) return countryNames;
  countryNames = new Map();
  try {
    const display = new Intl.DisplayNames(["en"], { type: "region" });
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        const name = display.of(code);
        if (name && name !== code) countryNames.set(name.toUpperCase(), name);
      }
    }
  } catch (error) {
    // Intl region names unavailable: only the aliases below will match.
  }
  return countryNames;
}

function derivePassportScalarFields(fields = []) {
  const place = (fields || []).find((field) => field.key === "placeOfBirth");
  const raw = typeof place?.value === "string" ? place.value.trim() : "";
  if (!raw) return [];
  const confidence = Math.max(0, Math.min(100, Number(place.confidence) || 0));
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  const last = (parts[parts.length - 1] || "").toUpperCase();
  const country = COUNTRY_ALIASES[last] || knownCountryNames().get(last) || null;
  const derived = [];
  if (country && parts.length > 1) {
    derived.push({ key: "countryOfBirth", value: country, confidence });
    derived.push({ key: "placeOfBirthState", value: parts.slice(0, -1).join(", "), confidence });
  } else {
    derived.push({ key: "placeOfBirthState", value: raw, confidence });
  }
  return derived;
}

// ── PERM "Employment History" (a repeating group on the employee checklist) from a resume ───────────────────────
// A resume's `employment` field is an array of { employer, title, startDate, endDate, current, duties }. Each entry
// becomes one row of the checklist's repeating group (column keys from permChecklists.js HISTORY_COLUMNS):
//   employer -> company_name, title -> job_title, startDate/endDate -> start_date/end_date (+ is_current),
//   duties -> job_details. A resume carries no supervisor, street address, hours per week or business type, so those
// columns are left blank for the employee (or case manager) to complete - never guessed. The resume's skills list is
// not tied to any one job, so it goes on the most recent one only; every value stays editable.
function permHistoryDate(value) {
  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}-\d{2}$/.test(text)) return `${text}-01`;
  if (/^\d{4}$/.test(text)) return `${text}-01-01`;
  return "";
}

function derivePermResumeFields(fields = []) {
  const employmentField = (fields || []).find((field) => field.key === "employment");
  const entries = Array.isArray(employmentField?.value) ? employmentField.value : [];
  if (!entries.length) return [];
  const skillsField = (fields || []).find((field) => field.key === "skills");
  const skills = Array.isArray(skillsField?.value) ? skillsField.value.map((item) => String(item).trim()).filter(Boolean) : [];

  const rows = entries
    .filter((entry) => entry && (String(entry.employer || "").trim() || String(entry.title || "").trim()))
    .map((entry) => {
      const current = entry.current === true || /^(present|current|now|ongoing)$/i.test(String(entry.endDate || "").trim());
      const row = {
        company_name: String(entry.employer || "").trim(),
        job_title: String(entry.title || "").trim(),
        start_date: permHistoryDate(entry.startDate),
        is_current: current,
        job_details: String(entry.duties || "").trim(),
      };
      if (!current) row.end_date = permHistoryDate(entry.endDate);
      return row;
    });
  if (!rows.length) return [];
  // most recent first (the checklist asks to start with the current / latest job)
  rows.sort((a, b) => (Number(b.is_current) - Number(a.is_current)) || String(b.start_date).localeCompare(String(a.start_date)));
  if (skills.length) rows[0].skills_tools = skills.join(", ");
  const confidence = Math.max(0, Math.min(100, Number(employmentField.confidence) || 0));
  return [{ key: "permEmploymentHistory", value: rows, confidence }];
}

module.exports = { notifyUsers, applyExtractionMappings, deriveEducationScalarFields, derivePassportScalarFields, derivePermResumeFields, EDUCATION_LEVEL_RANK };
