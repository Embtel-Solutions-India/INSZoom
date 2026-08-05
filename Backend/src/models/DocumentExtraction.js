const mongoose = require("mongoose");

const DOCUMENT_INTELLIGENCE_TYPES = [
  "passport",
  "visa",
  "i94",
  "driver_license",
  "resume",
  "cv",
  "degree",
  "lca",
  "credential_evaluation",
  "transcript",
  "i20",
  "publication",
  "patent",
  "award",
  "membership",
  "press",
  "salary",
  "recommendation_letter",
  "birth_certificate",
  "marriage_certificate",
  "divorce_certificate",
  "employment_letter",
  "experience_letter",
  "employment_verification_letter",
  "offer_letter",
  "paystub",
  "w2",
  "tax_return",
  "bank_statement",
  "business_registration",
  "business_license",
  "articles_of_incorporation",
  "organizational_chart",
  "financial_statement",
  "company_document",
  "uscis_notice",
  "previous_uscis_form",
  "approval_notice",
  "rfe",
  "noid",
  "medical_examination",
  "police_certificate",
  "photograph",
  "supporting_evidence",
  "other",
];

const EVIDENCE_CATEGORIES = [
  "Award",
  "Publication",
  "Patent",
  "Press",
  "Membership",
  "Judging",
  "High Salary",
  "Critical Role",
  "Original Contribution",
  "Authorship",
  "Education",
  "Employment",
  "Identity",
  "Immigration",
  "Recommendation",
  "Civil",
  "Financial",
  "Business",
  "Medical",
  "Legal",
  "Supporting Evidence",
  "Other",
];

const fieldExtractionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, index: true },
    label: String,
    value: mongoose.Schema.Types.Mixed,
    confidence: { type: Number, min: 0, max: 100, default: 0 },
    reviewStatus: {
      type: String,
      enum: ["auto_accepted", "needs_review", "manual_review", "pending_review", "approved", "rejected", "edited"],
      default: "manual_review",
      index: true,
    },
    sourceDocument: { type: mongoose.Schema.Types.ObjectId, ref: "Document" },
    sourceType: { type: String, default: "ocr", index: true },
    sourceDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document" },
    confidenceScore: Number,
    extractedAt: Date,
    extractionTimestamp: { type: Date, default: Date.now },
    originalValue: mongoose.Schema.Types.Mixed,
    editedValue: mongoose.Schema.Types.Mixed,
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    editedAt: Date,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: Date,
    path: String,
    validationStatus: { type: String, enum: ["not_validated", "valid", "review_required"], default: "not_validated" },
    validationIssues: [mongoose.Schema.Types.Mixed],
    evidenceCategory: String,
    uscisMappings: [String],
    questionnaireKeys: [String],
  },
  { _id: true }
);

const auditSchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    performedAt: { type: Date, default: Date.now },
    changes: mongoose.Schema.Types.Mixed,
    ipAddress: String,
    userAgent: String,
  },
  { _id: true }
);

const processingLogSchema = new mongoose.Schema(
  {
    stage: String,
    status: String,
    message: String,
    metadata: mongoose.Schema.Types.Mixed,
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const documentExtractionSchema = new mongoose.Schema(
  {
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document", required: true, unique: true, index: true },
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", index: true },
    participantId: { type: mongoose.Schema.Types.ObjectId, index: true },
    participantRole: { type: String, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    beneficiary: { type: mongoose.Schema.Types.ObjectId, ref: "Beneficiary", index: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", index: true },

    status: {
      type: String,
      enum: ["queued", "classifying", "classified", "extracting", "validating", "syncing", "completed", "failed"],
      default: "queued",
      index: true,
    },
    reviewStatus: {
      type: String,
      enum: ["not_started", "auto_accepted", "needs_review", "manual_review", "pending_review", "approved", "rejected"],
      default: "not_started",
      index: true,
    },
    processingStage: { type: String, default: "queued", index: true },
    processingStatus: {
      type: String,
      enum: ["pending", "processing", "completed", "failed", "review_required", "queued", "classifying", "classified", "extracting", "validating", "syncing"],
      default: "pending",
      index: true,
    },
    processingStartedAt: Date,
    processingCompletedAt: Date,
    processingError: String,

    classification: {
      documentType: { type: String, enum: DOCUMENT_INTELLIGENCE_TYPES, default: "other", index: true },
      confidence: { type: Number, min: 0, max: 100, default: 0 },
      reasoning: String,
      model: String,
      classifiedAt: Date,
      manuallyOverridden: { type: Boolean, default: false },
      overriddenBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      overriddenAt: Date,
      previousDocumentType: String,
    },
    documentType: { type: String, enum: DOCUMENT_INTELLIGENCE_TYPES, default: "other", index: true },

    provider: { type: String, default: "gemini" },
    model: String,
    rawText: String,
    rawExtraction: mongoose.Schema.Types.Mixed,
    extractedData: [fieldExtractionSchema],
    structuredEntities: mongoose.Schema.Types.Mixed,
    missingFields: [String],
    confidence: { type: Number, min: 0, max: 100, default: 0 },
    confidenceBand: { type: String, enum: ["auto_accepted", "needs_review", "manual_review"], default: "manual_review", index: true },
    evidenceCategories: [{ type: String, enum: EVIDENCE_CATEGORIES }],
    evidenceMappings: [
      {
        category: String,
        confidence: Number,
        reasoning: String,
        sourceFields: [String],
      },
    ],
    // Phase H2 contract (must match BAIS/Frontend's handleAutofillResult +
    // AC2/AC4): key is the question/masterData path (targetPath from the
    // semantic matcher); targetSystem distinguishes an editable draft-answer
    // write from a masterData suggestion routed through the review pipeline.
    questionnairePrefill: [
      {
        key: { type: String, required: true },
        value: mongoose.Schema.Types.Mixed,
        label: String,
        confidence: Number,
        sourceDocumentType: String,
        targetSystem: { type: String, enum: ["answer", "masterData"] },
        applied: { type: Boolean, default: false },
        conflict: { type: Boolean, default: false },
        questionnaireId: { type: mongoose.Schema.Types.ObjectId, ref: "Questionnaire" },
        answerId: { type: mongoose.Schema.Types.ObjectId, ref: "Answer" },
      },
    ],
    extractionHistory: [
      {
        replacedAt: { type: Date, default: Date.now },
        replacedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        reason: String,
        status: String,
        reviewStatus: String,
        confidence: Number,
        rawExtraction: mongoose.Schema.Types.Mixed,
        extractedData: [mongoose.Schema.Types.Mixed],
        questionnairePrefill: [mongoose.Schema.Types.Mixed],
        syncedTargets: mongoose.Schema.Types.Mixed,
      },
    ],
    syncedTargets: {
      beneficiaryProfile: { type: Boolean, default: false },
      caseProfile: { type: Boolean, default: false },
      questionnaireAnswers: { type: Boolean, default: false },
      masterData: { type: Boolean, default: false },
      evidenceRepository: { type: Boolean, default: false },
      documentMetadata: { type: Boolean, default: false },
      googleDrive: { type: Boolean, default: false },
      excelWorkbook: { type: Boolean, default: false },
    },
    googleDrive: {
      syncStatus: { type: String, enum: ["not_started", "queued", "syncing", "synced", "failed", "not_configured"], default: "not_started", index: true },
      fileId: String,
      folderId: String,
      folderPath: String,
      webViewLink: String,
      attempts: { type: Number, default: 0 },
      lastSyncedAt: Date,
      lastAttemptAt: Date,
      lastError: String,
    },
    excelWorkbook: {
      syncStatus: { type: String, enum: ["not_required", "pending", "updated", "failed"], default: "not_required", index: true },
      workbookDocument: { type: mongoose.Schema.Types.ObjectId, ref: "Document" },
      storageKey: String,
      lastGeneratedAt: Date,
      lastError: String,
    },
    correctionHistory: [
      {
        fieldKey: String,
        previousValue: mongoose.Schema.Types.Mixed,
        newValue: mongoose.Schema.Types.Mixed,
        previousStatus: String,
        newStatus: String,
        reason: String,
        correctedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        correctedAt: { type: Date, default: Date.now },
      },
    ],
    processingTimeMs: Number,
    processingLogs: [processingLogSchema],
    auditHistory: [auditSchema],
  },
  { timestamps: true }
);

documentExtractionSchema.index({ caseId: 1, status: 1, updatedAt: -1 });
documentExtractionSchema.index({ caseId: 1, participantId: 1, status: 1, updatedAt: -1 });
documentExtractionSchema.index({ participantId: 1, documentType: 1, updatedAt: -1 });
documentExtractionSchema.index({ reviewStatus: 1, confidence: 1, updatedAt: -1 });
documentExtractionSchema.index({ documentType: 1, updatedAt: -1 });

documentExtractionSchema.pre("validate", function syncProcessingCompatibility(next) {
  if (this.status === "failed") this.processingStatus = "failed";
  else if (this.status === "completed" && ["needs_review", "manual_review", "pending_review"].includes(this.reviewStatus)) this.processingStatus = "review_required";
  else if (this.status === "completed") this.processingStatus = "completed";
  else if (["classifying", "classified", "extracting", "validating", "syncing"].includes(this.status)) this.processingStatus = "processing";
  else if (!this.processingStatus) this.processingStatus = "pending";
  if (!this.processingStage && this.status) this.processingStage = this.status;
  next();
});

documentExtractionSchema.statics.documentTypes = DOCUMENT_INTELLIGENCE_TYPES;
documentExtractionSchema.statics.evidenceCategories = EVIDENCE_CATEGORIES;

module.exports = mongoose.model("DocumentExtraction", documentExtractionSchema);
