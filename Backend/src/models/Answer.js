const mongoose = require("mongoose");

const answerAuditSchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    changes: mongoose.Schema.Types.Mixed,
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    performedAt: { type: Date, default: Date.now },
    ipAddress: String,
    userAgent: String,
  },
  { _id: true }
);

const uploadedFileSchema = new mongoose.Schema(
  {
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document" },
    originalName: String,
    storageKey: String,
    url: String,
    size: Number,
    mimeType: String,
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const answerSchema = new mongoose.Schema(
  {
    responseId: { type: String, required: true, index: true },
    questionnaire: { type: mongoose.Schema.Types.ObjectId, ref: "Questionnaire", required: true, index: true },
    questionnaireKey: { type: String, index: true },
    questionnaireVersion: { type: Number, default: 1, index: true },
    question: { type: mongoose.Schema.Types.ObjectId, ref: "Question", required: true, index: true },
    questionKey: { type: String, required: true, index: true },
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", index: true },
    participantId: { type: mongoose.Schema.Types.ObjectId, index: true },
    participantRole: { type: String, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", index: true },
    beneficiary: { type: mongoose.Schema.Types.ObjectId, ref: "Beneficiary", index: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", index: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    dueDate: Date,
    value: mongoose.Schema.Types.Mixed,
    normalizedValue: mongoose.Schema.Types.Mixed,
    files: [uploadedFileSchema],
    locale: { type: String, default: "en" },
    status: {
      type: String,
      enum: ["draft", "auto_saved", "submitted", "approved", "rejected"],
      default: "draft",
      index: true,
    },
    currentStep: { type: String, default: "" },
    currentPageKey: String,
    currentSectionKey: String,
    branchPath: [{ type: String }],
    visible: { type: Boolean, default: true },
    completion: {
      answeredRequired: { type: Number, default: 0 },
      totalRequired: { type: Number, default: 0 },
      answeredTotal: { type: Number, default: 0 },
      totalQuestions: { type: Number, default: 0 },
      percent: { type: Number, default: 0 },
    },
    startedAt: Date,
    lastAutoSavedAt: Date,
    submittedAt: Date,
    approvedAt: Date,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: Date,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewNotes: String,
    rejectedAt: Date,
    rejectionReason: String,
    mappingOutput: { type: mongoose.Schema.Types.Mixed, default: {} },
    masterDataPath: String,
    masterDataSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    validation: {
      errors: [String],
      warnings: [String],
      validatedAt: Date,
    },
    calculatedFields: { type: mongoose.Schema.Types.Mixed, default: {} },
    signature: {
      required: { type: Boolean, default: false },
      signedAt: Date,
      signedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      provider: String,
      envelopeId: String,
      certificateDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document" },
    },
    collaboration: {
      lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      lockedAt: Date,
      lockExpiresAt: Date,
      activeUsers: [
        {
          user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          lastSeenAt: Date,
        },
      ],
      comments: [
        {
          user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          questionKey: String,
          body: String,
          resolved: { type: Boolean, default: false },
          createdAt: { type: Date, default: Date.now },
        },
      ],
    },
    auditHistory: [answerAuditSchema],
  },
  { timestamps: true }
);

answerSchema.index({ responseId: 1, questionKey: 1 }, { unique: true });
answerSchema.index({ questionnaire: 1, caseId: 1, status: 1 });
answerSchema.index({ caseId: 1, participantId: 1, questionnaire: 1, status: 1 });
answerSchema.index({ participantId: 1, responseId: 1 });
answerSchema.index({ user: 1, status: 1, updatedAt: -1 });
answerSchema.index({ assignedTo: 1, dueDate: 1, status: 1 });
answerSchema.index({ client: 1, status: 1, updatedAt: -1 });
answerSchema.index({ beneficiary: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.model("Answer", answerSchema);
