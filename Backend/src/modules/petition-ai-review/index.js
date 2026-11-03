// Assembly of Petition AI Review: the real dependencies, the worker started by server.js, and the upload trigger.
//
//   startPetitionAiReview()  - server start-up. Does nothing (returns null) unless PETITION_AI_REVIEW=on. Never throws.
//   onPetitionUploaded(...)  - called by documents/document.service.js right after a petition upload is stored. Returns at once (the scan is
//                              queued on a later tick, after the upload response) and can never throw, delay or change the upload.
const { readConfig, resolveApiKey } = require("./config");
const logger = require("../../utils/logger");

const PETITION_DOCUMENT_TYPE = "petition_manual_upload";
let handle = null;

function buildRunner({ scanService, shouldStop }) {
  const { createScanRunner } = require("./scanRunner");
  const { PdfSlicer } = require("./pdfSlicer");
  const { createGeminiCaller } = require("./petitionGemini");
  const { pickFallbackProvider, createFallbackCaller } = require("./fallbackProvider");
  const { loadCaseFacts } = require("./caseFacts");
  const { loadRules } = require("./rules");
  const Document = require("../../models/Document");
  const config = readConfig();
  return createScanRunner({
    scanService,
    config,
    logger,
    shouldStop,
    loadDocument: (id) => Document.findById(id).select("_id documentType storageKey filePath deletedAt originalName caseId").lean(),
    readBuffer: (document) => require("../documents/document.service").readDocumentBuffer(document),
    openReader: (buffer) => PdfSlicer.open(buffer),
    loadFacts: (caseId) => loadCaseFacts(caseId),
    loadRules: () => loadRules(),
    createCaller: () => {
      const apiKey = resolveApiKey();
      return apiKey ? createGeminiCaller({ config: readConfig(), apiKey }) : null;
    },
    createFallback: () => createFallbackCaller({ provider: pickFallbackProvider(), maxOutputTokens: config.maxOutputTokens }),
  });
}

function startPetitionAiReview() {
  try {
    if (!readConfig().enabled) {
      logger.info("petition_ai_review_off", { hint: "set PETITION_AI_REVIEW=on to scan uploaded petitions" });
      return null;
    }
    const { createScanService } = require("./scanService");
    const { createScanWorker } = require("./worker");
    const scanService = createScanService();
    let worker = null;
    const runScan = buildRunner({ scanService, shouldStop: () => Boolean(worker?.isStopping()) });
    worker = createScanWorker({ scanService, runScan, logger });
    worker.start();
    handle = { worker, scanService, stop: () => worker.stop() };
    return handle;
  } catch (error) {
    logger.error("petition_ai_review_not_started", { error: error?.message });
    return null;
  }
}

/** Upload hook. Synchronous, never throws; the scan is queued on a later tick. */
function onPetitionUploaded({ document, caseData, user } = {}) {
  try {
    if (!handle || !document?._id || document.documentType !== PETITION_DOCUMENT_TYPE || document.$locals?.wasDuplicate) return false;
    const job = {
      caseId: caseData?._id || document.caseId,
      documentId: document._id,
      documentName: document.originalName || document.originalFileName || "",
      requestedBy: user?._id || null,
    };
    const tick = setImmediate(() => {
      Promise.resolve()
        .then(() => handle.scanService.enqueue({ ...job, trigger: "upload", batchSize: readConfig().pagesPerCall }))
        .then((result) => { if (result?.created) handle.worker.kick(); })
        .catch((error) => logger.error("petition_ai_enqueue_failed", { documentId: String(job.documentId), error: error?.message }));
    });
    tick.unref?.();
    return true;
  } catch (_error) {
    return false;
  }
}

module.exports = { startPetitionAiReview, onPetitionUploaded, getHandle: () => handle, PETITION_DOCUMENT_TYPE, _setHandleForTests: (value) => { handle = value; } };
