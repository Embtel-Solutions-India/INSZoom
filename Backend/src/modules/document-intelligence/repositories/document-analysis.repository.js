const DocumentAnalysis = require("../../../models/DocumentAnalysis");

function populate(query) {
  return query.populate([
    { path: "documentId", select: "originalName originalFileName fileName documentType category reviewStatus uploadDate caseId user beneficiary" },
    { path: "extractionId", select: "documentType confidence processingStatus reviewStatus status" },
    { path: "caseId", select: "caseId caseNumber clientName clientEmail visaType user beneficiary assignedCaseManager assignedTeamLead" },
    { path: "user", select: "name displayName email role" },
    { path: "beneficiary", select: "fullName email visaType passportNumber nationality" },
    { path: "reviewedBy", select: "name displayName email role" },
  ]);
}

async function upsertForDocument(document, changes = {}) {
  return DocumentAnalysis.findOneAndUpdate(
    { documentId: document._id },
    {
      $set: {
        documentId: document._id,
        caseId: document.caseId,
        user: document.user,
        beneficiary: document.beneficiary,
        client: document.client,
        ...changes,
      },
      $setOnInsert: { events: [] },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

async function findById(id) {
  return populate(DocumentAnalysis.findById(id));
}

async function findByDocument(documentId) {
  return populate(DocumentAnalysis.findOne({ documentId }));
}

async function list(query = {}) {
  const page = Math.max(Number(query.page || 1), 1);
  const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
  const filter = {};
  if (query.caseId) filter.caseId = query.caseId;
  if (query.documentId) filter.documentId = query.documentId;
  if (query.documentType) filter.documentType = query.documentType;
  if (query.processingStatus) filter.processingStatus = query.processingStatus;
  if (query.reviewStatus) filter.reviewStatus = query.reviewStatus;
  const [items, total] = await Promise.all([
    populate(DocumentAnalysis.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit)),
    DocumentAnalysis.countDocuments(filter),
  ]);
  return { items, analyses: items, count: items.length, total, pagination: { page, limit, pages: Math.ceil(total / limit) || 1 } };
}

module.exports = {
  findByDocument,
  findById,
  list,
  upsertForDocument,
};
