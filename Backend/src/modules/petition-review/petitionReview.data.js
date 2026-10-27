// Persistence of the petition review feature behind plain functions, so petitionReview.service.js can be tested with a small fake. Mongoose only; no business rules here.
const Case = require("../../models/Case");
const User = require("../../models/User");
const Document = require("../../models/Document");
const PetitionReview = require("../../models/PetitionReview");
const PetitionFeedbackMessage = require("../../models/PetitionFeedbackMessage");
const { PETITION_DOCUMENT_TYPE } = require("./petitionGate");

const CASE_FIELDS = "caseNumber caseId clientName clientEmail visaType visaCategory user parentCase caseStructure caseRole employerUser petitionerUser assignedCaseManager additionalCaseManagers primaryOwner assignedTeamLead attorneyAccess";
const DOC_FIELDS = "caseId documentType originalName originalFileName fileName mimeType fileType storageKey filePath deletedAt createdAt";
const MESSAGE_FIELDS = "caseId documentId authorId authorName side body readBy createdAt";

module.exports = {
  PETITION_DOCUMENT_TYPE,
  getCase: (id) => Case.findById(id).select(CASE_FIELDS).lean(),
  getUser: (id) => User.findById(id).select("name displayName email role isActive").lean(),
  getDocument: (id) => Document.findById(id).select(DOC_FIELDS).lean(),
  listPetitionDocuments: (caseId) => Document.find({ caseId, documentType: PETITION_DOCUMENT_TYPE, deletedAt: { $exists: false } }).select(DOC_FIELDS).sort({ createdAt: -1 }).lean(),
  readDocumentBuffer: (document) => require("../documents/document.service").readDocumentBuffer(document),

  getReview: (documentId) => PetitionReview.findOne({ documentId }).lean(),
  getReviews: (documentIds) => PetitionReview.find({ documentId: { $in: documentIds } }).lean(),
  ensureReview: async (documentId, caseId) => {
    await PetitionReview.updateOne({ documentId }, { $setOnInsert: { caseId, documentId, attorneyReview: {}, clientReview: {} } }, { upsert: true });
  },
  release: async (documentId, caseId, which, { sentBy, note, at }) => {
    await PetitionReview.updateOne(
      { documentId },
      {
        $setOnInsert: { caseId, documentId },
        $set: { [`${which}.sentAt`]: at, [`${which}.sentBy`]: sentBy, [`${which}.note`]: note || "" },
        $inc: { [`${which}.count`]: 1 },
      },
      { upsert: true }
    );
    return PetitionReview.findOne({ documentId }).lean();
  },
  // true for exactly ONE caller per petition (an atomic claim), so the first-feedback e-mail can never go out twice
  claimFirstFeedbackNotice: async (documentId, at) => {
    const result = await PetitionReview.updateOne({ documentId, clientFeedbackNotifiedAt: null }, { $set: { clientFeedbackNotifiedAt: at } });
    return (result.modifiedCount ?? result.nModified ?? 0) > 0;
  },
  releasedToClientForCases: (caseIds) => PetitionReview.find({ caseId: { $in: caseIds }, "clientReview.sentAt": { $ne: null } }).lean(),

  casesOfUser: async (userId) => {
    const own = await Case.find({ $or: [{ user: userId }, { employerUser: userId }, { petitionerUser: userId }] }).select(CASE_FIELDS).lean();
    const children = own.length ? await Case.find({ parentCase: { $in: own.map((row) => row._id) } }).select(CASE_FIELDS).lean() : [];
    const seen = new Set();
    return [...own, ...children].filter((row) => (seen.has(String(row._id)) ? false : seen.add(String(row._id))));
  },
  getCases: (ids) => Case.find({ _id: { $in: ids } }).select(CASE_FIELDS).lean(),

  listMessages: async (documentId, { limit, before } = {}) => {
    const filter = { documentId };
    if (before) filter.createdAt = { $lt: before };
    const rows = await PetitionFeedbackMessage.find(filter).select(MESSAGE_FIELDS).sort({ createdAt: -1 }).limit(limit).lean();
    return rows.reverse();
  },
  recentMessages: async (documentIds, n) => {
    const entries = await Promise.all(documentIds.map(async (id) => [String(id), (await PetitionFeedbackMessage.find({ documentId: id }).select(MESSAGE_FIELDS).sort({ createdAt: -1 }).limit(n).lean()).reverse()]));
    return new Map(entries);
  },
  countMessages: async (documentIds) => {
    const rows = await PetitionFeedbackMessage.aggregate([{ $match: { documentId: { $in: documentIds } } }, { $group: { _id: "$documentId", count: { $sum: 1 } } }]);
    return new Map(rows.map((row) => [String(row._id), row.count]));
  },
  countUnread: async (documentIds, userId) => {
    const rows = await PetitionFeedbackMessage.aggregate([
      { $match: { documentId: { $in: documentIds }, authorId: { $ne: userId }, readBy: { $ne: userId } } },
      { $group: { _id: "$documentId", count: { $sum: 1 } } },
    ]);
    return new Map(rows.map((row) => [String(row._id), row.count]));
  },
  findMessageByClientId: (documentId, authorId, clientMessageId) => PetitionFeedbackMessage.findOne({ documentId, authorId, clientMessageId }).select(MESSAGE_FIELDS).lean(),
  insertMessage: async (data) => (await PetitionFeedbackMessage.create({ ...data, readBy: [data.authorId] })).toObject(),
  markRead: (documentId, userId) => PetitionFeedbackMessage.updateMany({ documentId, readBy: { $ne: userId } }, { $addToSet: { readBy: userId } }),
};
