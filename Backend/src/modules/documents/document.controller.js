const Document = require("../../models/Document");
const Case = require("../../models/Case");
const documentService = require("./document.service");
const evidenceService = require("./evidence.service");
const caseService = require("../cases/case.service");
const workflowService = require("./document.workflow.service");
const documentIntelligenceQueue = require("../document-intelligence/queues/document-intelligence.queue");

async function findAccessibleDocument(id, user) {
  const document = await documentService.populateDocumentQuery(Document.findById(id));
  if (!document || document.deletedAt) {
    const error = new Error("Document not found");
    error.statusCode = 404;
    throw error;
  }
  if (!(await documentService.canAccessDocument(user, document))) {
    const error = new Error("You do not have permission to access this document");
    error.statusCode = 403;
    throw error;
  }
  return document;
}

function normalizeReviewStatus(body) {
  return body.reviewStatus || body.status;
}

function enqueueDocumentIntelligence(document, user, req) {
  documentIntelligenceQueue.enqueue({
    documentId: document._id,
    user,
    reqMeta: { ip: req?.ip, userAgent: req?.headers?.["user-agent"] },
  });
}

exports.getDocuments = async (req, res, next) => {
  try {
    const result = await documentService.listDocuments(req.query, req.user);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

exports.getFolders = async (req, res, next) => {
  try {
    const folders = await documentService.getFolders(req.query, req.user);
    res.json({ success: true, count: folders.length, folders });
  } catch (error) {
    next(error);
  }
};

exports.getMyDocuments = async (req, res, next) => {
  try {
    const filter = await documentService.buildDocumentFilter({ ...req.query, userId: req.user._id }, req.user);
    const documents = await Document.find(filter).sort({ category: 1, createdAt: -1 });
    res.json(documents.map((document) => documentService.sanitizeDocumentForUser(document, req.user)));
  } catch (error) {
    next(error);
  }
};

exports.getUserDocuments = async (req, res, next) => {
  try {
    const filter = await documentService.buildDocumentFilter({ ...req.query, userId: req.params.userId }, req.user);
    const documents = await Document.find(filter).sort({ category: 1, createdAt: -1 });
    res.json(documents.map((document) => documentService.sanitizeDocumentForUser(document, req.user)));
  } catch (error) {
    next(error);
  }
};

exports.getDocument = async (req, res, next) => {
  try {
    const document = await findAccessibleDocument(req.params.id || req.params.docId, req.user);
    res.json({ success: true, document: documentService.sanitizeDocumentForUser(document, req.user) });
  } catch (error) {
    next(error);
  }
};

exports.uploadDocument = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
    const targetUserId = req.params.userId || req.body.userId || req.body.user || req.user._id;
    if (!documentService.canModifyDocument(req.user) && req.user._id.toString() !== targetUserId.toString()) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    let caseId = req.body.caseId;
    if (!caseId && req.path.includes("/me") && ["client", "user"].includes(req.user.role)) {
      const activeCase = await Case.findOne({
        ...caseService.buildCaseFilter({}, req.user),
        status: { $nin: ["closed", "archived", "cancelled", "rejected"] },
      }).sort({ createdAt: -1 }).select("_id");
      caseId = activeCase?._id;
    }

    const body = {
      ...req.body,
      caseId,
      user: targetUserId,
      legacySource: req.body.legacySource || (req.params.userId || req.path.includes("/me") ? "BAIS" : "shared"),
    };
    const document = await documentService.createDocumentFromFile({ file: req.file, body, user: req.user, req });
    if (document.$locals.wasDuplicate) {
      return res.status(200).json({ success: true, duplicate: true, message: "Document already uploaded", document });
    }
    await workflowService.documentUploaded(document, req.user);
    await documentService.writeAuditLog("upload", document, req.user, body, req);
    enqueueDocumentIntelligence(document, req.user, req);
    res.status(201).json({ success: true, message: "Document uploaded", document });
  } catch (error) {
    next(error);
  }
};

exports.createDocument = async (req, res, next) => {
  try {
    if (req.file) return exports.uploadDocument(req, res, next);
    const document = await Document.create({
      ...req.body,
      user: req.body.user || req.body.userId || req.user._id,
      uploadedByUser: req.user._id,
      uploadedBy: req.body.uploadedBy || documentService.uploadedByLabel(req.user),
      legacySource: req.body.legacySource || "INSZoom",
    });
    documentService.addAuditEntry(document, "create_metadata", req.user, req.body, req);
    await document.save();
    await workflowService.documentUploaded(document, req.user);
    await documentService.writeAuditLog("create", document, req.user, req.body, req);
    res.status(201).json({ success: true, document });
  } catch (error) {
    next(error);
  }
};

exports.updateDocument = async (req, res, next) => {
  try {
    const document = await findAccessibleDocument(req.params.id, req.user);
    if (!documentService.canModifyDocument(req.user)) {
      return res.status(403).json({ success: false, message: "You do not have permission to update documents" });
    }
    const allowedFields = [
      "category",
      "documentType",
      "description",
      "isRequired",
      "isEvidence",
      "evidenceCriteria",
      "aiExtractionStatus",
      "aiExtractedData",
      "extractionConfidence",
      "clientPortalId",
      "companyId",
      "teamId",
      "client",
      "beneficiary",
      "folderPath",
      "folderName",
      "tags",
      "requestStatus",
      "requestDueDate",
      "missingReason",
      "expiryDate",
      "issuedDate",
      "issuingAuthority",
      "documentNumber",
      "metadata",
      "ocr",
      "validation",
    ];
    const changes = {};
    allowedFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        changes[field] = { from: document[field], to: req.body[field] };
        document[field] = req.body[field];
      }
    });
    documentService.addAuditEntry(document, "update", req.user, changes, req);
    await document.save();
    await documentService.writeAuditLog("update", document, req.user, changes, req);
    res.json({ success: true, document });
  } catch (error) {
    next(error);
  }
};

exports.bulkUpload = async (req, res, next) => {
  try {
    if (!req.files?.length) return res.status(400).json({ success: false, message: "No files uploaded" });
    const documents = [];
    for (const file of req.files) {
      const document = await documentService.createDocumentFromFile({ file, body: req.body, user: req.user, req });
      if (document.$locals.wasDuplicate) {
        documents.push(document);
        continue;
      }
      await workflowService.documentUploaded(document, req.user);
      await documentService.writeAuditLog("bulk_upload", document, req.user, req.body, req);
      enqueueDocumentIntelligence(document, req.user, req);
      documents.push(document);
    }
    res.status(201).json({ success: true, count: documents.length, documents });
  } catch (error) {
    next(error);
  }
};

exports.createUploadSession = async (req, res, next) => {
  try {
    const session = await documentService.createUploadSession(req.body, req.user);
    res.status(201).json({ success: true, session });
  } catch (error) {
    next(error);
  }
};

exports.getUploadSession = async (req, res, next) => {
  try {
    const session = await documentService.assertUploadSessionAccess(req.params.uploadId, req.user);
    res.json({ success: true, session });
  } catch (error) {
    next(error);
  }
};

exports.uploadChunk = async (req, res, next) => {
  try {
    const session = await documentService.storeUploadChunk(req.params.uploadId, req.params.chunkIndex, req.file, req.user);
    res.json({ success: true, session });
  } catch (error) {
    next(error);
  }
};

exports.completeUploadSession = async (req, res, next) => {
  try {
    const result = await documentService.completeUploadSession(req.params.uploadId, req.user, req);
    if (!result.duplicate) {
      await workflowService.documentUploaded(result.document, req.user);
      await documentService.writeAuditLog("resumable_upload", result.document, req.user, { uploadId: req.params.uploadId }, req);
      enqueueDocumentIntelligence(result.document, req.user, req);
    }
    res.status(result.duplicate ? 200 : 201).json({
      success: true,
      duplicate: result.duplicate,
      message: result.duplicate ? "Document already uploaded" : "Document uploaded",
      document: result.document,
      session: result.session,
    });
  } catch (error) {
    next(error);
  }
};

exports.cancelUploadSession = async (req, res, next) => {
  try {
    const session = await documentService.cancelUploadSession(req.params.uploadId, req.user);
    res.json({ success: true, session });
  } catch (error) {
    next(error);
  }
};

exports.addVersion = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
    const document = await findAccessibleDocument(req.params.id, req.user);
    // document.user is populated (see populateDocumentQuery) — compare its
    // _id, not the populated sub-document itself.
    const ownerId = document.user?._id || document.user;
    if (!documentService.canModifyDocument(req.user) && String(req.user._id) !== String(ownerId || "")) {
      return res.status(403).json({ success: false, message: "You do not have permission to version this document" });
    }
    const updated = await documentService.addDocumentVersion(document, req.file, req.user, req, req.body.changeReason);
    await workflowService.documentUploaded(updated, req.user);
    await documentService.writeAuditLog("new_version", updated, req.user, { version: updated.currentVersion }, req);
    res.status(201).json({ success: true, message: "Document version uploaded", document: updated });
  } catch (error) {
    next(error);
  }
};

exports.reviewDocument = async (req, res, next) => {
  try {
    const document = await findAccessibleDocument(req.params.id || req.params.docId, req.user);
    if (!documentService.canReviewDocument(req.user)) {
      return res.status(403).json({ success: false, message: "You do not have permission to review documents" });
    }
    const reviewStatus = normalizeReviewStatus(req.body);
    document.reviewStatus = reviewStatus;
    document.status = reviewStatus === "pending" ? "under_review" : reviewStatus;
    document.reviewNotes = req.body.reviewNotes || req.body.adminNotes;
    document.adminNotes = req.body.adminNotes || req.body.reviewNotes;
    document.reviewedBy = req.user._id;
    document.reviewedAt = new Date();
    if (req.body.isEvidence !== undefined) document.isEvidence = req.body.isEvidence;
    if (req.body.evidenceCriteria) document.evidenceCriteria = req.body.evidenceCriteria;
    documentService.addAuditEntry(document, "review", req.user, req.body, req);
    await document.save();
    await workflowService.documentReviewed(document, req.user);
    await documentService.writeAuditLog("review", document, req.user, req.body, req);
    res.json({ success: true, message: "Document reviewed", document });
  } catch (error) {
    next(error);
  }
};

exports.deleteDocument = async (req, res, next) => {
  try {
    const id = req.params.id || req.params.docId;
    const document = await findAccessibleDocument(id, req.user);
    // document.user is the case-context "owner" for organizing/storage
    // purposes (e.g. the beneficiary on an employer-sponsored case) — it is
    // NOT necessarily who actually uploaded the file. An employer filling a
    // checklist on an employee's behalf uploads documents that are correctly
    // organized under the employee (document.user) but must still be
    // removable by the employer who uploaded them (document.uploadedByUser).
    // findAccessibleDocument populates both refs (populateDocumentQuery), so
    // each is a full user sub-document here, not a bare ObjectId — pull its
    // _id back out before comparing (a raw String() on a populated Mongoose
    // document does not yield the id and always mismatches).
    const isOwnerOrUploader = [document.user, document.uploadedByUser].some((ref) => {
      const refId = ref?._id || ref;
      return refId && String(refId) === String(req.user._id);
    });
    const canDeleteOwn = isOwnerOrUploader && !["approved"].includes(document.reviewStatus);
    if (!documentService.canModifyDocument(req.user) && !canDeleteOwn) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    document.deletedAt = new Date();
    document.deletedBy = req.user._id;
    documentService.addAuditEntry(document, "delete", req.user, {}, req);
    await document.save();
    // Symmetric with the upload-time sync in createDocumentFromFile — un-answer
    // any questionnaire file-question this document was synced onto.
    await require("../questionnaires/questionnaire.service").removeFileAnswerForDocument(document).catch(() => null);
    await workflowService.documentDeleted(document, req.user);
    await documentService.writeAuditLog("delete", document, req.user, {}, req);
    res.json({ success: true, message: "Document deleted successfully" });
  } catch (error) {
    next(error);
  }
};

exports.restoreDocument = async (req, res, next) => {
  try {
    const document = await documentService.populateDocumentQuery(Document.findById(req.params.id));
    if (!document?.deletedAt) return res.status(404).json({ success: false, message: "Deleted document not found" });
    if (!documentService.canModifyDocument(req.user)) {
      return res.status(403).json({ success: false, message: "You do not have permission to restore documents" });
    }
    document.deletedAt = undefined;
    document.deletedBy = undefined;
    documentService.addAuditEntry(document, "restore", req.user, {}, req);
    await document.save();
    await workflowService.documentRestored(document, req.user);
    await documentService.writeAuditLog("restore", document, req.user, {}, req);
    res.json({ success: true, message: "Document restored", document });
  } catch (error) {
    next(error);
  }
};

exports.downloadDocument = async (req, res, next) => {
  try {
    const document = await findAccessibleDocument(req.params.id || req.params.docId, req.user);
    const buffer = await documentService.readDocumentBuffer(document);
    res.setHeader("Content-Type", document.mimeType || document.fileType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${document.originalName || document.originalFileName || document.fileName}"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};

exports.previewDocument = async (req, res, next) => {
  try {
    const document = await findAccessibleDocument(req.params.id || req.params.docId, req.user);
    const buffer = await documentService.readDocumentBuffer(document);
    res.setHeader("Content-Type", document.mimeType || document.fileType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${document.originalName || document.originalFileName || document.fileName}"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};

exports.bulkDownload = async (req, res, next) => {
  try {
    const ids = req.body.documentIds || req.body.ids || [];
    const documents = [];
    for (const id of ids) {
      const document = await findAccessibleDocument(id, req.user);
      documents.push({
        id: document._id,
        originalName: document.originalName || document.originalFileName,
        documentType: document.documentType,
        downloadUrl: `/api/documents/${document._id}/download`,
        previewUrl: `/api/documents/${document._id}/preview`,
        storageProvider: document.storageProvider,
      });
    }
    res.json({ success: true, count: documents.length, documents });
  } catch (error) {
    next(error);
  }
};

exports.getDocumentVersions = async (req, res, next) => {
  try {
    const document = await findAccessibleDocument(req.params.id, req.user);
    res.json({ success: true, versions: document.versions || [] });
  } catch (error) {
    next(error);
  }
};

exports.restoreVersion = async (req, res, next) => {
  try {
    const document = await findAccessibleDocument(req.params.id, req.user);
    if (!documentService.canModifyDocument(req.user)) {
      return res.status(403).json({ success: false, message: "You do not have permission to restore document versions" });
    }
    const updated = await documentService.restoreDocumentVersion(document, req.params.version, req.user, req, req.body.reason);
    await workflowService.documentUploaded(updated, req.user);
    enqueueDocumentIntelligence(updated, req.user, req);
    res.json({ success: true, message: "Document version restored", document: updated });
  } catch (error) {
    next(error);
  }
};

exports.linkEvidence = async (req, res, next) => {
  try {
    const document = await findAccessibleDocument(req.params.id, req.user);
    if (!documentService.canReviewDocument(req.user)) {
      return res.status(403).json({ success: false, message: "You do not have permission to manage evidence" });
    }
    const updated = await documentService.linkEvidence(document, req.body, req.user, req);
    res.json({ success: true, message: "Evidence association saved", document: updated });
  } catch (error) {
    next(error);
  }
};

exports.classifyEvidence = async (req, res, next) => {
  try {
    const document = await findAccessibleDocument(req.params.id, req.user);
    if (!documentService.canReviewDocument(req.user)) {
      return res.status(403).json({ success: false, message: "You do not have permission to classify evidence" });
    }
    const result = await evidenceService.classifyDocument(document, req.user, req);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

exports.getCaseEvidence = async (req, res, next) => {
  try {
    const evidence = await evidenceService.caseEvidenceSummary(req.params.caseId, req.user);
    res.json({ success: true, evidence });
  } catch (error) {
    next(error);
  }
};

exports.addReviewComment = async (req, res, next) => {
  try {
    const document = await findAccessibleDocument(req.params.id, req.user);
    if (!documentService.canReviewDocument(req.user)) {
      return res.status(403).json({ success: false, message: "You do not have permission to comment on document reviews" });
    }
    const updated = await documentService.addReviewComment(document, req.body, req.user, req);
    res.status(201).json({ success: true, message: "Review comment added", document: updated });
  } catch (error) {
    next(error);
  }
};

exports.requestDocument = async (req, res, next) => {
  try {
    const document = await documentService.requestDocument(req.body, req.user, req);
    res.status(201).json({ success: true, message: "Document requested", document });
  } catch (error) {
    next(error);
  }
};

exports.getMissingDocuments = async (req, res, next) => {
  try {
    const result = await documentService.listDocuments({ ...req.query, missing: true }, req.user);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

exports.shareDocument = async (req, res, next) => {
  try {
    const document = await findAccessibleDocument(req.params.id, req.user);
    if (!documentService.canModifyDocument(req.user)) return res.status(403).json({ success: false, message: "You do not have permission to share documents" });
    const updated = await documentService.shareDocument(document, req.body, req.user, req);
    res.json({ success: true, document: updated });
  } catch (error) {
    next(error);
  }
};

exports.updateSignature = async (req, res, next) => {
  try {
    const document = await findAccessibleDocument(req.params.id, req.user);
    if (!documentService.canModifyDocument(req.user)) return res.status(403).json({ success: false, message: "You do not have permission to update signatures" });
    const updated = await documentService.updateSignature(document, req.body, req.user, req);
    res.json({ success: true, document: updated });
  } catch (error) {
    next(error);
  }
};

exports.bulkActions = async (req, res, next) => {
  try {
    const result = await documentService.bulkUpdateDocuments(req.body.documentIds || req.body.ids, req.body.action, req.body, req.user, req);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};
