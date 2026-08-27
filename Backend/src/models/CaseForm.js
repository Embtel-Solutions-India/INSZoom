const mongoose = require("mongoose");

const caseFormSchema = new mongoose.Schema(
  {
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", required: true, index: true },
    participantId: { type: mongoose.Schema.Types.ObjectId, index: true },
    participantRole: { type: String, index: true },
    formTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: "USCISFormTemplate", required: true, index: true },
    formCode: { type: String, required: true, index: true },
    formVersion: { type: String, required: true },
    formEditionDate: Date,
    formVersionLock: {
      formType: String,
      editionDate: Date,
      version: String,
      mappingVersion: Number,
      mappingVersionId: { type: mongoose.Schema.Types.ObjectId, ref: "USCISMappingVersion" },
      validationVersion: Number,
      renderingVersion: Number,
      formTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: "USCISFormTemplate" },
      lockedAt: Date,
      lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      overrideReason: String,
      migratedFrom: { type: mongoose.Schema.Types.ObjectId, ref: "USCISFormTemplate" },
      migratedAt: Date,
      migratedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    status: {
      type: String,
      enum: ["pending", "draft", "ai_filled", "in_review", "under_review", "needs_revision", "approved", "ready_for_pdf", "generated", "finalized", "filed", "rejected", "locked", "archived"],
      default: "pending",
      index: true,
    },
    filledData: mongoose.Schema.Types.Mixed,
    fieldValues: { type: mongoose.Schema.Types.Mixed, default: {} },
    sourceAttribution: { type: mongoose.Schema.Types.Mixed, default: {} },
    manualOverrides: { type: mongoose.Schema.Types.Mixed, default: {} },
    autoFillReport: { type: mongoose.Schema.Types.Mixed, default: {} },
    mappingVersion: { type: Number, default: 0 },
    mappingVersionId: { type: mongoose.Schema.Types.ObjectId, ref: "USCISMappingVersion" },
    validationVersion: { type: Number, default: 0 },
    renderingVersion: { type: Number, default: 0 },
    versionNumber: { type: Number, default: 0, index: true },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    generatedAt: Date,
    changeSummary: mongoose.Schema.Types.Mixed,
    versions: [
      {
        versionNumber: Number,
        generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        generatedAt: Date,
        changeSummary: mongoose.Schema.Types.Mixed,
        filledData: mongoose.Schema.Types.Mixed,
        fieldValues: mongoose.Schema.Types.Mixed,
        sourceAttribution: mongoose.Schema.Types.Mixed,
        validationErrors: mongoose.Schema.Types.Mixed,
        completion: mongoose.Schema.Types.Mixed,
        status: String,
        archivedAt: { type: Date, default: Date.now },
      },
    ],
    completion: {
      totalFields: { type: Number, default: 0 },
      completedFields: { type: Number, default: 0 },
      requiredFields: { type: Number, default: 0 },
      missingRequiredFields: { type: Number, default: 0 },
      percent: { type: Number, default: 0 },
    },
    sectionProgress: { type: mongoose.Schema.Types.Mixed, default: {} },
    validationErrors: { type: mongoose.Schema.Types.Mixed, default: {} },
    fieldReviews: { type: mongoose.Schema.Types.Mixed, default: {} },
    sectionReviews: { type: mongoose.Schema.Types.Mixed, default: {} },
    reviewState: {
      mode: { type: String, enum: ["read_only", "case_manager", "team_lead", "admin"], default: "read_only" },
      status: {
        type: String,
        enum: ["not_started", "in_progress", "needs_revision", "approved", "rejected", "ready_for_pdf", "locked"],
        default: "not_started",
      },
      startedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      startedAt: Date,
      lastActivityBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      lastActivityAt: Date,
      completedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      completedAt: Date,
      requestedChanges: [mongoose.Schema.Types.Mixed],
      electronicApproval: mongoose.Schema.Types.Mixed,
    },
    fieldHistory: [
      {
        fieldName: { type: String, required: true, index: true },
        sectionKey: String,
        action: { type: String, required: true },
        previousValue: mongoose.Schema.Types.Mixed,
        newValue: mongoose.Schema.Types.Mixed,
        reason: String,
        source: String,
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        changedAt: { type: Date, default: Date.now },
        metadata: mongoose.Schema.Types.Mixed,
      },
    ],
    comments: [
      {
        scope: { type: String, enum: ["form", "section", "field"], default: "form" },
        fieldName: String,
        sectionKey: String,
        comment: String,
        parentCommentId: mongoose.Schema.Types.ObjectId,
        mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
        internalOnly: { type: Boolean, default: true },
        resolved: { type: Boolean, default: false },
        resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        resolvedAt: Date,
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    reviewTasks: [{ type: mongoose.Schema.Types.ObjectId, ref: "Task" }],
    syncState: {
      canonicalVersion: Number,
      autoFillVersion: Number,
      lastSyncedAt: Date,
      stale: { type: Boolean, default: false },
      requiresRegeneration: { type: Boolean, default: false },
      staleReason: String,
      changedFields: [String],
      affectedFields: [String],
    },
    comparisonBaseline: {
      versionNumber: Number,
      capturedAt: Date,
      fieldValues: mongoose.Schema.Types.Mixed,
      filledData: mongoose.Schema.Types.Mixed,
    },
    lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    lastModifiedAt: Date,
    filledPdfPath: String,
    filledPdfUrl: String,
    generatedPdfDocument: { type: mongoose.Schema.Types.ObjectId, ref: "Document" },
    fillWarnings: [
      {
        pdfField: String,
        caseField: String,
        message: String,
        at: { type: Date, default: Date.now },
      },
    ],
    generatedPdfVersions: [
      {
        versionNumber: Number,
        generatedAt: Date,
        generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        approvedAt: Date,
        pdfPath: String,
        pdfUrl: String,
        document: { type: mongoose.Schema.Types.ObjectId, ref: "Document" },
        validationResults: mongoose.Schema.Types.Mixed,
        watermark: String,
        status: String,
      },
    ],
    filingPackages: [
      {
        packageDocument: { type: mongoose.Schema.Types.ObjectId, ref: "Document" },
        generatedAt: Date,
        generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        packageType: String,
        includedItems: [mongoose.Schema.Types.Mixed],
        metadata: mongoose.Schema.Types.Mixed,
      },
    ],
    aiFillJobId: mongoose.Schema.Types.ObjectId,
    qualityCheckJobId: mongoose.Schema.Types.ObjectId,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewDate: Date,
    reviewComments: String,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvalDate: Date,
    isLocked: { type: Boolean, default: false, index: true },
    lockedAt: Date,
    lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    auditHistory: [
      {
        action: { type: String, required: true },
        changes: mongoose.Schema.Types.Mixed,
        performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        performedAt: { type: Date, default: Date.now },
        ipAddress: String,
        userAgent: String,
      },
    ],

    // ─── PHASE 2 ADDITIONS ──────────────────────────────────────────────────
    // `fieldValues` above is Mixed (a plain object, no sub-schema), so it
    // cannot be given a typed per-field provenance shape without a migration
    // on existing CaseForm documents — outside this phase's additive-only
    // scope. Left unchanged. This Map supplements fieldValues instead: keys
    // are field identifiers matching entries in fieldValues, values carry
    // the provenance/override metadata AutoFillService's sync engine needs
    // once it starts consuming USCISMappingVersion's profileOwner/
    // allowsOccurrenceOverride edge classification (see Case.js and
    // USCISMappingVersion.js's own Phase 2 additions).
    fieldValueProvenance: {
      type: Map,
      of: new mongoose.Schema(
        {
          source: {
            type: String,
            enum: ["canonical", "case_manager_override", "ocr", "questionnaire"],
            default: "canonical",
          },
          mappingId: { type: String, default: null },
          occurrenceId: { type: String, default: null },
          allowsOccurrenceOverride: { type: Boolean, default: false },
          canonicalValue: { type: mongoose.Schema.Types.Mixed, default: null },
          overriddenAt: { type: Date, default: null },
          overriddenBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
          revision: { type: Number, default: 0 },
        },
        { _id: false }
      ),
      default: {},
    },
    // ─── END PHASE 2 ADDITIONS ───────────────────────────────────────────────
  },
  { timestamps: true }
);

// PHASE 2 — REFERENCE: documented shape `fieldValues` (Mixed, unchanged
// above) is expected to hold per field ID, once a migration formalizes it.
// Documentation only — not enforced by Mongoose, since fieldValues is Mixed.
// { [fieldId: string]: string | number | boolean | null }
const FIELD_VALUES_SCHEMA_REFERENCE = Object.freeze({
  description: "fieldValues is a flat map of fieldId -> filled value (Mixed, unenforced).",
  perFieldShape: "string | number | boolean | null",
});

caseFormSchema.index({ caseId: 1, formCode: 1 });
caseFormSchema.index({ caseId: 1, formTemplateId: 1, participantId: 1 }, { unique: true, sparse: true });
caseFormSchema.index({ caseId: 1, participantId: 1, formCode: 1 });
caseFormSchema.index({ caseId: 1, formCode: 1, formEditionDate: 1 });
caseFormSchema.index({ "syncState.requiresRegeneration": 1, updatedAt: -1 });
// listCaseForms/getAllCaseForms both do .sort({updatedAt: -1}) - the former
// filtered by caseId, the latter with no filter at all. Neither pattern was
// covered by an existing index, so Mongo fell back to an in-memory sort of
// full documents (each one can embed large fieldValues/validationErrors) and
// hit the 32MB sort limit ("Sort exceeded memory limit... Pass
// allowDiskUse:true", confirmed via GET /uscis-forms/case - same failure
// mode as the USCISFormTemplate registry index added earlier). The
// compound index covers the filtered case via ESR (equality on caseId, sort
// on updatedAt); the plain index covers the unfiltered "all case forms" case,
// which a compound index leading with caseId cannot satisfy.
caseFormSchema.index({ caseId: 1, updatedAt: -1 });
caseFormSchema.index({ updatedAt: -1 });

const CaseForm = mongoose.model("CaseForm", caseFormSchema);

// PHASE 2 — attached as a static, not a change to the module's export shape
// (every existing caller uses this directly as the Mongoose model), so the
// documentation is importable without breaking any existing require() call.
CaseForm.FIELD_VALUES_SCHEMA_REFERENCE = FIELD_VALUES_SCHEMA_REFERENCE;

module.exports = CaseForm;
