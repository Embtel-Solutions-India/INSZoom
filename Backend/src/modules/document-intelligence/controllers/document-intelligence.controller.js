const service = require("../services/document-intelligence.service");
const queue = require("../queues/document-intelligence.queue");
const caseService = require("../../cases/case.service");
const Case = require("../../../models/Case");
const { extractionQueryDto, reviewFieldDto } = require("../dto/document-intelligence.dto");
const { EVIDENCE_CATEGORIES } = require("../schemas/document-intelligence.schema");
const { AUTOFILL_DOCUMENT_TYPES } = require("../config/autofill-document-types");

exports.uploadDocument = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
    const document = await service.uploadAndProcess({ file: req.file, body: req.body, user: req.user, req });
    res.status(201).json({ success: true, message: "Document uploaded and queued for intelligence processing", document, queue: queue.stats() });
  } catch (error) {
    next(error);
  }
};

exports.autofillQuestionnaire = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
    const documentType = req.body.documentType;
    if (!AUTOFILL_DOCUMENT_TYPES.includes(documentType)) {
      return res.status(400).json({ success: false, message: `documentType must be one of: ${AUTOFILL_DOCUMENT_TYPES.join(", ")}` });
    }
    const caseId = req.params.caseId || req.body.caseId;
    if (!caseId) return res.status(400).json({ success: false, message: "caseId is required", errorCode: "CASE_ID_REQUIRED", details: {} });
    const caseData = await Case.findById(caseId);
    if (!caseData) return res.status(404).json({ success: false, message: "Case not found" });
    if (!caseService.canAccessCase(req.user, caseData)) {
      return res.status(403).json({ success: false, message: "Not authorized to access this case" });
    }
    const result = await service.uploadAndExtractNowDetailed({
      file: req.file,
      body: { ...req.body, caseId },
      user: req.user,
      req,
    });
    if (!result.ok && result.status === "failed") {
      return res.status(422).json({
        success: false,
        message: result.message,
        errorCode: result.errorCode || "DOCUMENT_AUTOFILL_FAILED",
        details: {
          cause: result.details?.cause,
          document: result.document,
          extraction: result.extraction,
          stages: result.stages,
          durationMs: result.durationMs,
        },
      });
    }
    res.status(result.ok ? 200 : 207).json({
      success: true,
      message: result.message,
      status: result.status,
      document: result.document,
      extraction: result.extraction,
      prefill: result.prefill,
      stages: result.stages,
      warnings: result.stages.filter((stage) => stage.status === "failed"),
      durationMs: result.durationMs,
    });
  } catch (error) {
    next(error);
  }
};

exports.classifyDocument = async (req, res, next) => {
  try {
    const extraction = await service.classifyDocument(req.params.documentId, req.user, req);
    res.json({ success: true, extraction });
  } catch (error) {
    next(error);
  }
};

exports.extractDocument = async (req, res, next) => {
  try {
    const extraction = await service.processDocument(req.params.documentId, req.user, req);
    res.json({ success: true, extraction });
  } catch (error) {
    next(error);
  }
};

exports.listExtractions = async (req, res, next) => {
  try {
    const result = await service.listExtractions(extractionQueryDto(req.query), req.user);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

exports.dashboard = async (req, res, next) => {
  try {
    const result = await service.dashboard(extractionQueryDto(req.query), req.user);
    res.json({ success: true, ...result, queue: queue.stats() });
  } catch (error) {
    next(error);
  }
};

exports.reviewQueue = async (req, res, next) => {
  try {
    const result = await service.listExtractions({ ...extractionQueryDto(req.query), reviewStatus: req.query.reviewStatus || undefined }, req.user);
    const reviewStatuses = ["needs_review", "manual_review", "pending_review"];
    const extractions = result.extractions.filter((item) => reviewStatuses.includes(item.reviewStatus) || item.extractedData?.some((field) => reviewStatuses.includes(field.reviewStatus)));
    res.json({ success: true, ...result, extractions, count: extractions.length });
  } catch (error) {
    next(error);
  }
};

exports.analysisReviewQueue = async (req, res, next) => {
  try {
    const result = await service.listAnalyses({ ...req.query, reviewStatus: req.query.reviewStatus || "needs_review" }, req.user);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

exports.listAnalyses = async (req, res, next) => {
  try {
    const result = await service.listAnalyses(req.query, req.user);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

exports.getAnalysis = async (req, res, next) => {
  try {
    const analysis = await service.getAnalysis(req.params.id, req.user);
    res.json({ success: true, analysis });
  } catch (error) {
    next(error);
  }
};

exports.approveAnalysis = async (req, res, next) => {
  try {
    const analysis = await service.approveAnalysis(req.params.id, req.body, req.user, req);
    res.json({ success: true, message: "Classification approved", analysis });
  } catch (error) {
    next(error);
  }
};

exports.rejectAnalysis = async (req, res, next) => {
  try {
    const analysis = await service.rejectAnalysis(req.params.id, req.body, req.user, req);
    res.json({ success: true, message: "Classification rejected", analysis });
  } catch (error) {
    next(error);
  }
};

exports.editAnalysis = async (req, res, next) => {
  try {
    const analysis = await service.editAnalysis(req.params.id, req.body, req.user, req);
    res.json({ success: true, message: "Classification updated", analysis });
  } catch (error) {
    next(error);
  }
};

exports.reprocessAnalysis = async (req, res, next) => {
  try {
    const extraction = await service.reprocessAnalysis(req.params.id, req.user, req);
    res.json({ success: true, message: "Classification reprocessed", extraction });
  } catch (error) {
    next(error);
  }
};

exports.getExtraction = async (req, res, next) => {
  try {
    const extraction = await service.getExtraction(req.params.id, req.user);
    res.json({ success: true, extraction });
  } catch (error) {
    next(error);
  }
};

exports.getExtractionByDocument = async (req, res, next) => {
  try {
    const extraction = await service.getExtractionByDocument(req.params.documentId, req.user);
    res.json({ success: true, extraction });
  } catch (error) {
    next(error);
  }
};

exports.approveExtraction = async (req, res, next) => {
  try {
    const extraction = await service.approveExtraction(req.params.id, reviewFieldDto(req.body), req.user, req);
    res.json({ success: true, message: "Extraction approved", extraction });
  } catch (error) {
    next(error);
  }
};

exports.rejectExtraction = async (req, res, next) => {
  try {
    const extraction = await service.rejectExtraction(req.params.id, reviewFieldDto(req.body), req.user, req);
    res.json({ success: true, message: "Extraction rejected", extraction });
  } catch (error) {
    next(error);
  }
};

exports.editField = async (req, res, next) => {
  try {
    const extraction = await service.editField(req.params.id, reviewFieldDto(req.body), req.user, req);
    res.json({ success: true, message: "Extraction field updated", extraction });
  } catch (error) {
    next(error);
  }
};

exports.overrideClassification = async (req, res, next) => {
  try {
    const extraction = await service.overrideExtractionClassification(req.params.id, req.body, req.user, req);
    res.json({ success: true, message: "Document classification updated", extraction });
  } catch (error) {
    next(error);
  }
};

exports.reprocessExtraction = async (req, res, next) => {
  try {
    const extraction = await service.reprocessExtraction(req.params.id, req.user, req);
    res.json({ success: true, message: "Extraction reprocessed", extraction });
  } catch (error) {
    next(error);
  }
};

exports.confidenceScores = async (req, res, next) => {
  try {
    const extraction = await service.getExtraction(req.params.id, req.user);
    res.json({
      success: true,
      confidence: extraction.confidence,
      confidenceBand: extraction.confidenceBand,
      fields: extraction.extractedData.map((field) => ({
        id: field._id,
        key: field.key,
        label: field.label,
        confidence: field.confidence,
        reviewStatus: field.reviewStatus,
      })),
    });
  } catch (error) {
    next(error);
  }
};

exports.evidenceCategories = async (req, res) => {
  res.json({ success: true, categories: EVIDENCE_CATEGORIES });
};

exports.questionnairePrefill = async (req, res, next) => {
  try {
    const extraction = await service.getExtraction(req.params.id, req.user);
    res.json({ success: true, prefill: extraction.questionnairePrefill || [] });
  } catch (error) {
    next(error);
  }
};

exports.casePrefillSummary = async (req, res, next) => {
  try {
    const summary = await service.prefillSummaryForCase(req.params.caseId, req.user);
    res.json({ success: true, ...summary });
  } catch (error) {
    next(error);
  }
};

exports.reviewMasterDataField = async (req, res, next) => {
  try {
    const entry = await service.reviewMasterDataField(req.params.caseId, req.params.prefillId, req.params.action, req.body, req.user, req);
    res.json({ success: true, message: `Field ${req.params.action}ed`, entry });
  } catch (error) {
    next(error);
  }
};
