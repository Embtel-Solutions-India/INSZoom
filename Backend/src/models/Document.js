const mongoose = require("mongoose");

const DOCUMENT_TYPES = [
  "passport",
  "visa",
  "driver_license",
  "degree",
  "resume",
  "cv",
  "transcript",
  "i20",
  "employment_letter",
  "experience_letter",
  "employment_verification_letter",
  "offer_letter",
  "publication",
  "patent",
  "award",
  "membership",
  "press",
  "salary",
  "recommendation_letter",
  "recommendation",
  "marriage_certificate",
  "divorce_certificate",
  "financial_document",
  "national_id",
  "birth_certificate",
  "current_visa",
  "i94",
  "uscis_form",
  "rfe",
  "tax_return",
  "paystub",
  "w2",
  "bank_statement",
  "business_registration",
  "articles_of_incorporation",
  "organizational_chart",
  "financial_statement",
  "company_document",
  "uscis_notice",
  "previous_uscis_form",
  "approval_notice",
  "noid",
  "medical_examination",
  "police_certificate",
  "supporting_evidence",
  "contract",
  "support_letter",
  "photo",
  "photograph",
  "other",
];

const DOCUMENT_CATEGORIES = [
  "identity",
  "education",
  "employment",
  "financial",
  "family",
  "civil",
  "immigration",
  "business",
  "medical",
  "supporting",
  "photos",
  "evidence",
  "letters",
  "forms",
  "legal",
  "government",
  "case",
  // Additional categories used by client portal
  "relationship",
  "travel",
  "general",
  "other",
];

const REVIEW_STATUSES = ["uploaded", "under_review", "pending", "approved", "rejected", "needs_revision"];
const AI_STATUSES = ["pending", "processing", "completed", "failed"];
const INTELLIGENCE_STATUSES = ["uploaded", "queued", "processing", "ocr_complete", "needs_review", "approved", "rejected", "failed"];
const REQUEST_STATUSES = ["not_required", "requested", "submitted", "missing", "overdue", "approved", "rejected"];
const SIGNATURE_STATUSES = ["not_required", "requested", "sent", "signed", "declined", "expired"];
const PROCESSING_STAGES = ["uploaded", "virus_scan", "validated", "stored", "ocr", "metadata", "classification", "evidence_mapping", "associated", "indexed", "review", "completed", "failed"];

const documentVersionSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    originalName: String,
    storedName: String,
    storageProvider: { type: String, default: "local" },
    storageKey: String,
    filePath: String,
    documentUrl: String,
    mimeType: String,
    fileType: String,
    size: Number,
    checksum: String,
    uploadedByUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    uploadedByRole: String,
    uploadedAt: { type: Date, default: Date.now },
    changeReason: String,
  },
  { _id: true }
);

const documentAuditSchema = new mongoose.Schema(
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

const processingEventSchema = new mongoose.Schema(
  {
    stage: { type: String, enum: PROCESSING_STAGES, required: true },
    status: { type: String, enum: ["pending", "processing", "completed", "failed", "skipped"], required: true },
    provider: String,
    message: String,
    errorCode: String,
    attempt: { type: Number, default: 1 },
    metadata: mongoose.Schema.Types.Mixed,
    startedAt: Date,
    completedAt: Date,
  },
  { _id: true }
);

const evidenceAssociationSchema = new mongoose.Schema(
  {
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", index: true },
    beneficiary: { type: mongoose.Schema.Types.ObjectId, ref: "Beneficiary", index: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", index: true },
    caseForm: { type: mongoose.Schema.Types.ObjectId, ref: "CaseForm", index: true },
    formType: String,
    criterion: String,
    category: String,
    status: { type: String, enum: ["suggested", "linked", "verified", "rejected"], default: "linked" },
    confidence: { type: Number, min: 0, max: 100 },
    strengthScore: { type: Number, min: 0, max: 100 },
    strengthLevel: { type: String, enum: ["weak", "moderate", "strong", "critical", "unrated"], default: "unrated" },
    supportingForms: [String],
    petitionParagraphKeys: [String],
    rationale: String,
    source: { type: String, enum: ["ai", "rules", "manual", "import"], default: "manual" },
    linkedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    linkedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const documentCommentSchema = new mongoose.Schema(
  {
    body: { type: String, required: true, trim: true, maxlength: 5000 },
    visibility: { type: String, enum: ["internal", "client"], default: "internal" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    createdAt: { type: Date, default: Date.now },
    resolvedAt: Date,
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { _id: true }
);

const shareSchema = new mongoose.Schema(
  {
    sharedWithUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    sharedWithEmail: { type: String, lowercase: true, trim: true },
    role: { type: String, enum: ["viewer", "editor", "reviewer", "signer"], default: "viewer" },
    expiresAt: Date,
    sharedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    sharedAt: { type: Date, default: Date.now },
    revokedAt: Date,
  },
  { _id: true }
);

const signatureSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ["manual", "docusign", "adobe_sign", "hellosign", "other", ""], default: "" },
    envelopeId: String,
    status: { type: String, enum: SIGNATURE_STATUSES, default: "not_required", index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    requestedAt: Date,
    signedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    signedAt: Date,
    signerEmail: { type: String, lowercase: true, trim: true },
  },
  { _id: false }
);

const documentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", index: true },
    participantId: { type: mongoose.Schema.Types.ObjectId, index: true },
    participantRole: { type: String, index: true },
    canonicalProfileId: { type: mongoose.Schema.Types.ObjectId, index: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", index: true },
    beneficiary: { type: mongoose.Schema.Types.ObjectId, ref: "Beneficiary", index: true },
    clientPortalId: { type: String, index: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", index: true },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: "Team", index: true },
    folderPath: { type: String, default: "/", index: true },
    folderName: { type: String, default: "Root", index: true },
    tags: [{ type: String, index: true }],

    category: { type: String, enum: DOCUMENT_CATEGORIES, default: "other", index: true },
    documentType: { type: String, default: "other", trim: true, index: true },
    description: String,
    isRequired: { type: Boolean, default: false },
    requestStatus: { type: String, enum: REQUEST_STATUSES, default: "not_required", index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    requestedAt: Date,
    requestDueDate: { type: Date, index: true },
    missingReason: String,

    originalName: String,
    originalFileName: String,
    storedName: String,
    fileName: String,
    mimeType: String,
    fileType: String,
    size: Number,
    fileSize: Number,
    filePath: String,
    documentUrl: String,
    storageProvider: { type: String, default: "local" },
    storageKey: String,
    checksum: String,
    currentVersion: { type: Number, default: 1 },
    versions: [documentVersionSchema],

    status: { type: String, enum: REVIEW_STATUSES, default: "uploaded", index: true },
    reviewStatus: { type: String, enum: REVIEW_STATUSES, default: "pending", index: true },
    adminNotes: String,
    reviewNotes: String,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: Date,

    // "employer"/"employee"/"beneficiary" added (F-4 fix): document.controller.js's
    // uploadDocument sets uploadedBy from the requesting user's own req.user.role
    // verbatim (not mapped to a generic bucket), so any of Phase 9's
    // employer/employee/family-workflow portal roles - all real, valid User.role
    // values (see caseParticipantSchema.role, which already lists them) - threw
    // a document-validation error on every real upload. Never caught before
    // this session because no employer/employee account had ever uploaded
    // through this endpoint until now.
    uploadedBy: { type: String, enum: ["client", "employer", "employee", "beneficiary", "case_manager", "team_lead", "admin", "super_admin", "system"], default: "client" },
    uploadedByUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    uploadDate: { type: Date, default: Date.now, index: true },

    aiExtractionStatus: { type: String, enum: AI_STATUSES, default: "pending" },
    intelligenceStatus: { type: String, enum: INTELLIGENCE_STATUSES, default: "uploaded", index: true },
    aiExtractedData: mongoose.Schema.Types.Mixed,
    extractionConfidence: Number,
    ocr: {
      provider: { type: String, enum: ["none", "gemini", "google_document_ai", "aws_textract", "azure_form_recognizer", "azure_document_intelligence", "tesseract", "openai", "other"], default: "none" },
      processorId: String,
      status: { type: String, enum: AI_STATUSES, default: "pending" },
      jobId: String,
      rawText: String,
      structuredData: mongoose.Schema.Types.Mixed,
      confidence: Number,
      processedAt: Date,
      error: String,
    },
    validation: {
      status: { type: String, enum: ["not_started", "pending", "passed", "failed", "needs_review"], default: "not_started" },
      rules: [String],
      issues: [String],
      validatedAt: Date,
      validatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    processing: {
      stage: { type: String, enum: PROCESSING_STAGES, default: "uploaded", index: true },
      status: { type: String, enum: ["pending", "processing", "completed", "failed", "review_required"], default: "pending", index: true },
      attempts: { type: Number, default: 0 },
      lastError: String,
      retryable: { type: Boolean, default: true },
      startedAt: Date,
      completedAt: Date,
      events: [processingEventSchema],
    },
    malwareScan: {
      provider: String,
      status: { type: String, enum: ["pending", "clean", "infected", "failed", "skipped"], default: "pending", index: true },
      scannedAt: Date,
      limited: Boolean,
      details: mongoose.Schema.Types.Mixed,
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
    excel: {
      syncStatus: { type: String, enum: ["not_required", "pending", "updated", "failed"], default: "not_required", index: true },
      workbookDocument: { type: mongoose.Schema.Types.ObjectId, ref: "Document" },
      workbookStorageKey: String,
      lastGeneratedAt: Date,
      lastError: String,
    },

    isEvidence: { type: Boolean, default: false },
    evidenceCriteria: [String],
    evidenceAssociations: [evidenceAssociationSchema],
    reviewComments: [documentCommentSchema],
    expiryDate: { type: Date, index: true },
    issuedDate: Date,
    issuingAuthority: String,
    documentNumber: String,
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    shares: [shareSchema],
    signature: signatureSchema,
    deletedAt: Date,
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    auditHistory: [documentAuditSchema],
    legacySource: { type: String, enum: ["BAIS", "INSZoom", "shared", ""], default: "shared" },
  },
  { timestamps: true }
);

documentSchema.pre("validate", function syncCompatibilityFields(next) {
  if (this.originalName && !this.originalFileName) this.originalFileName = this.originalName;
  if (this.originalFileName && !this.originalName) this.originalName = this.originalFileName;
  if (this.storedName && !this.fileName) this.fileName = this.storedName;
  if (this.fileName && !this.storedName) this.storedName = this.fileName;
  if (this.mimeType && !this.fileType) this.fileType = this.mimeType;
  if (this.fileType && !this.mimeType) this.mimeType = this.fileType;
  if (this.size && !this.fileSize) this.fileSize = this.size;
  if (this.fileSize && !this.size) this.size = this.fileSize;
  if (this.reviewStatus === "pending" && this.status && this.status !== "uploaded") this.reviewStatus = this.status;
  if (this.status === "uploaded" && this.reviewStatus && this.reviewStatus !== "pending") this.status = this.reviewStatus;
  if (!this.folderPath) this.folderPath = "/";
  if (!this.folderName) this.folderName = this.folderPath === "/" ? "Root" : this.folderPath.split("/").filter(Boolean).pop();
  if (this.isRequired && this.requestStatus === "not_required") this.requestStatus = this.reviewStatus === "approved" ? "approved" : "submitted";
  if (this.aiExtractionStatus && this.ocr) this.ocr.status = this.aiExtractionStatus;
  if (this.ocr?.status && this.aiExtractionStatus !== this.ocr.status) this.aiExtractionStatus = this.ocr.status;
  next();
});

documentSchema.index({ user: 1, category: 1, documentType: 1, deletedAt: 1 });
documentSchema.index({ caseId: 1, documentType: 1, deletedAt: 1 });
documentSchema.index({ caseId: 1, participantId: 1, documentType: 1, deletedAt: 1 });
documentSchema.index({ participantId: 1, reviewStatus: 1, uploadDate: -1 });
documentSchema.index({ beneficiary: 1, documentType: 1, deletedAt: 1 });
documentSchema.index({ client: 1, documentType: 1, deletedAt: 1 });
documentSchema.index({ companyId: 1, folderPath: 1, deletedAt: 1 });
documentSchema.index({ clientPortalId: 1, uploadDate: -1 });
documentSchema.index({ reviewStatus: 1, uploadDate: -1 });
documentSchema.index({ requestStatus: 1, requestDueDate: 1 });
documentSchema.index({ tags: 1, uploadDate: -1 });
documentSchema.index({ "evidenceAssociations.caseId": 1, "evidenceAssociations.formType": 1, "evidenceAssociations.category": 1 });
documentSchema.index({ checksum: 1, caseId: 1, deletedAt: 1 });
documentSchema.index({ originalName: "text", originalFileName: "text", documentType: "text", description: "text", tags: "text", "ocr.rawText": "text" });
documentSchema.index({ expiryDate: 1, status: 1 });

documentSchema.statics.documentTypes = DOCUMENT_TYPES;
documentSchema.statics.categories = DOCUMENT_CATEGORIES;
documentSchema.statics.reviewStatuses = REVIEW_STATUSES;
documentSchema.statics.requestStatuses = REQUEST_STATUSES;
documentSchema.statics.processingStages = PROCESSING_STAGES;
documentSchema.statics.intelligenceStatuses = INTELLIGENCE_STATUSES;

module.exports = mongoose.model("Document", documentSchema);
