const DocumentExtraction = require("../../../models/DocumentExtraction");

function populate(query) {
  return query.populate([
    { path: "documentId", select: "originalName originalFileName fileName documentType category reviewStatus aiExtractionStatus extractionConfidence uploadDate caseId participantId participantRole user beneficiary documentUrl" },
    { path: "caseId", select: "caseId caseNumber clientName clientEmail visaType user beneficiary assignedCaseManager assignedTeamLead participants" },
    { path: "user", select: "name displayName email role" },
    { path: "beneficiary", select: "fullName email visaType passportNumber nationality" },
  ]);
}

async function findByDocument(documentId) {
  return populate(DocumentExtraction.findOne({ documentId }));
}

async function findById(id) {
  return populate(DocumentExtraction.findById(id));
}

async function upsertForDocument(document, changes = {}) {
  const payload = {
    documentId: document._id,
    caseId: document.caseId,
    participantId: document.participantId,
    participantRole: document.participantRole,
    user: document.user,
    beneficiary: document.beneficiary,
    client: document.client,
    ...changes,
  };
  return DocumentExtraction.findOneAndUpdate(
    { documentId: document._id },
    { $set: payload, $setOnInsert: { auditHistory: [], processingLogs: [] } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

async function list(query = {}) {
  const page = Math.max(Number(query.page || 1), 1);
  const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
  const filter = {};
  if (query.caseId) filter.caseId = query.caseId;
  if (query.participantId) filter.participantId = query.participantId;
  if (query.documentId) filter.documentId = query.documentId;
  if (query.documentType) filter.documentType = query.documentType;
  if (query.status) filter.status = query.status;
  if (query.reviewStatus) filter.reviewStatus = query.reviewStatus;
  if (query.confidenceBand) filter.confidenceBand = query.confidenceBand;
  const [items, total] = await Promise.all([
    populate(DocumentExtraction.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit)),
    DocumentExtraction.countDocuments(filter),
  ]);
  return { items, total, count: items.length, pagination: { page, limit, pages: Math.ceil(total / limit) || 1 } };
}

async function reviewQueue(query = {}) {
  return list({
    ...query,
    reviewStatus: query.reviewStatus || undefined,
  });
}

module.exports = {
  findByDocument,
  findById,
  list,
  reviewQueue,
  upsertForDocument,
};
