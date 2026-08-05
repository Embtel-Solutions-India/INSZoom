const mongoose = require("mongoose");

const DOCUMENT_ANALYSIS_TYPES = [
  "passport",
  "visa",
  "i94",
  "resume",
  "degree",
  "transcript",
  "publication",
  "award",
  "patent",
  "membership",
  "press",
  "salary",
  "recommendation_letter",
  "other",
];

const classificationEventSchema = new mongoose.Schema(
  {
    event: { type: String, required: true },
    status: String,
    message: String,
    metadata: mongoose.Schema.Types.Mixed,
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdAt: { type: Date, default: Date.now },
    ipAddress: String,
    userAgent: String,
  },
  { _id: true }
);

const documentAnalysisSchema = new mongoose.Schema(
  {
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document", required: true, unique: true, index: true },
    extractionId: { type: mongoose.Schema.Types.ObjectId, ref: "DocumentExtraction", index: true },
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    beneficiary: { type: mongoose.Schema.Types.ObjectId, ref: "Beneficiary", index: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", index: true },

    documentType: { type: String, enum: DOCUMENT_ANALYSIS_TYPES, default: "other", index: true },
    confidence: { type: Number, min: 0, max: 100, default: 0 },
    reasoning: String,
    model: String,
    promptVersion: { type: String, default: "classification.v1" },
    rawResponse: mongoose.Schema.Types.Mixed,

    processingStatus: {
      type: String,
      enum: ["pending", "processing", "classified", "failed", "review_required", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    reviewStatus: {
      type: String,
      enum: ["not_required", "needs_review", "approved", "rejected", "edited"],
      default: "not_required",
      index: true,
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    lastAttemptAt: Date,
    classifiedAt: Date,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: Date,
    reviewNotes: String,
    processingError: String,
    events: [classificationEventSchema],
  },
  { timestamps: true }
);

documentAnalysisSchema.index({ caseId: 1, processingStatus: 1, updatedAt: -1 });
documentAnalysisSchema.index({ reviewStatus: 1, confidence: 1, updatedAt: -1 });
documentAnalysisSchema.index({ documentType: 1, updatedAt: -1 });

documentAnalysisSchema.statics.documentTypes = DOCUMENT_ANALYSIS_TYPES;

module.exports = mongoose.model("DocumentAnalysis", documentAnalysisSchema);
