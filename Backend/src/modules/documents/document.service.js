const AuditLog = require("../../models/AuditLog");
const Beneficiary = require("../../models/Beneficiary");
const Case = require("../../models/Case");
const Client = require("../../models/Client");
const Document = require("../../models/Document");
const DocumentUploadSession = require("../../models/DocumentUploadSession");
const crypto = require("crypto");
const fs = require("fs").promises;
const path = require("path");
const { normalizeRole } = require("../authorization/roleHierarchy");
const caseService = require("../cases/case.service");
const participantService = require("../cases/case-participant.service");
const RequestManagementService = require("../case-collaboration/services/RequestManagementService");
const TimelineService = require("../case-collaboration/services/TimelineService");
const storageService = require("../uploads/storage.service");
const fileSecurityService = require("../uploads/file-security.service");

const REVIEW_ROLES = ["super_admin", "admin", "case_manager", "reviewer"];
const STAFF_ROLES = ["super_admin", "admin", "team_lead", "case_manager", "paralegal", "reviewer"];
const MIN_CHUNK_SIZE = 256 * 1024;
const DEFAULT_CHUNK_SIZE = Number(process.env.DOCUMENT_UPLOAD_CHUNK_SIZE_BYTES || 5 * 1024 * 1024);
const MAX_UPLOAD_SIZE = Number(process.env.MAX_DOCUMENT_UPLOAD_SIZE_BYTES || 250 * 1024 * 1024);
const UPLOAD_SESSION_TTL_MS = Number(process.env.DOCUMENT_UPLOAD_SESSION_TTL_MS || 24 * 60 * 60 * 1000);

function sameId(left, right) {
  const leftId = left?._id || left;
  const rightId = right?._id || right;
  return leftId && rightId && leftId.toString() === rightId.toString();
}

function roleOf(user) {
  return normalizeRole(user?.role);
}

function canReviewDocument(user) {
  return REVIEW_ROLES.includes(roleOf(user));
}

function canModifyDocument(user) {
  return STAFF_ROLES.includes(roleOf(user));
}

function canViewDocumentIntelligence(user) {
  return STAFF_ROLES.includes(roleOf(user));
}

function canUploadForCase(user, caseData) {
  if (!user || !caseData || !caseService.canAccessCase(user, caseData)) return false;
  const role = roleOf(user);
  const participant = participantService.participantForUser(caseData, user) || participantService.findParticipant(caseData, { participantId: user.participantId });
  if (participant) return true;
  if (["employee", "beneficiary"].includes(role)) {
    return caseService.canAccessRestrictedChildCase(user, caseData, role);
  }
  if (["client", "user"].includes(role)) return sameId(caseData.user, user._id);
  return ["case_manager", "team_lead"].includes(role);
}

async function canAccessDocument(user, document) {
  if (!user || !document) return false;
  const role = roleOf(user);
  if (["super_admin", "admin"].includes(role)) return true;
  if (sameId(document.user, user._id) || sameId(document.uploadedByUser, user._id)) return true;
  if (sameId(document.client?.user, user._id)) return true;
  if (sameId(document.beneficiary?.user, user._id)) return true;
  if ((document.shares || []).some((share) => !share.revokedAt && (!share.expiresAt || new Date(share.expiresAt) > new Date()) && (sameId(share.sharedWithUser, user._id) || share.sharedWithEmail === user.email))) return true;
  if (role === "employer" && sameId(document.companyId, user.companyId)) return true;
  if (document.caseId) {
    const caseData = document.caseId.stage ? document.caseId : await Case.findById(document.caseId);
    return caseService.canAccessCase(user, caseData);
  }
  return false;
}

async function buildDocumentFilter(query, user) {
  const filter = { deletedAt: { $exists: false } };
  if (query.caseId) filter.caseId = query.caseId;
  if (query.clientId || query.client) filter.client = query.clientId || query.client;
  if (query.beneficiaryId || query.beneficiary) filter.beneficiary = query.beneficiaryId || query.beneficiary;
  if (query.userId) filter.user = query.userId;
  if (query.companyId) filter.companyId = query.companyId;
  if (query.folderPath) filter.folderPath = query.folderPath;
  if (query.folderName) filter.folderName = query.folderName;
  if (query.clientPortalId) filter.clientPortalId = query.clientPortalId;
  if (query.documentType) filter.documentType = query.documentType;
  if (query.category) filter.category = query.category;
  if (query.reviewStatus) filter.reviewStatus = query.reviewStatus;
  if (query.requestStatus) filter.requestStatus = query.requestStatus;
  if (query.status) filter.status = query.status;
  if (query.tag) filter.tags = query.tag;
  if (query.expiringBefore) filter.expiryDate = { $lte: new Date(query.expiringBefore) };
  if (query.missing === "true" || query.missing === true) filter.requestStatus = { $in: ["requested", "missing", "overdue", "rejected"] };
  if (query.search) {
    filter.$or = [
      { originalName: { $regex: query.search, $options: "i" } },
      { originalFileName: { $regex: query.search, $options: "i" } },
      { documentType: { $regex: query.search, $options: "i" } },
      { description: { $regex: query.search, $options: "i" } },
      { tags: { $regex: query.search, $options: "i" } },
      { documentNumber: { $regex: query.search, $options: "i" } },
      { issuingAuthority: { $regex: query.search, $options: "i" } },
      { "ocr.rawText": { $regex: query.search, $options: "i" } },
      { "evidenceAssociations.formType": { $regex: query.search, $options: "i" } },
      { "evidenceAssociations.category": { $regex: query.search, $options: "i" } },
    ];
  }

  const role = roleOf(user);
  if (["super_admin", "admin"].includes(role)) return filter;
  if (query.caseId) {
    const caseData = await Case.findById(query.caseId);
    if (!caseService.canAccessCase(user, caseData)) {
      const error = new Error("You do not have permission to access documents for this case");
      error.statusCode = 403;
      throw error;
    }
    return filter;
  }
  if (role === "employer" && user.companyId) {
    filter.companyId = user.companyId;
    return filter;
  }

  const caseFilter = caseService.buildCaseFilter({}, user);
  const caseIds = await Case.find(caseFilter).distinct("_id");
  const accessOr = [{ user: user._id }, { uploadedByUser: user._id }, { "shares.sharedWithUser": user._id }, { "shares.sharedWithEmail": user.email }];
  if (caseIds.length > 0) accessOr.push({ caseId: { $in: caseIds } });
  filter.$and = [...(filter.$and || []), { $or: accessOr }];
  return filter;
}

function addAuditEntry(document, action, user, changes = {}, req) {
  document.auditHistory.push({
    action,
    performedBy: user?._id,
    performedAt: new Date(),
    changes,
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
  });
}

function addProcessingEvent(document, stage, status, details = {}) {
  document.processing = document.processing || {};
  document.processing.stage = stage;
  if (status === "processing") document.processing.status = "processing";
  if (status === "failed") document.processing.status = "failed";
  document.processing.events = document.processing.events || [];
  document.processing.events.push({
    stage,
    status,
    provider: details.provider,
    message: details.message,
    errorCode: details.errorCode,
    attempt: details.attempt || 1,
    metadata: details.metadata,
    startedAt: details.startedAt,
    completedAt: details.completedAt || (["completed", "failed"].includes(status) ? new Date() : undefined),
  });
  if (document.processing.events.length > 100) document.processing.events = document.processing.events.slice(-100);
  if (status === "failed") {
    document.processing.lastError = details.message;
    document.processing.retryable = details.retryable !== false;
  }
}

function sanitizeDocumentForUser(document, user) {
  if (!document) return document;
  if (canViewDocumentIntelligence(user)) return document;
  const output = typeof document.toObject === "function" ? document.toObject() : { ...document };
  delete output.aiExtractedData;
  if (output.ocr) {
    output.ocr = {
      provider: output.ocr.provider,
      status: output.ocr.status,
      confidence: output.ocr.confidence,
      processedAt: output.ocr.processedAt,
      error: output.ocr.error ? "Document processing failed" : undefined,
    };
  }
  if (output.metadata?.extracted) delete output.metadata.extracted;
  delete output.auditHistory;
  return output;
}

function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata === "object") return metadata || {};
  try {
    return JSON.parse(metadata);
  } catch {
    return {};
  }
}

// Coerce any category value that isn't in the Document model enum to "other"
// so unknown values from older clients or new frontend categories never cause
// a Mongoose ValidationError (which would otherwise surface as HTTP 500).
const VALID_DOCUMENT_CATEGORIES = new Set(require("../../models/Document").schema.path("category").enumValues);
function normalizeCategory(value) {
  const v = String(value || "").toLowerCase().trim();
  return VALID_DOCUMENT_CATEGORIES.has(v) ? v : "other";
}

async function writeAuditLog(action, document, user, changes, req) {
  if (!user || !document) return;
  await AuditLog.create({
    userId: user._id,
    action,
    entityType: "document",
    entityId: document._id?.toString(),
    changes,
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
    description: `${action} on document ${document.originalName || document.fileName || document._id}`,
  }).catch(() => {});
}

function uploadedByLabel(user) {
  const role = roleOf(user);
  if (["super_admin", "admin"].includes(role)) return "admin";
  if (["client", "user"].includes(role)) return "client";
  if (["employee", "beneficiary"].includes(role)) return role;
  if (["case_manager", "team_lead", "paralegal", "reviewer"].includes(role)) return role;
  return "system";
}

function resolvedDocumentOwnerId(body, context, user) {
  if (canModifyDocument(user)) return body.user || body.userId || context.user || user._id;
  return context.user || user._id;
}

async function resolveCaseContext(caseId) {
  if (!caseId) return {};
  const caseData = await Case.findById(caseId);
  if (!caseData) return {};
  return {
    caseData,
    clientPortalId: caseData.clientPortalId,
    companyId: caseData.companyId,
    teamId: caseData.teamId,
    user: caseData.user,
    client: caseData.clientProfile,
    beneficiary: caseData.beneficiary,
  };
}

async function resolveEntityContext(body = {}) {
  const context = await resolveCaseContext(body.caseId);
  if (context.caseData && body.participantId) {
    const participant = participantService.findParticipant(context.caseData, { participantId: body.participantId });
    if (participant) {
      context.participant = participant;
      context.participantId = participant._id;
      context.participantRole = participant.role;
      context.user = context.user || participant.userId;
      context.beneficiary = context.beneficiary || participant.beneficiaryId;
      context.companyId = context.companyId || participant.companyId;
      context.canonicalProfileId = participant.canonicalProfileId;
    }
  }
  if (body.beneficiary || body.beneficiaryId) {
    const beneficiary = await Beneficiary.findById(body.beneficiary || body.beneficiaryId);
    if (beneficiary) {
      context.beneficiary = beneficiary._id;
      context.client = context.client || beneficiary.client;
      context.companyId = context.companyId || beneficiary.companyId;
      context.user = context.user || beneficiary.user;
    }
  }
  if (body.client || body.clientId) {
    const client = await Client.findById(body.client || body.clientId);
    if (client) {
      context.client = client._id;
      context.beneficiary = context.beneficiary || client.beneficiary;
      context.companyId = context.companyId || client.companyId;
      context.user = context.user || client.user;
    }
  }
  return context;
}

async function linkDocumentToCaseRequests(caseData, document, user, req) {
  if (!caseData) return;
  const completedRequest = RequestManagementService.completeByDocument(caseData, document);
  if (completedRequest) {
    TimelineService.add(caseData, "request", "Document Request Updated", `${completedRequest.name} marked uploaded`, user, { requestId: completedRequest._id, documentId: document._id });
    caseService.addAuditEntry(caseData, "request_completed", "Document request completed by upload", user, { requestId: completedRequest._id, documentId: document._id }, req);
    await caseData.save();
    await TimelineService.writeAudit("REQUEST_COMPLETED", "Case", caseData._id, user, { requestId: completedRequest._id, documentId: document._id }, req);
  }
  if (document.participantId) {
    const participant = participantService.findParticipant(caseData, { participantId: document.participantId });
    if (participant && !(participant.documentIds || []).some((id) => sameId(id, document._id))) {
      participant.documentIds = [...(participant.documentIds || []), document._id];
      participant.progress = { ...(participant.progress?.toObject?.() || participant.progress || {}), documents: { lastUploadedAt: new Date(), lastDocumentType: document.documentType } };
      await caseData.save();
    }
  }
  // Bridges this upload into any assigned questionnaire's matching file-type
  // question, so calculateDetailedProgress reflects real uploads (see
  // questionnaire.service.js's syncFileAnswerFromDocument for why this exists).
  await require("../questionnaires/questionnaire.service").syncFileAnswerFromDocument(caseData, document, user, req).catch(() => null);
}

async function createDocumentFromFile({ file, body, user, req }) {
  const context = await resolveEntityContext(body);
  // body.caseId was supplied but didn't resolve to a real Case (deleted,
  // typo'd, or a non-existent id) - fail closed rather than silently
  // proceeding as if no case were specified. Omitting caseId entirely
  // (the legitimate caseless personal upload via POST /documents/me,
  // document.controller.js's uploadDocument) is unaffected - this only
  // fires when a caseId was actually given.
  if (body.caseId && !context.caseData) {
    const error = new Error("The specified case could not be found");
    error.status = 404;
    error.statusCode = 404;
    throw error;
  }
  if (context.caseData && !canUploadForCase(user, context.caseData)) {
    const error = new Error("You do not have permission to upload documents for this case");
    error.status = 403;
    error.statusCode = 403;
    throw error;
  }
  const ownerId = resolvedDocumentOwnerId(body, context, user);
  const participantId = body.participantId || context.participantId;
  const security = await fileSecurityService.inspect(file);
  const checksum = storageService.checksum(file.buffer);
  const duplicate = await Document.findOne({
    checksum,
    deletedAt: { $exists: false },
    ...(body.caseId ? { caseId: body.caseId, ...(participantId ? { participantId } : {}) } : { user: ownerId }),
  });
  if (duplicate) {
    addAuditEntry(duplicate, "duplicate_upload_detected", user, { originalName: file.originalname, checksum }, req);
    await duplicate.save();
    duplicate.$locals.wasDuplicate = true;
    return duplicate;
  }
  // Re-uploading a DIFFERENT file (different checksum, so it missed the
  // dedup check above) into the same case's checklist slot (caseId +
  // documentType) should version the existing Document rather than create a
  // second, separate row for the same requirement - see addDocumentVersion
  // below, which is otherwise only reachable via POST /:id/versions.
  if (body.caseId && body.documentType) {
    const existingSlotDocument = await Document.findOne({
      caseId: body.caseId,
      ...(participantId ? { participantId } : {}),
      documentType: body.documentType,
      deletedAt: { $exists: false },
    });
    if (existingSlotDocument) {
      const updated = await addDocumentVersion(existingSlotDocument, file, user, req, "Replaced via checklist re-upload");
      await linkDocumentToCaseRequests(context.caseData, updated, user, req);
      return updated;
    }
  }
  const key = storageService.generateDocumentKey({ caseId: body.caseId, userId: ownerId, originalName: file.originalname });
  const stored = await storageService.storeBuffer(key, file.buffer);
  const version = {
    version: 1,
    originalName: file.originalname,
    storedName: key.split("/").pop(),
    storageProvider: stored.provider,
    storageKey: stored.key,
    filePath: stored.path,
    documentUrl: stored.url,
    mimeType: file.mimetype,
    fileType: file.mimetype,
    size: file.size,
    checksum: stored.checksum,
    uploadedByUser: user._id,
    uploadedByRole: roleOf(user),
  };

  let document;
  try {
    document = await Document.create({
      ...body,
      user: ownerId,
      caseId: body.caseId,
      participantId,
      participantRole: body.participantRole || context.participantRole,
      canonicalProfileId: body.canonicalProfileId || context.canonicalProfileId,
      client: body.client || body.clientId || context.client,
      beneficiary: body.beneficiary || body.beneficiaryId || context.beneficiary,
      clientPortalId: body.clientPortalId || context.clientPortalId,
      companyId: body.companyId || context.companyId,
      teamId: body.teamId || context.teamId,
      // Normalize category so unknown values (e.g. "relationship", "travel", "general")
      // don't cause a Mongoose ValidationError that surfaces as HTTP 500
      category: normalizeCategory(body.category),
      folderPath: body.folderPath || "/",
      folderName: body.folderName,
      tags: normalizeTags(body.tags),
      originalName: file.originalname,
      originalFileName: file.originalname,
      storedName: version.storedName,
      fileName: version.storedName,
      mimeType: security.validation.detectedMime || file.mimetype,
      fileType: security.validation.detectedMime || file.mimetype,
      size: file.size,
      fileSize: file.size,
      filePath: stored.path,
      documentUrl: stored.url,
      storageProvider: stored.provider,
      storageKey: stored.key,
      checksum: stored.checksum,
      uploadedBy: body.uploadedBy || uploadedByLabel(user),
      uploadedByUser: user._id,
      expiryDate: body.expiryDate,
      issuedDate: body.issuedDate,
      issuingAuthority: body.issuingAuthority,
      documentNumber: body.documentNumber,
      metadata: normalizeMetadata(body.metadata),
      malwareScan: security.malware,
      processing: {
        stage: "stored",
        status: "pending",
        attempts: 0,
        startedAt: new Date(),
        events: [
          { stage: "virus_scan", status: "completed", provider: security.malware.provider, completedAt: security.malware.scannedAt, metadata: { limited: security.malware.limited } },
          { stage: "validated", status: "completed", completedAt: new Date(), metadata: security.validation },
          { stage: "stored", status: "completed", completedAt: new Date(), metadata: { storageProvider: stored.provider, storageKey: stored.key } },
        ],
      },
      intelligenceStatus: "uploaded",
      versions: [version],
      legacySource: body.legacySource || "shared",
    });
  } catch (error) {
    await storageService.deleteObject(stored.key).catch(() => false);
    throw error;
  }
  addAuditEntry(document, "upload", user, { storageKey: stored.key }, req);
  await document.save();
  await linkDocumentToCaseRequests(context.caseData, document, user, req);
  return document;
}

async function createDocumentMetadata({ body = {}, user, req }) {
  const context = await resolveEntityContext(body);
  if (body.caseId && !context.caseData) {
    const error = new Error("The specified case could not be found");
    error.status = 404;
    error.statusCode = 404;
    throw error;
  }
  if (context.caseData && !canUploadForCase(user, context.caseData)) {
    const error = new Error("You do not have permission to create documents for this case");
    error.status = 403;
    error.statusCode = 403;
    throw error;
  }
  const ownerId = resolvedDocumentOwnerId(body, context, user);
  const document = await Document.create({
    ...body,
    user: ownerId,
    caseId: body.caseId,
    participantId: body.participantId || context.participantId,
    participantRole: body.participantRole || context.participantRole,
    canonicalProfileId: body.canonicalProfileId || context.canonicalProfileId,
    client: body.client || body.clientId || context.client,
    beneficiary: body.beneficiary || body.beneficiaryId || context.beneficiary,
    clientPortalId: body.clientPortalId || context.clientPortalId,
    companyId: body.companyId || context.companyId,
    teamId: body.teamId || context.teamId,
    category: normalizeCategory(body.category),
    folderPath: body.folderPath || "/",
    folderName: body.folderName,
    tags: normalizeTags(body.tags),
    uploadedByUser: user._id,
    uploadedBy: body.uploadedBy || uploadedByLabel(user),
    legacySource: body.legacySource || "INSZoom",
    metadata: normalizeMetadata(body.metadata),
  });
  addAuditEntry(document, "create_metadata", user, body, req);
  await document.save();
  return document;
}

function uploadSessionChunkKey(uploadId, chunkIndex) {
  return `upload-sessions/${uploadId}/chunks/${String(chunkIndex).padStart(8, "0")}`;
}

async function assertUploadSessionAccess(uploadId, user) {
  const session = await DocumentUploadSession.findOne({ uploadId });
  if (!session) {
    const error = new Error("Upload session not found or expired");
    error.statusCode = 404;
    throw error;
  }
  if (!sameId(session.user, user?._id) && !["super_admin", "admin"].includes(roleOf(user))) {
    const error = new Error("You do not have permission to access this upload session");
    error.statusCode = 403;
    throw error;
  }
  return session;
}

async function createUploadSession(payload, user) {
  if (payload.caseId) {
    const caseData = await Case.findById(payload.caseId);
    if (!caseData) {
      const error = new Error("The specified case could not be found");
      error.statusCode = 404;
      throw error;
    }
    if (!canUploadForCase(user, caseData)) {
      const error = new Error("You do not have permission to upload documents for this case");
      error.statusCode = 403;
      throw error;
    }
  }
  const expectedSize = Number(payload.expectedSize || payload.fileSize);
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > MAX_UPLOAD_SIZE) {
    const error = new Error(`File size must be between 1 byte and ${MAX_UPLOAD_SIZE} bytes`);
    error.statusCode = 413;
    throw error;
  }
  const chunkSize = Math.max(MIN_CHUNK_SIZE, Math.min(Number(payload.chunkSize) || DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_SIZE));
  const totalChunks = Math.ceil(expectedSize / chunkSize);
  const uploadId = crypto.randomUUID();
  return DocumentUploadSession.create({
    uploadId,
    user: user._id,
    caseId: payload.caseId,
    originalName: payload.originalName,
    mimeType: payload.mimeType,
    expectedSize,
    expectedChecksum: payload.checksum,
    chunkSize,
    totalChunks,
    context: {
      caseId: payload.caseId,
      beneficiaryId: payload.beneficiaryId,
      clientId: payload.clientId,
      category: payload.category,
      documentType: payload.documentType,
      description: payload.description,
      tags: payload.tags,
      legacySource: payload.legacySource || "BAIS",
    },
    expiresAt: new Date(Date.now() + UPLOAD_SESSION_TTL_MS),
  });
}

async function storeUploadChunk(uploadId, chunkIndexValue, file, user) {
  if (!file?.buffer?.length) {
    const error = new Error("Upload chunk is empty");
    error.statusCode = 400;
    throw error;
  }
  const session = await assertUploadSessionAccess(uploadId, user);
  if (!["initiated", "uploading"].includes(session.status)) {
    const error = new Error(`Upload session cannot accept chunks while ${session.status}`);
    error.statusCode = 409;
    throw error;
  }
  const chunkIndex = Number(chunkIndexValue);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= session.totalChunks) {
    const error = new Error("Invalid upload chunk index");
    error.statusCode = 400;
    throw error;
  }
  const expectedChunkLength = chunkIndex === session.totalChunks - 1
    ? session.expectedSize - session.chunkSize * chunkIndex
    : session.chunkSize;
  if (file.buffer.length !== expectedChunkLength) {
    const error = new Error(`Chunk ${chunkIndex} has an invalid size`);
    error.statusCode = 422;
    throw error;
  }
  const incomingChecksum = storageService.checksum(file.buffer);
  const existingChecksum = session.chunkChecksums?.get(String(chunkIndex));
  if (existingChecksum) {
    if (existingChecksum !== incomingChecksum) {
      const error = new Error(`Chunk ${chunkIndex} was already uploaded with different content`);
      error.statusCode = 409;
      throw error;
    }
    return session;
  }
  await storageService.storeImmutableBuffer(uploadSessionChunkKey(uploadId, chunkIndex), file.buffer);
  session.receivedChunks.push(chunkIndex);
  session.receivedChunks.sort((left, right) => left - right);
  session.chunkChecksums.set(String(chunkIndex), incomingChecksum);
  session.receivedBytes += file.buffer.length;
  session.status = "uploading";
  session.expiresAt = new Date(Date.now() + UPLOAD_SESSION_TTL_MS);
  await session.save();
  return session;
}

async function completeUploadSession(uploadId, user, req) {
  const session = await assertUploadSessionAccess(uploadId, user);
  if (session.status === "completed" && session.finalDocument) {
    return { session, document: await Document.findById(session.finalDocument), duplicate: true };
  }
  if (!["initiated", "uploading", "failed"].includes(session.status)) {
    const error = new Error(`Upload session cannot be completed while ${session.status}`);
    error.statusCode = 409;
    throw error;
  }
  if (session.receivedChunks.length !== session.totalChunks || session.receivedBytes !== session.expectedSize) {
    const error = new Error("Upload is incomplete");
    error.statusCode = 409;
    error.details = { receivedChunks: session.receivedChunks.length, totalChunks: session.totalChunks };
    throw error;
  }
  session.status = "assembling";
  session.attempts += 1;
  await session.save();
  try {
    const chunks = [];
    for (let chunkIndex = 0; chunkIndex < session.totalChunks; chunkIndex += 1) {
      chunks.push(await storageService.readBuffer(uploadSessionChunkKey(uploadId, chunkIndex)));
    }
    const buffer = Buffer.concat(chunks);
    const checksum = storageService.checksum(buffer);
    if (buffer.length !== session.expectedSize || (session.expectedChecksum && checksum !== session.expectedChecksum)) {
      const error = new Error("Assembled file failed integrity validation");
      error.statusCode = 422;
      error.code = "UPLOAD_INTEGRITY_FAILED";
      throw error;
    }
    const document = await createDocumentFromFile({
      file: {
        buffer,
        size: buffer.length,
        originalname: session.originalName,
        mimetype: session.mimeType,
      },
      body: session.context || {},
      user,
      req,
    });
    session.status = "completed";
    session.finalDocument = document._id;
    session.lastError = undefined;
    await session.save();
    for (let chunkIndex = 0; chunkIndex < session.totalChunks; chunkIndex += 1) {
      await storageService.deleteObject(uploadSessionChunkKey(uploadId, chunkIndex)).catch(() => false);
    }
    return { session, document, duplicate: Boolean(document.$locals.wasDuplicate) };
  } catch (error) {
    session.status = "failed";
    session.lastError = error.message;
    await session.save();
    throw error;
  }
}

async function cancelUploadSession(uploadId, user) {
  const session = await assertUploadSessionAccess(uploadId, user);
  if (session.status === "completed") {
    const error = new Error("Completed uploads cannot be cancelled");
    error.statusCode = 409;
    throw error;
  }
  session.status = "cancelled";
  await session.save();
  for (const chunkIndex of session.receivedChunks) {
    await storageService.deleteObject(uploadSessionChunkKey(uploadId, chunkIndex)).catch(() => false);
  }
  return session;
}

function normalizeTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map((tag) => String(tag).trim()).filter(Boolean);
  return String(tags).split(",").map((tag) => tag.trim()).filter(Boolean);
}

function pagination(query = {}) {
  const page = Math.max(Number(query.page || 1), 1);
  const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
  return { page, limit, skip: (page - 1) * limit };
}

function sortFor(query = {}) {
  const allowed = new Set(["uploadDate", "createdAt", "updatedAt", "originalName", "documentType", "category", "reviewStatus", "requestDueDate", "expiryDate"]);
  const sortBy = allowed.has(query.sortBy) ? query.sortBy : "uploadDate";
  return { [sortBy]: query.sortOrder === "asc" ? 1 : -1 };
}

async function addDocumentVersion(document, file, user, req, changeReason) {
  const security = await fileSecurityService.inspect(file);
  const incomingChecksum = storageService.checksum(file.buffer);
  if (document.versions.some((version) => version.checksum === incomingChecksum)) {
    const error = new Error("This file version already exists");
    error.statusCode = 409;
    error.code = "DUPLICATE_DOCUMENT_VERSION";
    throw error;
  }
  const key = storageService.generateDocumentKey({ caseId: document.caseId, userId: document.user, originalName: file.originalname });
  const stored = await storageService.storeBuffer(key, file.buffer);
  const nextVersion = (document.currentVersion || document.versions.length || 1) + 1;
  const version = {
    version: nextVersion,
    originalName: file.originalname,
    storedName: key.split("/").pop(),
    storageProvider: stored.provider,
    storageKey: stored.key,
    filePath: stored.path,
    documentUrl: stored.url,
    mimeType: file.mimetype,
    fileType: file.mimetype,
    size: file.size,
    checksum: stored.checksum,
    uploadedByUser: user._id,
    uploadedByRole: roleOf(user),
    changeReason,
  };

  document.currentVersion = nextVersion;
  document.originalName = file.originalname;
  document.originalFileName = file.originalname;
  document.storedName = version.storedName;
  document.fileName = version.storedName;
  document.mimeType = file.mimetype;
  document.fileType = file.mimetype;
  document.size = file.size;
  document.fileSize = file.size;
  document.filePath = stored.path;
  document.documentUrl = stored.url;
  document.storageProvider = stored.provider;
  document.storageKey = stored.key;
  document.checksum = stored.checksum;
  document.malwareScan = security.malware;
  document.processing = {
    ...(document.processing || {}),
    stage: "stored",
    status: "pending",
    attempts: 0,
    lastError: undefined,
    retryable: true,
    startedAt: new Date(),
    completedAt: undefined,
    events: [
      ...((document.processing?.events || []).slice(-90)),
      { stage: "virus_scan", status: "completed", provider: security.malware.provider, completedAt: security.malware.scannedAt },
      { stage: "validated", status: "completed", completedAt: new Date(), metadata: security.validation },
      { stage: "stored", status: "completed", completedAt: new Date(), metadata: { version: nextVersion } },
    ],
  };
  document.status = "uploaded";
  document.reviewStatus = "pending";
  document.aiExtractionStatus = "pending";
  document.intelligenceStatus = "uploaded";
  document.uploadedByUser = user._id;
  document.uploadDate = new Date();
  document.versions.push(version);
  addAuditEntry(document, "new_version", user, { version: nextVersion, storageKey: stored.key }, req);
  await document.save();
  return document;
}

async function restoreDocumentVersion(document, versionNumber, user, req, reason) {
  const source = document.versions.find((version) => version.version === Number(versionNumber));
  if (!source) {
    const error = new Error("Document version not found");
    error.statusCode = 404;
    throw error;
  }
  const nextVersion = Math.max(document.currentVersion || 1, ...document.versions.map((version) => version.version || 0)) + 1;
  document.currentVersion = nextVersion;
  document.originalName = source.originalName;
  document.originalFileName = source.originalName;
  document.storedName = source.storedName;
  document.fileName = source.storedName;
  document.mimeType = source.mimeType;
  document.fileType = source.fileType;
  document.size = source.size;
  document.fileSize = source.size;
  document.filePath = source.filePath;
  document.documentUrl = source.documentUrl;
  document.storageProvider = source.storageProvider;
  document.storageKey = source.storageKey;
  document.checksum = source.checksum;
  document.status = "uploaded";
  document.reviewStatus = "pending";
  document.versions.push({
    version: nextVersion,
    originalName: source.originalName,
    storedName: source.storedName,
    storageProvider: source.storageProvider,
    storageKey: source.storageKey,
    filePath: source.filePath,
    documentUrl: source.documentUrl,
    mimeType: source.mimeType,
    fileType: source.fileType,
    size: source.size,
    checksum: source.checksum,
    uploadedByUser: user._id,
    uploadedByRole: roleOf(user),
    changeReason: reason || `Restored from version ${source.version}`,
  });
  addAuditEntry(document, "version_restored", user, { sourceVersion: source.version, version: nextVersion }, req);
  await document.save();
  await writeAuditLog("version_restored", document, user, { sourceVersion: source.version, version: nextVersion }, req);
  return document;
}

async function linkEvidence(document, payload, user, req) {
  const association = {
    caseId: payload.caseId || document.caseId,
    beneficiary: payload.beneficiary || payload.beneficiaryId || document.beneficiary,
    companyId: payload.companyId || document.companyId,
    caseForm: payload.caseForm || payload.caseFormId,
    formType: payload.formType,
    criterion: payload.criterion,
    category: payload.category,
    status: payload.status || "linked",
    confidence: payload.confidence,
    linkedBy: user._id,
  };
  const duplicate = (document.evidenceAssociations || []).some((item) =>
    sameId(item.caseId, association.caseId)
    && sameId(item.caseForm, association.caseForm)
    && item.formType === association.formType
    && item.criterion === association.criterion
    && item.category === association.category
  );
  if (!duplicate) document.evidenceAssociations.push(association);
  document.isEvidence = true;
  if (association.criterion) document.evidenceCriteria = [...new Set([...(document.evidenceCriteria || []), association.criterion])];
  addAuditEntry(document, "evidence_linked", user, association, req);
  await document.save();
  await writeAuditLog("evidence_linked", document, user, association, req);
  return document;
}

async function addReviewComment(document, payload, user, req) {
  const comment = {
    body: payload.body || payload.comment,
    visibility: payload.visibility || "internal",
    createdBy: user._id,
  };
  if (!comment.body?.trim()) {
    const error = new Error("Comment is required");
    error.statusCode = 400;
    throw error;
  }
  document.reviewComments.push(comment);
  addAuditEntry(document, "review_comment_added", user, { visibility: comment.visibility }, req);
  await document.save();
  await writeAuditLog("review_comment_added", document, user, { visibility: comment.visibility }, req);
  return document;
}

function populateDocumentQuery(query) {
  return query.populate([
    { path: "caseId", select: "caseNumber caseId clientName clientEmail user assignedCaseManager assignedAttorney assignedProfessor companyId teamId clientPortalId" },
    { path: "user", select: "name displayName email role" },
    { path: "client", select: "fullName email user status" },
    { path: "beneficiary", select: "fullName email user visaType status" },
    { path: "companyId", select: "name legalName status" },
    { path: "uploadedByUser", select: "name displayName email role" },
    { path: "reviewedBy", select: "name displayName email role" },
  ]);
}

async function readDocumentBuffer(document) {
  if (document.storageKey) {
    return storageService.readBuffer(document.storageKey);
  }
  if (!document.filePath) {
    const error = new Error("Document file not available in shared storage");
    error.statusCode = 404;
    throw error;
  }
  const relativePath = String(document.filePath).replace(/^[/\\]+/, "");
  const localPath = path.isAbsolute(document.filePath) ? document.filePath : path.join(process.cwd(), relativePath);
  return fs.readFile(localPath);
}

async function listDocuments(query, user) {
  const filter = await buildDocumentFilter(query, user);
  const { page, limit, skip } = pagination(query);
  const [documents, total] = await Promise.all([
    populateDocumentQuery(Document.find(filter).sort(sortFor(query)).skip(skip).limit(limit)).lean(),
    Document.countDocuments(filter),
  ]);
  return { documents: documents.map((document) => sanitizeDocumentForUser(document, user)), count: documents.length, total, pagination: { page, limit, pages: Math.ceil(total / limit) || 1 } };
}

async function getFolders(query, user) {
  const filter = await buildDocumentFilter(query, user);
  const folders = await Document.aggregate([
    { $match: filter },
    { $group: { _id: "$folderPath", folderName: { $first: "$folderName" }, count: { $sum: 1 }, updatedAt: { $max: "$updatedAt" } } },
    { $sort: { _id: 1 } },
  ]);
  return folders.map((folder) => ({ folderPath: folder._id || "/", folderName: folder.folderName || "Root", count: folder.count, updatedAt: folder.updatedAt }));
}

async function requestDocument(payload, user, req) {
  const context = await resolveEntityContext(payload);
  const document = await Document.create({
    user: payload.user || payload.userId || context.user,
    caseId: payload.caseId,
    client: payload.client || payload.clientId || context.client,
    beneficiary: payload.beneficiary || payload.beneficiaryId || context.beneficiary,
    clientPortalId: payload.clientPortalId || context.clientPortalId,
    companyId: payload.companyId || context.companyId,
    teamId: payload.teamId || context.teamId,
    category: payload.category || "other",
    documentType: payload.documentType || "other",
    description: payload.description,
    folderPath: payload.folderPath || "/",
    folderName: payload.folderName,
    tags: normalizeTags(payload.tags),
    isRequired: true,
    requestStatus: "requested",
    status: "pending",
    reviewStatus: "pending",
    requestedBy: user?._id,
    requestedAt: new Date(),
    requestDueDate: payload.dueDate || payload.requestDueDate,
    missingReason: payload.missingReason,
    uploadedBy: "system",
    uploadedByUser: user?._id,
    legacySource: payload.legacySource || "shared",
  });
  addAuditEntry(document, "request", user, payload, req);
  await document.save();
  await writeAuditLog("request", document, user, payload, req);
  return document;
}

async function shareDocument(document, payload, user, req) {
  document.shares.push({
    sharedWithUser: payload.userId || payload.sharedWithUser,
    sharedWithEmail: payload.email || payload.sharedWithEmail,
    role: payload.role || "viewer",
    expiresAt: payload.expiresAt,
    sharedBy: user?._id,
  });
  addAuditEntry(document, "share", user, payload, req);
  await document.save();
  await writeAuditLog("share", document, user, payload, req);
  return document;
}

async function updateSignature(document, payload, user, req) {
  document.signature = {
    ...(document.signature || {}),
    ...payload.signature,
    provider: payload.provider || payload.signature?.provider || document.signature?.provider || "manual",
    status: payload.status || payload.signature?.status || "requested",
    requestedBy: payload.status === "requested" || payload.signature?.status === "requested" ? user?._id : document.signature?.requestedBy,
    requestedAt: payload.status === "requested" || payload.signature?.status === "requested" ? new Date() : document.signature?.requestedAt,
    signedBy: payload.signedBy || document.signature?.signedBy,
    signedAt: payload.status === "signed" ? new Date() : document.signature?.signedAt,
  };
  addAuditEntry(document, "signature_update", user, payload, req);
  await document.save();
  await writeAuditLog("signature_update", document, user, payload, req);
  return document;
}

async function bulkUpdateDocuments(ids, action, payload, user, req) {
  const documents = await Document.find({ _id: { $in: ids || [] }, deletedAt: { $exists: false } });
  const results = [];
  for (const document of documents) {
    if (!(await canAccessDocument(user, document))) {
      results.push({ id: document._id, success: false, message: "Not authorized" });
      continue;
    }
    if (action === "delete") {
      document.deletedAt = new Date();
      document.deletedBy = user._id;
    } else if (action === "move") {
      document.folderPath = payload.folderPath || "/";
      document.folderName = payload.folderName;
    } else if (action === "tag") {
      document.tags = [...new Set([...(document.tags || []), ...normalizeTags(payload.tags)])];
    } else if (action === "review") {
      document.reviewStatus = payload.reviewStatus || payload.status || document.reviewStatus;
      document.status = document.reviewStatus === "pending" ? "under_review" : document.reviewStatus;
      document.reviewedBy = user._id;
      document.reviewedAt = new Date();
    }
    addAuditEntry(document, `bulk_${action}`, user, payload, req);
    await document.save();
    results.push({ id: document._id, success: true });
  }
  return { count: results.length, results };
}

module.exports = {
  addAuditEntry,
  addDocumentVersion,
  addProcessingEvent,
  addReviewComment,
  buildDocumentFilter,
  canUploadForCase,
  bulkUpdateDocuments,
  canAccessDocument,
  canModifyDocument,
  canViewDocumentIntelligence,
  canReviewDocument,
  cancelUploadSession,
  completeUploadSession,
  createUploadSession,
  createDocumentFromFile,
  createDocumentMetadata,
  getFolders,
  linkEvidence,
  listDocuments,
  populateDocumentQuery,
  readDocumentBuffer,
  requestDocument,
  restoreDocumentVersion,
  shareDocument,
  sortFor,
  storeUploadChunk,
  assertUploadSessionAccess,
  updateSignature,
  uploadedByLabel,
  writeAuditLog,
  sanitizeDocumentForUser,
};
