const lodash = require("lodash");
const Answer = require("../../../models/Answer");
const Case = require("../../../models/Case");
const Document = require("../../../models/Document");
const documentService = require("../../documents/document.service");
const caseService = require("../../cases/case.service");
const questionnaireService = require("../../questionnaires/questionnaire.service");
const semanticFieldMatcher = require("./semantic-field-matcher.service");
const extractionMappingService = require("./extraction-mapping.service");
const caseWorkbookService = require("./case-workbook.service");
const googleDriveService = require("../../integrations/google-drive.service");
const caseWorkflowAutomation = require("../../cases/case-workflow-automation.service");
const canonicalSyncService = require("../../canonical/services/CanonicalSyncService");
const classifier = require("../classifiers/document-classifier.service");
const extractor = require("../extractors/document-extractor.service");
const analysisRepository = require("../repositories/document-analysis.repository");
const repository = require("../repositories/document-intelligence.repository");
const logger = require("../../../utils/logger");
const { EVIDENCE_CATEGORIES, confidenceBand, normalizeDocumentType } = require("../schemas/document-intelligence.schema");
const { aggregateConfidence, toFieldExtractions } = require("../validators/extraction.validator");
const { mappingsFor } = require("../config/field-mapping.registry");

const REQUIRED_FIELDS_BY_TYPE = {
  passport: ["passportNumber", "firstName", "lastName", "nationality", "dateOfBirth", "issueDate", "expiryDate"],
  visa: ["visaType", "firstName", "lastName", "issueDate", "expiryDate"],
  i94: ["i94Number", "firstName", "lastName", "classOfAdmission", "arrivalDate"],
  resume: ["employment", "education"],
  cv: ["employment", "education"],
  degree: ["degree", "university", "graduationDate"],
  transcript: ["university", "degree"],
  publication: ["title", "publicationDate"],
  award: ["awardName", "issuer", "date"],
  patent: ["patentNumber", "patentTitle"],
  membership: ["organization", "membershipLevel"],
  press: ["title", "publisher", "publicationDate"],
  salary: ["employer", "salaryAmount", "date"],
  recommendation_letter: ["recommenderName", "organization", "date"],
  birth_certificate: ["fullName", "dateOfBirth", "placeOfBirth"],
  marriage_certificate: ["spouseOneName", "spouseTwoName", "marriageDate"],
  divorce_certificate: ["partyNames", "decreeDate", "court"],
  employment_letter: ["employeeName", "employer", "jobTitle", "employmentStartDate"],
  experience_letter: ["employeeName", "employer", "jobTitle"],
  employment_verification_letter: ["employeeName", "employer", "jobTitle"],
  offer_letter: ["employeeName", "employer", "jobTitle", "startDate"],
  paystub: ["employer", "payDate", "grossPay"],
  w2: ["employeeName", "employer", "taxYear", "wages"],
  tax_return: ["taxpayerNames", "taxYear", "filingStatus"],
  bank_statement: ["accountHolder", "institution", "statementEndDate"],
  business_registration: ["legalName", "registrationNumber", "jurisdiction"],
  articles_of_incorporation: ["legalName", "entityType", "formationDate"],
  organizational_chart: ["organizationName", "entities"],
  financial_statement: ["organizationName", "periodEnd", "revenue"],
  company_document: ["organizationName", "documentTitle"],
  uscis_notice: ["formNumber", "receiptNumber", "noticeDate"],
  previous_uscis_form: ["formNumber", "receiptNumber"],
  approval_notice: ["formNumber", "receiptNumber", "validFrom", "validTo"],
  rfe: ["formNumber", "receiptNumber", "responseDueDate"],
  noid: ["formNumber", "receiptNumber", "responseDueDate"],
  medical_examination: ["applicantName", "examinationDate", "physicianName"],
  police_certificate: ["subjectName", "certificateNumber", "issueDate"],
  photograph: ["subjectName"],
  supporting_evidence: ["documentTitle", "summary"],
};

const DOCUMENT_TYPE_TO_DOCUMENT_ENUM = {
  recommendation: "recommendation_letter",
  recommendation_letter: "recommendation_letter",
};

function sameId(left, right) {
  const leftId = left?._id || left;
  const rightId = right?._id || right;
  return leftId && rightId && leftId.toString() === rightId.toString();
}

function addExtractionAudit(extraction, action, user, changes = {}, req) {
  extraction.auditHistory.push({
    action,
    performedBy: user?._id,
    performedAt: new Date(),
    changes,
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
  });
}

function addProcessingLog(extraction, stage, status, message, metadata = {}) {
  extraction.processingLogs.push({ stage, status, message, metadata, createdAt: new Date() });
}

function stageResult(name, status, startedAt, details = {}) {
  return {
    name,
    status,
    durationMs: Date.now() - startedAt,
    ...details,
  };
}

async function runAutofillStage(stages, name, fn, options = {}) {
  const startedAt = Date.now();
  try {
    const data = await fn();
    stages.push(stageResult(name, "completed", startedAt, options.summarize ? options.summarize(data) : {}));
    return { ok: true, data };
  } catch (error) {
    const failure = stageResult(name, "failed", startedAt, {
      errorCode: error.code || options.errorCode || "DOCUMENT_INTELLIGENCE_STAGE_FAILED",
      message: error.message,
      retryable: options.retryable !== false,
    });
    stages.push(failure);
    logger.warn("document_autofill_stage_failed", { stage: name, error, requestId: options.requestId });
    return { ok: false, error, failure };
  }
}

function addAnalysisEvent(analysis, event, status, message, metadata = {}, user, req) {
  analysis.events.push({
    event,
    status,
    message,
    metadata,
    performedBy: user?._id,
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
  });
}

async function canAccessExtraction(user, extraction) {
  if (!user || !extraction) return false;
  const document = extraction.documentId?._id ? extraction.documentId : await Document.findById(extraction.documentId);
  return documentService.canAccessDocument(user, document);
}

async function canAccessAnalysis(user, analysis) {
  if (!user || !analysis) return false;
  const document = analysis.documentId?._id ? analysis.documentId : await Document.findById(analysis.documentId);
  return documentService.canAccessDocument(user, document);
}

function fieldValue(extraction, key) {
  return (extraction.extractedData || []).find((field) => field.key === key)?.value;
}

function documentEnumFor(type) {
  return DOCUMENT_TYPE_TO_DOCUMENT_ENUM[type] || type;
}

function evidenceMappingsFor(type, categories = []) {
  return [...new Set(categories.length ? categories : extractor.EVIDENCE_HINTS[type] || ["Other"])]
    .filter((category) => EVIDENCE_CATEGORIES.includes(category))
    .map((category) => ({ category, confidence: 90, reasoning: `Derived from ${type} document classification`, sourceFields: [] }));
}

function missingFieldsFor(type, fields = []) {
  const present = new Set(fields.filter((field) => field.value !== undefined && field.value !== null && field.value !== "").map((field) => field.key));
  return (REQUIRED_FIELDS_BY_TYPE[type] || []).filter((key) => !present.has(key));
}

function setIntelligenceStatus(document, status) {
  document.intelligenceStatus = status;
  if (status === "processing") document.aiExtractionStatus = "processing";
  if (["approved", "ocr_complete", "needs_review"].includes(status)) document.aiExtractionStatus = "completed";
  if (status === "failed") document.aiExtractionStatus = "failed";
}

async function syncDocumentToDrive(document, extraction, user, req) {
  if (!document.caseId) return null;
  try {
    document.googleDrive = { ...(document.googleDrive || {}), syncStatus: "queued" };
    await document.save();
    const result = await googleDriveService.syncDocument(document);
    extraction.googleDrive = {
      ...(extraction.googleDrive || {}),
      syncStatus: document.googleDrive?.syncStatus || (result?.configured === false ? "not_configured" : "synced"),
      fileId: document.googleDrive?.fileId,
      folderId: document.googleDrive?.folderId,
      folderPath: document.googleDrive?.folderPath,
      webViewLink: document.googleDrive?.webViewLink,
      attempts: document.googleDrive?.attempts,
      lastSyncedAt: document.googleDrive?.lastSyncedAt,
      lastAttemptAt: document.googleDrive?.lastAttemptAt,
      lastError: document.googleDrive?.lastError,
    };
    extraction.syncedTargets.googleDrive = extraction.googleDrive.syncStatus === "synced";
    addProcessingLog(extraction, "google_drive", extraction.googleDrive.syncStatus, "Google Drive synchronization completed", extraction.googleDrive);
    await extraction.save();
    return result;
  } catch (error) {
    document.googleDrive = { ...(document.googleDrive || {}), syncStatus: "failed", lastError: error.message, lastAttemptAt: new Date(), attempts: Number(document.googleDrive?.attempts || 0) + 1 };
    await document.save();
    extraction.googleDrive = { ...(extraction.googleDrive || {}), syncStatus: "failed", lastError: error.message, lastAttemptAt: new Date(), attempts: Number(extraction.googleDrive?.attempts || 0) + 1 };
    addProcessingLog(extraction, "google_drive", "failed", error.message);
    await extraction.save();
    await extractionMappingService.notifyUsers(extraction, "google_drive_failed", user, req, { error: error.message });
    return null;
  }
}

async function generateCaseWorkbook(extraction, user, req, reason) {
  if (!extraction.caseId) return null;
  extraction.excelWorkbook = { ...(extraction.excelWorkbook || {}), syncStatus: "pending", lastError: undefined };
  await extraction.save();
  try {
    const result = await caseWorkbookService.generateForCase(extraction.caseId, user, req, reason);
    extraction.excelWorkbook = {
      ...(extraction.excelWorkbook || {}),
      syncStatus: "updated",
      workbookDocument: result.document?._id,
      storageKey: result.document?.storageKey,
      lastGeneratedAt: new Date(),
      lastError: undefined,
    };
    extraction.syncedTargets.excelWorkbook = true;
    addProcessingLog(extraction, "excel_workbook", "completed", "Case workbook updated", { documentId: result.document?._id });
    await extraction.save();
    return result;
  } catch (error) {
    extraction.excelWorkbook = { ...(extraction.excelWorkbook || {}), syncStatus: "failed", lastError: error.message };
    addProcessingLog(extraction, "excel_workbook", "failed", error.message);
    await extraction.save();
    await extractionMappingService.notifyUsers(extraction, "excel_generation_failed", user, req, { error: error.message });
    return null;
  }
}

async function updateLinkedDocumentReview(extraction, status, user, req) {
  const document = await Document.findById(extraction.documentId?._id || extraction.documentId);
  if (!document) return null;
  if (status === "approved") {
    document.status = "approved";
    document.reviewStatus = "approved";
    setIntelligenceStatus(document, "approved");
    document.reviewedBy = user?._id;
    document.reviewedAt = new Date();
  } else if (status === "rejected") {
    document.status = "rejected";
    document.reviewStatus = "rejected";
    setIntelligenceStatus(document, "rejected");
    document.reviewedBy = user?._id;
    document.reviewedAt = new Date();
  } else if (status === "needs_review") {
    setIntelligenceStatus(document, "needs_review");
    document.processing = { ...(document.processing || {}), status: "review_required", stage: "review" };
  }
  documentService.addAuditEntry(document, `ocr_${status}`, user, { extractionId: extraction._id }, req);
  await document.save();
  return document;
}

function hasPendingReview(extraction) {
  return (extraction.extractedData || []).some((field) => ["manual_review", "needs_review", "pending_review"].includes(field.reviewStatus));
}

async function updateDocumentMetadata(document, extraction, user, req) {
  const type = extraction.documentType || extraction.classification?.documentType || "other";
  document.documentType = documentEnumFor(type);
  document.category = extraction.evidenceCategories?.includes("Identity") ? "identity"
    : extraction.evidenceCategories?.includes("Immigration") ? "immigration"
      : extraction.evidenceCategories?.includes("Education") ? "education"
        : extraction.evidenceCategories?.includes("Employment") ? "employment"
          : extraction.evidenceCategories?.includes("Financial") ? "financial"
            : extraction.evidenceCategories?.includes("Civil") ? "civil"
              : extraction.evidenceCategories?.includes("Business") ? "business"
                : extraction.evidenceCategories?.includes("Medical") ? "medical"
                  : extraction.evidenceCategories?.includes("Legal") ? "legal"
                    : extraction.evidenceCategories?.includes("Supporting Evidence") ? "supporting"
          : extraction.evidenceCategories?.includes("Recommendation") ? "letters"
            : extraction.evidenceCategories?.length ? "evidence" : document.category || "other";
  document.isEvidence = !["passport", "visa", "i94", "driver_license"].includes(type) || document.isEvidence;
  document.evidenceCriteria = [...new Set([...(document.evidenceCriteria || []), ...(extraction.evidenceCategories || [])])];
  const existingAssociations = document.evidenceAssociations || [];
  for (const mapping of extraction.evidenceMappings || []) {
    const exists = existingAssociations.some((item) => item.category === mapping.category && String(item.caseId || "") === String(document.caseId || ""));
    if (!exists) {
      existingAssociations.push({
        caseId: document.caseId,
        beneficiary: document.beneficiary,
        companyId: document.companyId,
        category: mapping.category,
        status: "suggested",
        confidence: mapping.confidence,
      });
    }
  }
  document.evidenceAssociations = existingAssociations;
  document.extractionConfidence = extraction.confidence;
  document.aiExtractionStatus = extraction.status === "failed" ? "failed" : "completed";
  document.aiExtractedData = {
    classification: extraction.classification,
    fields: extraction.extractedData,
    entities: extraction.structuredEntities,
    evidenceCategories: extraction.evidenceCategories,
  };
  document.ocr = {
    ...(document.ocr || {}),
    provider: extraction.provider || process.env.DOCUMENT_INTELLIGENCE_PROVIDER || "gemini",
    status: extraction.status === "failed" ? "failed" : "completed",
    rawText: extraction.rawText,
    structuredData: extraction.rawExtraction,
    confidence: extraction.confidence,
    processedAt: new Date(),
    error: extraction.processingError,
  };
  document.documentNumber = fieldValue(extraction, "passportNumber") || fieldValue(extraction, "i94Number") || fieldValue(extraction, "controlNumber") || fieldValue(extraction, "patentNumber") || document.documentNumber;
  document.issuedDate = fieldValue(extraction, "issueDate") || fieldValue(extraction, "publicationDate") || fieldValue(extraction, "date") || document.issuedDate;
  document.expiryDate = fieldValue(extraction, "expiryDate") || fieldValue(extraction, "expirationDate") || document.expiryDate;
  document.issuingAuthority = fieldValue(extraction, "issuingCountry") || fieldValue(extraction, "issuer") || fieldValue(extraction, "university") || document.issuingAuthority;
  document.metadata = {
    ...(document.metadata || {}),
    extracted: {
      applicantName: [fieldValue(extraction, "firstName"), fieldValue(extraction, "middleName"), fieldValue(extraction, "lastName")].filter(Boolean).join(" ") || undefined,
      employer: fieldValue(extraction, "employer") || fieldValue(extraction, "organization"),
      institution: fieldValue(extraction, "university") || fieldValue(extraction, "institution"),
      passportNumber: fieldValue(extraction, "passportNumber"),
      visaNumber: fieldValue(extraction, "visaNumber") || fieldValue(extraction, "controlNumber"),
      receiptNumber: fieldValue(extraction, "receiptNumber"),
      country: fieldValue(extraction, "issuingCountry") || fieldValue(extraction, "country"),
      issueDate: fieldValue(extraction, "issueDate"),
      expirationDate: fieldValue(extraction, "expiryDate") || fieldValue(extraction, "expirationDate"),
      extractedAt: new Date(),
      extractionId: extraction._id,
    },
  };
  const validationIssues = [];
  if (Number(extraction.confidence || 0) < Number(process.env.DOCUMENT_MINIMUM_CONFIDENCE || 80)) {
    validationIssues.push("Document extraction confidence is below the review threshold");
  }
  if (document.expiryDate && !Number.isNaN(new Date(document.expiryDate).getTime()) && new Date(document.expiryDate) < new Date()) {
    validationIssues.push("Document is expired");
  }
  document.validation = {
    ...(document.validation || {}),
    status: validationIssues.length ? "needs_review" : "passed",
    issues: validationIssues,
    validatedAt: new Date(),
  };
  documentService.addProcessingEvent(document, "metadata", "completed", { metadata: { extractionId: extraction._id } });
  documentService.addProcessingEvent(document, "evidence_mapping", "completed", { metadata: { count: extraction.evidenceMappings?.length || 0 } });
  documentService.addProcessingEvent(document, "indexed", "completed", { metadata: { searchableText: Boolean(extraction.rawText) } });
  documentService.addAuditEntry(document, "document_intelligence_sync", user, { extractionId: extraction._id, documentType: type }, req);
  await document.save();
  extraction.syncedTargets.documentMetadata = true;
  extraction.syncedTargets.evidenceRepository = true;
}

async function processDocument(documentId, user, req) {
  const document = await Document.findById(documentId);
  if (!document || document.deletedAt) {
    const error = new Error("Document not found");
    error.statusCode = 404;
    throw error;
  }
  if (["application/zip", "application/x-zip-compressed"].includes(document.mimeType || document.fileType)) {
    document.processing = document.processing || {};
    document.aiExtractionStatus = "completed";
    document.ocr = { ...(document.ocr || {}), status: "completed", provider: "none", processedAt: new Date() };
    document.processing.status = "completed";
    document.processing.stage = "completed";
    document.processing.completedAt = new Date();
    document.processing.retryable = false;
    setIntelligenceStatus(document, "approved");
    documentService.addProcessingEvent(document, "ocr", "skipped", { message: "Archive retained as evidence; OCR is not applicable" });
    documentService.addProcessingEvent(document, "completed", "completed");
    await document.save();
    return null;
  }
  document.processing = document.processing || {};
  document.processing.attempts = Number(document.processing.attempts || 0) + 1;
  document.processing.startedAt = document.processing.startedAt || new Date();
  document.processing.lastError = undefined;
  setIntelligenceStatus(document, "processing");
  documentService.addProcessingEvent(document, "ocr", "processing", {
    provider: process.env.DOCUMENT_INTELLIGENCE_PROVIDER || "gemini",
    attempt: document.processing.attempts,
    startedAt: new Date(),
  });
  await document.save();
  const extraction = await repository.upsertForDocument(document, {
    status: "classifying",
    processingStage: "classification",
    processingStatus: "processing",
    processingStartedAt: new Date(),
    processingError: undefined,
  });
  if ((extraction.extractedData || []).length || extraction.rawExtraction) {
    extraction.extractionHistory.push({
      replacedAt: new Date(),
      replacedBy: user?._id,
      reason: "reprocess_document",
      status: extraction.status,
      reviewStatus: extraction.reviewStatus,
      confidence: extraction.confidence,
      rawExtraction: extraction.rawExtraction,
      extractedData: extraction.extractedData,
      questionnairePrefill: extraction.questionnairePrefill,
      syncedTargets: extraction.syncedTargets,
    });
  }
  extraction.syncedTargets = {
    beneficiaryProfile: false,
    caseProfile: false,
    questionnaireAnswers: false,
    evidenceRepository: false,
    documentMetadata: false,
    googleDrive: false,
    excelWorkbook: false,
  };
  addExtractionAudit(extraction, "document_uploaded", user, { documentId }, req);
  addProcessingLog(extraction, "classification", "processing", "Classification started");
  await extraction.save();

  try {
    const buffer = await documentService.readDocumentBuffer(document);
    const analysis = await analysisRepository.upsertForDocument(document, {
      processingStatus: "processing",
      attempts: 0,
      lastAttemptAt: new Date(),
      processingError: undefined,
    });
    addAnalysisEvent(analysis, "classification_started", "processing", "Document classification started", {}, user, req);
    await analysis.save();

    const classification = await classifier.classifyWithRetry({ document, buffer });
    extraction.provider = classification.provider;
    analysis.documentType = classification.documentType;
    analysis.confidence = classification.confidence;
    analysis.reasoning = classification.reasoning;
    analysis.model = process.env.GEMINI_DOCUMENT_MODEL || process.env.GEMINI_MODEL || "gemini-flash-latest";
    analysis.promptVersion = classification.promptVersion;
    analysis.rawResponse = classification.rawResponse;
    analysis.attempts = classification.attempts;
    analysis.classifiedAt = new Date();
    analysis.processingStatus = classification.confidence >= 80 ? "classified" : "review_required";
    analysis.reviewStatus = classification.confidence >= 80 ? "not_required" : "needs_review";
    addAnalysisEvent(analysis, "classification_completed", analysis.processingStatus, "Document classification completed", classification, user, req);
    await analysis.save();
    documentService.addAuditEntry(document, "classification_completed", user, { analysisId: analysis._id, documentType: analysis.documentType, confidence: analysis.confidence }, req);
    await document.save();
    documentService.addProcessingEvent(document, "classification", "completed", { provider: classification.provider, metadata: { confidence: classification.confidence, documentType: classification.documentType } });
    await document.save();

    extraction.classification = { ...classification, model: process.env.GEMINI_DOCUMENT_MODEL || process.env.GEMINI_MODEL || "gemini-flash-latest", classifiedAt: new Date() };
    extraction.documentType = classification.documentType;
    extraction.status = "classified";
    extraction.processingStage = "extraction";
    addExtractionAudit(extraction, "classification_completed", user, classification, req);
    addProcessingLog(extraction, "classification", "completed", "Classification completed", classification);
    await extraction.save();

    extraction.status = "extracting";
    await extraction.save();
    const extracted = await extractor.extract({ document, buffer, documentType: classification.documentType });
    const evidenceCategories = [...new Set((extracted.evidenceCategories || []).filter((category) => EVIDENCE_CATEGORIES.includes(category)))];
    const fields = toFieldExtractions(extracted.fields, document._id, evidenceCategories[0]);
    const confidence = aggregateConfidence(fields, extracted.overallConfidence || classification.confidence);
    extraction.rawText = extracted.rawText;
    extraction.rawExtraction = extracted.raw;
    extraction.structuredEntities = extracted.entities;
    extraction.extractedData = fields;
    extraction.evidenceCategories = evidenceCategories.length ? evidenceCategories : ["Other"];
    extraction.evidenceMappings = evidenceMappingsFor(classification.documentType, extraction.evidenceCategories);
    extraction.missingFields = missingFieldsFor(classification.documentType, fields);
    extraction.confidence = confidence;
    extraction.confidenceBand = confidenceBand(confidence);
    extraction.reviewStatus = extraction.confidenceBand;
    extraction.status = "validating";
    extraction.processingStage = "validation";
    addExtractionAudit(extraction, "extraction_completed", user, { confidence, fieldCount: fields.length }, req);
    addProcessingLog(extraction, "extraction", "completed", "Extraction completed", { confidence, fieldCount: fields.length });
    await extraction.save();
    setIntelligenceStatus(document, "ocr_complete");
    documentService.addProcessingEvent(document, "ocr", "completed", { provider: classification.provider, metadata: { confidence, fieldCount: fields.length } });
    await document.save();

    extraction.status = "syncing";
    extraction.processingStage = "sync";
    await updateDocumentMetadata(document, extraction, user, req);
    await syncDocumentToDrive(document, extraction, user, req);
    await extractionMappingService.applyExtractionMappings(extraction, user, req);
    extraction.status = "completed";
    extraction.processingStage = "completed";
    extraction.processingStatus = ["needs_review", "manual_review", "pending_review"].includes(extraction.reviewStatus) ? "review_required" : "completed";
    extraction.processingCompletedAt = new Date();
    extraction.processingTimeMs = extraction.processingStartedAt ? new Date() - extraction.processingStartedAt : undefined;
    analysis.extractionId = extraction._id;
    addAnalysisEvent(analysis, "extraction_completed", "completed", "Extractor pipeline completed", { extractionId: extraction._id, confidence }, user, req);
    await analysis.save();
    addProcessingLog(extraction, "sync", "completed", "Synchronized extraction results");
    await extraction.save();
    document.processing.status = ["needs_review", "manual_review", "pending_review"].includes(extraction.reviewStatus) ? "review_required" : "completed";
    document.processing.stage = document.processing.status === "review_required" ? "review" : "completed";
    setIntelligenceStatus(document, document.processing.status === "review_required" ? "needs_review" : "approved");
    document.processing.completedAt = new Date();
    document.processing.retryable = false;
    document.processing.lastError = undefined;
    documentService.addProcessingEvent(document, document.processing.stage, "completed", { metadata: { extractionId: extraction._id } });
    await document.save();
    await canonicalSyncService.syncFromExtraction(extraction, user, req).catch(() => null);
    if (extraction.reviewStatus === "auto_accepted") await generateCaseWorkbook(extraction, user, req, "auto_accepted_extraction").catch(() => null);
    if (extraction.caseId) await require("../../cases/case-lifecycle-orchestrator.service").recalculate(extraction.caseId, user, req, "ocr_extraction_completed").catch(() => null);
    return extraction;
  } catch (error) {
    extraction.status = "failed";
    extraction.processingStage = "failed";
    extraction.processingStatus = "failed";
    extraction.processingError = error.message;
    extraction.processingCompletedAt = new Date();
    extraction.processingTimeMs = extraction.processingStartedAt ? new Date() - extraction.processingStartedAt : undefined;
    addProcessingLog(extraction, extraction.processingStage, "failed", error.message);
    await extraction.save();
    const failedAnalysis = await analysisRepository.upsertForDocument(document, {
      processingStatus: "failed",
      processingError: error.message,
      lastAttemptAt: new Date(),
    });
    addAnalysisEvent(failedAnalysis, "classification_or_extraction_failed", "failed", error.message, {}, user, req);
    await failedAnalysis.save();
    documentService.addAuditEntry(document, "classification_failed", user, { analysisId: failedAnalysis._id, error: error.message }, req);
    await document.save();
    document.aiExtractionStatus = "failed";
    setIntelligenceStatus(document, "failed");
    document.ocr = { ...(document.ocr || {}), provider: process.env.DOCUMENT_INTELLIGENCE_PROVIDER || "gemini", status: "failed", error: error.message, processedAt: new Date() };
    document.processing.status = "failed";
    document.processing.stage = "failed";
    document.processing.completedAt = new Date();
    documentService.addProcessingEvent(document, "failed", "failed", { message: error.message, errorCode: error.code, retryable: true });
    await document.save();
    await extractionMappingService.notifyUsers(extraction, "processing_failed", user, req, { error: error.message });
    throw error;
  }
}

async function uploadAndProcess({ file, body, user, req }) {
  const document = await documentService.createDocumentFromFile({ file, body, user, req });
  const queue = require("../queues/document-intelligence.queue");
  queue.enqueue({ documentId: document._id, user, reqMeta: { ip: req?.ip, userAgent: req?.headers?.["user-agent"] } });
  return document;
}

// Phase H2: writes answer-targeted matches as editable draft answers with
// OCR provenance. questionnaireService.saveAnswers() is reused for the
// actual upsert (validation/completion/masterData-snapshot side effects all
// stay correct), but its own post-save step
// (buildMappingOutput+Answer.updateMany) unconditionally REPLACES
// mappingOutput for every answer in the responseId with a
// {uscisFormNumber: {...}} map that carries no provenance - so the OCR
// badge marker (mappingOutput.sourceType==="ocr", read by the client's
// prefillMetaFromAnswers) is patched on afterward, per answer, via a
// dot-path $set that only adds keys rather than replacing the field
// wholesale (never clobbers the uscis mapping saveAnswers just computed).
async function applyAnswerMatches({ caseId, documentType, extraction, matches, labelByTarget, user, req }) {
  const targets = await questionnaireService.resolveCaseQuestionnaires(caseId);
  const targetByQuestionnaireId = new Map(targets.map((target) => [String(target.questionnaire._id), target]));

  const byQuestionnaire = new Map();
  for (const match of matches) {
    const qid = String(match.questionnaireId);
    if (!byQuestionnaire.has(qid)) byQuestionnaire.set(qid, []);
    byQuestionnaire.get(qid).push(match);
  }

  const items = [];
  for (const [questionnaireId, questionnaireMatches] of byQuestionnaire) {
    const target = targetByQuestionnaireId.get(questionnaireId);
    if (!target) continue;
    const existingAnswers = await Answer.find({ responseId: target.responseId }).select("questionKey value");
    const existingByKey = new Map(existingAnswers.map((answer) => [answer.questionKey, answer.value]));

    const toWrite = [];
    const pendingItems = [];
    for (const match of questionnaireMatches) {
      // `match.value` is already populated by applyQuestionnairePrefill's
      // caller-side fieldByKey (built from the FULL matched-fields set,
      // including derived fields like deriveEducationScalarFields' output
      // that never appear in extraction.extractedData itself) - do not
      // re-derive it from extraction.extractedData here, or every derived-
      // field match silently drops (confirmed empirically: this used to
      // look itself up via a local fieldByKey keyed off
      // extraction.extractedData only, so an OCR-derived
      // "educationHighestLevel" match was matched correctly upstream but
      // then discarded here for having no literal extractedData entry).
      if (match.value === undefined) continue;
      const label = labelByTarget.get(`answer:${match.targetPath}`);
      const existingValue = existingByKey.get(match.targetPath);
      const isEmpty = existingValue === undefined || existingValue === null || existingValue === "";
      const isSame = !isEmpty && String(existingValue) === String(match.value);
      const base = {
        key: match.targetPath,
        value: match.value,
        label,
        confidence: match.combinedConfidence,
        sourceDocumentType: documentType,
        targetSystem: "answer",
        questionnaireId: target.questionnaire._id,
      };
      if (isEmpty || isSame) {
        toWrite.push({ questionKey: match.targetPath, value: match.value });
        pendingItems.push({ ...base, applied: true, conflict: false });
      } else {
        items.push({ ...base, applied: false, conflict: true });
      }
    }
    if (!toWrite.length) continue;
    const result = await questionnaireService.saveAnswers(
      { questionnaireId: target.questionnaire._id, caseId, responseId: target.responseId, answers: toWrite },
      user,
      req
    );
    const savedByKey = new Map((result.answers || []).map((answer) => [answer.questionKey, answer]));
    for (const item of pendingItems) {
      const saved = savedByKey.get(item.key);
      if (saved) {
        await Answer.updateOne(
          { _id: saved._id },
          {
            $set: {
              "mappingOutput.sourceType": "ocr",
              "mappingOutput.confidenceScore": item.confidence,
              "mappingOutput.sourceDocumentId": extraction.documentId,
              "mappingOutput.extractionId": extraction._id,
            },
          }
        );
        item.answerId = saved._id;
      }
      items.push(item);
    }
  }
  return items;
}

function deterministicAnswerMatches({ documentType, fields, catalog, existingMatches = [] }) {
  const mappings = mappingsFor(documentType);
  if (!mappings || !Object.keys(mappings).length) return [];
  const answerCatalogByPath = new Map(
    (catalog || [])
      .filter((entry) => entry.targetSystem === "answer")
      .map((entry) => [entry.targetPath, entry])
  );
  const seen = new Set(existingMatches.map((match) => `${match.fieldKey}:answer:${match.targetPath}`));
  const matches = [];
  for (const field of fields || []) {
    const candidates = mappings[field.key]?.questionnaire || [];
    for (const targetPath of candidates) {
      const entry = answerCatalogByPath.get(targetPath);
      if (!entry) continue;
      const key = `${field.key}:answer:${targetPath}`;
      if (seen.has(key)) continue;
      matches.push({
        fieldKey: field.key,
        targetSystem: "answer",
        targetPath,
        questionnaireId: entry.questionnaireId,
        matchConfidence: 100,
        combinedConfidence: Math.max(0, Math.min(100, Number(field.confidence) || 100)),
      });
      seen.add(key);
    }
  }
  return matches;
}

// Phase H2: after normal OCR processing, runs the (already-implemented,
// untouched) semantic matcher against the case's answer+masterData catalog
// and applies/routes the results. Deliberately a post-processing step over
// processDocument's own result rather than a change to processDocument
// itself, since processDocument is shared with the queued uploadAndProcess
// path that has no case-specific questionnaire-prefill semantics.
async function applyQuestionnairePrefill(extraction, caseId, user, req, options = {}) {
  if (!extraction || !caseId) return extraction;
  const documentType = extraction.documentType || extraction.classification?.documentType;
  const fields = (extraction.extractedData || []).filter(
    (field) => field.value !== undefined && field.value !== null && field.value !== ""
  );
  if (!fields.length) {
    extraction.questionnairePrefill = extraction.questionnairePrefill || [];
    await extraction.save();
    return extraction;
  }

  // A resume's "education" field is an array - no questionnaire question
  // accepts it as-is (see field-mapping.registry.js's own comment on
  // FIELD_MAPPINGS.resume). Project it into the flat scalar fields the
  // employee checklist actually asks for (deriveEducationScalarFields picks
  // the highest-RANKED entry, not the most recent) so matching below has
  // something to match against; never persisted back onto `extraction`
  // itself, only used in-memory for this matching pass.
  const derivedFields = ["resume", "cv"].includes(documentType)
    ? extractionMappingService.deriveEducationScalarFields(fields)
    : [];
  const allFields = derivedFields.length ? [...fields, ...derivedFields] : fields;

  let matches = [];
  try {
    matches = await semanticFieldMatcher.matchFields({ documentType, fields: allFields, caseId });
  } catch (error) {
    matches = [];
  }
  const catalog = await semanticFieldMatcher.buildTargetCatalog(caseId);
  matches = [
    ...matches,
    ...deterministicAnswerMatches({ documentType, fields: allFields, catalog, existingMatches: matches }),
  ];
  if (!matches.length) {
    extraction.questionnairePrefill = [];
    await extraction.save();
    return extraction;
  }

  const labelByTarget = new Map(catalog.map((entry) => [`${entry.targetSystem}:${entry.targetPath}`, entry.label]));
  const fieldByKey = new Map(allFields.map((field) => [field.key, field]));
  const enrichedMatches = matches.map((match) => ({
    ...match,
    value: fieldByKey.get(match.fieldKey)?.value,
    label: labelByTarget.get(`${match.targetSystem}:${match.targetPath}`),
    sourceDocumentType: documentType,
    sourceDocumentId: extraction.documentId,
  }));

  const answerMatches = enrichedMatches.filter((match) => match.targetSystem === "answer");
  const masterDataMatches = enrichedMatches.filter((match) => match.targetSystem === "masterData");

  const items = [];
  if (answerMatches.length) {
    items.push(...(await applyAnswerMatches({ caseId, documentType, extraction, matches: answerMatches, labelByTarget, user, req })));
  }
  if (masterDataMatches.length) {
    items.push(...(await extractionMappingService.applyExtractionMappings(extraction, user, req, { caseId, participantId: options.participantId || extraction.participantId, matches: masterDataMatches })));
  }

  extraction.questionnairePrefill = items;
  await extraction.save();
  return extraction;
}

async function uploadAndExtractNow({ file, body, user, req }) {
  const document = await documentService.createDocumentFromFile({ file, body, user, req });
  const extraction = await processDocument(document._id, user, req);
  return applyQuestionnairePrefill(extraction, body?.caseId, user, req, { participantId: body?.participantId || document.participantId });
}

async function uploadAndExtractNowDetailed({ file, body, user, req }) {
  const stages = [];
  const requestId = req?.requestId;
  let document = null;
  let extraction = null;
  let prefill = [];
  const startedAt = Date.now();

  const upload = await runAutofillStage(stages, "upload", async () => {
    const created = await documentService.createDocumentFromFile({ file, body, user, req });
    documentService.addProcessingEvent(created, "uploaded", "completed", {
      message: "Document uploaded for synchronous autofill",
      metadata: { requestId, documentType: body?.documentType },
    });
    await created.save();
    return created;
  }, {
    requestId,
    errorCode: "DOCUMENT_UPLOAD_FAILED",
    retryable: false,
    summarize: (created) => ({ documentId: created._id, duplicate: Boolean(created.$locals?.wasDuplicate) }),
  });
  if (!upload.ok) {
    return {
      ok: false,
      status: "failed",
      errorCode: "DOCUMENT_UPLOAD_FAILED",
      message: upload.error.message,
      stages,
      durationMs: Date.now() - startedAt,
    };
  }
  document = upload.data;

  const ocr = await runAutofillStage(stages, "ocr_pipeline", async () => processDocument(document._id, user, req), {
    requestId,
    errorCode: "DOCUMENT_OCR_FAILED",
    summarize: (result) => ({
      extractionId: result?._id,
      documentType: result?.documentType || result?.classification?.documentType,
      confidence: result?.confidence,
      fieldCount: result?.extractedData?.length || 0,
    }),
  });
  if (!ocr.ok) {
    extraction = await repository.findByDocument(document._id).catch(() => null);
    return {
      ok: false,
      status: "failed",
      errorCode: "DOCUMENT_OCR_FAILED",
      message: "Document was uploaded, but OCR/classification/extraction failed.",
      details: { cause: ocr.error.message },
      document,
      extraction,
      stages,
      durationMs: Date.now() - startedAt,
    };
  }
  extraction = ocr.data;

  const questionnaireSync = await runAutofillStage(stages, "questionnaire_sync", async () => applyQuestionnairePrefill(extraction, body?.caseId, user, req, { participantId: body?.participantId || document.participantId }), {
    requestId,
    errorCode: "QUESTIONNAIRE_PREFILL_FAILED",
    summarize: (result) => ({ prefillCount: result?.questionnairePrefill?.length || 0 }),
  });
  if (questionnaireSync.ok) {
    extraction = questionnaireSync.data;
    prefill = extraction?.questionnairePrefill || [];
  } else if (extraction) {
    addProcessingLog(extraction, "questionnaire_sync", "failed", questionnaireSync.error.message, { requestId });
    extraction.processingStatus = extraction.processingStatus === "failed" ? "failed" : "review_required";
    await extraction.save().catch(() => null);
  }

  const canonical = await runAutofillStage(stages, "canonical_sync", async () => canonicalSyncService.syncFromExtraction(extraction, user, req), {
    requestId,
    errorCode: "CANONICAL_SYNC_FAILED",
    summarize: (state) => ({ version: state?.version, status: state?.status }),
  });
  if (!canonical.ok && extraction) {
    addProcessingLog(extraction, "canonical_sync", "failed", canonical.error.message, { requestId });
    await extraction.save().catch(() => null);
  }

  const forms = await runAutofillStage(stages, "case_form_sync", async () => {
    if (!body?.caseId) return null;
    return caseWorkflowAutomation.tryGenerateForms(body.caseId, user, req, "document_autofill_completed");
  }, {
    requestId,
    errorCode: "CASE_FORM_SYNC_FAILED",
    summarize: (result) => ({
      generatedCount: result?.generated?.length || 0,
      failedCount: result?.failed?.length || 0,
      skipped: !result,
    }),
  });
  if (!forms.ok && extraction) {
    addProcessingLog(extraction, "case_form_sync", "failed", forms.error.message, { requestId });
    await extraction.save().catch(() => null);
  }

  const failedStages = stages.filter((stage) => stage.status === "failed");
  if (extraction) {
    addProcessingLog(extraction, "autofill_request", failedStages.length ? "completed_with_warnings" : "completed", "Synchronous document autofill request finished", { requestId, stages });
    await extraction.save().catch(() => null);
  }

  return {
    ok: failedStages.length === 0,
    status: failedStages.length ? "completed_with_warnings" : "completed",
    errorCode: failedStages.length ? "DOCUMENT_AUTOFILL_PARTIAL" : undefined,
    message: failedStages.length
      ? "Document processed with one or more synchronization warnings."
      : "Document processed and synchronized.",
    document,
    extraction,
    prefill,
    stages,
    durationMs: Date.now() - startedAt,
  };
}

async function classifyDocument(documentId, user, req) {
  return processDocument(documentId, user, req);
}

async function getExtractionByDocument(documentId, user) {
  const extraction = await repository.findByDocument(documentId);
  if (!extraction) {
    const error = new Error("Extraction result not found");
    error.statusCode = 404;
    throw error;
  }
  if (!(await canAccessExtraction(user, extraction))) {
    const error = new Error("Not authorized to access extraction result");
    error.statusCode = 403;
    throw error;
  }
  return extraction;
}

async function getExtraction(id, user) {
  const extraction = await repository.findById(id);
  if (!extraction) {
    const error = new Error("Extraction result not found");
    error.statusCode = 404;
    throw error;
  }
  if (!(await canAccessExtraction(user, extraction))) {
    const error = new Error("Not authorized to access extraction result");
    error.statusCode = 403;
    throw error;
  }
  return extraction;
}

async function listExtractions(query, user) {
  const result = await repository.list(query);
  const filtered = [];
  for (const item of result.items) {
    if (await canAccessExtraction(user, item)) filtered.push(item);
  }
  return { ...result, items: filtered, count: filtered.length, extractions: filtered };
}

async function reviewQueue(query, user) {
  const targetQuery = { ...query };
  if (!targetQuery.reviewStatus) targetQuery.reviewStatus = { $in: ["needs_review", "manual_review", "pending_review"] };
  return listExtractions(targetQuery, user);
}

async function updateFieldReview(extraction, payload, user, req) {
  const field = extraction.extractedData.id(payload.fieldId) || extraction.extractedData.find((item) => item.key === payload.key);
  if (!field) {
    const error = new Error("Extracted field not found");
    error.statusCode = 404;
    throw error;
  }
  const previous = { value: field.value, reviewStatus: field.reviewStatus };
  if (payload.status === "approved") {
    field.reviewStatus = "approved";
    field.reviewedBy = user._id;
    field.reviewedAt = new Date();
  } else if (payload.status === "rejected") {
    field.reviewStatus = "rejected";
    field.reviewedBy = user._id;
    field.reviewedAt = new Date();
  } else if (payload.status === "edited") {
    field.originalValue = field.originalValue === undefined ? field.value : field.originalValue;
    field.value = payload.value;
    field.editedValue = payload.value;
    field.reviewStatus = "edited";
    field.editedBy = user._id;
    field.editedAt = new Date();
  }
  extraction.correctionHistory.push({
    fieldKey: field.key,
    previousValue: previous.value,
    newValue: field.value,
    previousStatus: previous.reviewStatus,
    newStatus: field.reviewStatus,
    reason: payload.reason,
    correctedBy: user._id,
  });
  addExtractionAudit(extraction, `field_${payload.status}`, user, { fieldKey: field.key, previous, next: { value: field.value, reviewStatus: field.reviewStatus }, reason: payload.reason }, req);
  await extractionMappingService.applyExtractionMappings(extraction, user, req);
  if (!hasPendingReview(extraction) && !extraction.extractedData.some((item) => item.reviewStatus === "rejected")) {
    extraction.reviewStatus = "approved";
    extraction.processingStatus = "completed";
    await updateLinkedDocumentReview(extraction, "approved", user, req);
  } else {
    await updateLinkedDocumentReview(extraction, "needs_review", user, req);
  }
  await extraction.save();
  await canonicalSyncService.syncFromExtraction(extraction, user, req).catch(() => null);
  await generateCaseWorkbook(extraction, user, req, `field_${payload.status}`).catch(() => null);
  if (extraction.caseId) await caseWorkflowAutomation.tryGenerateForms(extraction.caseId, user, req, `field_${payload.status}`).catch(() => null);
  return extraction;
}

async function approveExtraction(id, payload, user, req) {
  const extraction = await getExtraction(id, user);
  if (payload?.fieldId || payload?.key) return updateFieldReview(extraction, { ...payload, status: payload.status || "approved" }, user, req);
  extraction.reviewStatus = "approved";
  extraction.processingStatus = "completed";
  extraction.extractedData.forEach((field) => {
    if (!["rejected", "edited"].includes(field.reviewStatus)) {
      field.reviewStatus = "approved";
      field.reviewedBy = user._id;
      field.reviewedAt = new Date();
    }
  });
  addExtractionAudit(extraction, "document_approved", user, payload, req);
  await extractionMappingService.applyExtractionMappings(extraction, user, req);
  await extraction.save();
  await updateLinkedDocumentReview(extraction, "approved", user, req);
  await canonicalSyncService.syncFromExtraction(extraction, user, req).catch(() => null);
  await generateCaseWorkbook(extraction, user, req, "extraction_approved").catch(() => null);
  if (extraction.caseId) await caseWorkflowAutomation.tryGenerateForms(extraction.caseId, user, req, "extraction_approved").catch(() => null);
  return extraction;
}

async function rejectExtraction(id, payload, user, req) {
  const extraction = await getExtraction(id, user);
  if (payload?.fieldId || payload?.key) return updateFieldReview(extraction, { ...payload, status: "rejected" }, user, req);
  extraction.reviewStatus = "rejected";
  extraction.processingStatus = "completed";
  extraction.extractedData.forEach((field) => {
    field.reviewStatus = "rejected";
    field.reviewedBy = user._id;
    field.reviewedAt = new Date();
  });
  addExtractionAudit(extraction, "document_rejected", user, payload, req);
  await extraction.save();
  await updateLinkedDocumentReview(extraction, "rejected", user, req);
  return extraction;
}

async function editField(id, payload, user, req) {
  const extraction = await getExtraction(id, user);
  return updateFieldReview(extraction, { ...payload, status: "edited" }, user, req);
}

async function overrideExtractionClassification(id, payload, user, req) {
  const extraction = await getExtraction(id, user);
  const nextType = normalizeDocumentType(payload.documentType || payload.type);
  const previous = extraction.documentType;
  extraction.documentType = nextType;
  extraction.classification = {
    ...(extraction.classification || {}),
    documentType: nextType,
    confidence: payload.confidence !== undefined ? Math.max(0, Math.min(100, Number(payload.confidence) || 0)) : extraction.classification?.confidence,
    reasoning: payload.reason || payload.reasoning || extraction.classification?.reasoning,
    manuallyOverridden: true,
    previousDocumentType: previous,
    overriddenBy: user._id,
    overriddenAt: new Date(),
  };
  extraction.missingFields = missingFieldsFor(nextType, extraction.extractedData || []);
  addExtractionAudit(extraction, "classification_overridden", user, { previousDocumentType: previous, documentType: nextType, reason: payload.reason }, req);
  const document = await Document.findById(extraction.documentId?._id || extraction.documentId);
  if (document) {
    document.documentType = documentEnumFor(nextType);
    document.metadata = { ...(document.metadata || {}), classificationOverride: { previousDocumentType: previous, documentType: nextType, overriddenBy: user._id, overriddenAt: new Date() } };
    documentService.addAuditEntry(document, "classification_overridden", user, { previousDocumentType: previous, documentType: nextType }, req);
    await document.save();
  }
  await extractionMappingService.applyExtractionMappings(extraction, user, req);
  await extraction.save();
  return extraction;
}

async function reprocessExtraction(id, user, req) {
  const extraction = await getExtraction(id, user);
  return processDocument(extraction.documentId?._id || extraction.documentId, user, req);
}

async function listAnalyses(query, user) {
  const result = await analysisRepository.list(query);
  const filtered = [];
  for (const item of result.items) {
    if (await canAccessAnalysis(user, item)) filtered.push(item);
  }
  return { ...result, items: filtered, analyses: filtered, count: filtered.length };
}

async function getAnalysis(id, user) {
  const analysis = await analysisRepository.findById(id);
  if (!analysis) {
    const error = new Error("Document analysis not found");
    error.statusCode = 404;
    throw error;
  }
  if (!(await canAccessAnalysis(user, analysis))) {
    const error = new Error("Not authorized to access document analysis");
    error.statusCode = 403;
    throw error;
  }
  return analysis;
}

async function approveAnalysis(id, payload, user, req) {
  const analysis = await getAnalysis(id, user);
  analysis.reviewStatus = "approved";
  analysis.processingStatus = "approved";
  analysis.reviewedBy = user._id;
  analysis.reviewedAt = new Date();
  analysis.reviewNotes = payload?.reviewNotes || payload?.notes;
  addAnalysisEvent(analysis, "classification_approved", "approved", "Classification approved", payload, user, req);
  await analysis.save();
  return analysis;
}

async function rejectAnalysis(id, payload, user, req) {
  const analysis = await getAnalysis(id, user);
  analysis.reviewStatus = "rejected";
  analysis.processingStatus = "rejected";
  analysis.reviewedBy = user._id;
  analysis.reviewedAt = new Date();
  analysis.reviewNotes = payload?.reviewNotes || payload?.notes;
  addAnalysisEvent(analysis, "classification_rejected", "rejected", "Classification rejected", payload, user, req);
  await analysis.save();
  return analysis;
}

async function editAnalysis(id, payload, user, req) {
  const analysis = await getAnalysis(id, user);
  const previous = { documentType: analysis.documentType, confidence: analysis.confidence, reasoning: analysis.reasoning };
  if (payload.documentType) analysis.documentType = normalizeDocumentType(payload.documentType);
  if (payload.confidence !== undefined) analysis.confidence = Math.max(0, Math.min(100, Number(payload.confidence) || 0));
  if (payload.reasoning !== undefined) analysis.reasoning = payload.reasoning;
  analysis.reviewStatus = "edited";
  analysis.processingStatus = analysis.confidence >= 80 ? "classified" : "review_required";
  analysis.reviewedBy = user._id;
  analysis.reviewedAt = new Date();
  addAnalysisEvent(analysis, "classification_edited", analysis.processingStatus, "Classification edited", { previous, next: { documentType: analysis.documentType, confidence: analysis.confidence, reasoning: analysis.reasoning } }, user, req);
  await analysis.save();
  return analysis;
}

async function reprocessAnalysis(id, user, req) {
  const analysis = await getAnalysis(id, user);
  return processDocument(analysis.documentId?._id || analysis.documentId, user, req);
}

async function dashboard(query, user) {
  const result = await listExtractions(query, user);
  const items = result.items || [];
  const pendingReview = items.filter((item) => ["needs_review", "manual_review", "pending_review"].includes(item.reviewStatus)).length;
  const completed = items.filter((item) => item.status === "completed").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const averageConfidence = items.length ? Math.round(items.reduce((sum, item) => sum + (Number(item.confidence) || 0), 0) / items.length) : 0;
  const byType = items.reduce((acc, item) => {
    acc[item.documentType] = (acc[item.documentType] || 0) + 1;
    return acc;
  }, {});
  return { total: items.length, pendingReview, completed, failed, averageConfidence, byType, items };
}

async function prefillSummaryForCase(caseId, user) {
  const caseData = await Case.findById(caseId);
  if (!caseData) {
    const error = new Error("Case not found");
    error.statusCode = 404;
    throw error;
  }
  if (!caseService.canAccessCase(user, caseData)) {
    const error = new Error("Not authorized to access this case");
    error.statusCode = 403;
    throw error;
  }
  const answerEntries = await Answer.find({ caseId, status: "auto_saved", "mappingOutput.sourceType": "ocr" }).select("questionKey value mappingOutput questionnaire");
  const answerItems = answerEntries.map((answer) => ({
    targetSystem: "answer",
    targetPath: answer.questionKey,
    answerId: answer._id,
    questionnaireId: answer.questionnaire,
    value: answer.value,
    confidenceScore: answer.mappingOutput?.confidenceScore,
    sourceDocumentId: answer.mappingOutput?.sourceDocumentId,
    extractionId: answer.mappingOutput?.extractionId,
    status: "pending",
  }));
  const masterDataItems = (caseData.questionnaireData?.masterDataPrefill || [])
    .filter((item) => item.status === "pending")
    .map((item) => ({
      targetSystem: "masterData",
      targetPath: item.path,
      prefillId: item._id,
      value: item.value,
      confidenceScore: item.confidenceScore,
      sourceDocumentId: item.sourceDocumentId,
      extractionId: item.extractionId,
      existingValue: item.existingValue,
      status: item.status,
    }));
  return { caseId, items: [...answerItems, ...masterDataItems] };
}

async function reviewMasterDataField(caseId, prefillId, action, payload, user, req) {
  const caseData = await Case.findById(caseId);
  if (!caseData) {
    const error = new Error("Case not found");
    error.statusCode = 404;
    throw error;
  }
  if (!caseService.canAccessCase(user, caseData)) {
    const error = new Error("Not authorized to access this case");
    error.statusCode = 403;
    throw error;
  }
  const entry = caseData.questionnaireData.masterDataPrefill.id(prefillId);
  if (!entry) {
    const error = new Error("Prefill entry not found");
    error.statusCode = 404;
    throw error;
  }
  const masterData = caseData.questionnaireData.masterData || {};
  if (action === "accept") {
    lodash.set(masterData, entry.path, entry.value);
    entry.status = "accepted";
  } else if (action === "reject") {
    if (entry.existingValue === undefined) lodash.unset(masterData, entry.path);
    entry.status = "rejected";
  } else if (action === "edit") {
    lodash.set(masterData, entry.path, payload.value);
    entry.value = payload.value;
    entry.status = "edited";
  }
  caseData.questionnaireData.masterData = masterData;
  caseData.markModified("questionnaireData.masterData");
  caseService.addAuditEntry(caseData, `masterdata_field_${action}`, `Employer/employee questionnaire field ${action}ed`, user, { path: entry.path }, req);
  await caseData.save();
  return entry;
}

module.exports = {
  approveExtraction,
  approveAnalysis,
  classifyDocument,
  dashboard,
  editAnalysis,
  editField,
  overrideExtractionClassification,
  getAnalysis,
  getExtraction,
  getExtractionByDocument,
  listAnalyses,
  listExtractions,
  processDocument,
  rejectAnalysis,
  rejectExtraction,
  reprocessAnalysis,
  reprocessExtraction,
  reviewQueue,
  uploadAndProcess,
  uploadAndExtractNow,
  uploadAndExtractNowDetailed,
  prefillSummaryForCase,
  reviewMasterDataField,
  applyQuestionnairePrefill,
};
