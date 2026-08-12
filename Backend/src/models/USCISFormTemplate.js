const mongoose = require("mongoose");

const uscisFormTemplateSchema = new mongoose.Schema(
  {
    formCode: { type: String, required: true, trim: true, index: true },
    formNumber: { type: String, trim: true, index: true },
    registryId: { type: String, trim: true },
    immutableVersionId: { type: String, trim: true, unique: true, sparse: true, index: true },
    formName: { type: String, trim: true },
    title: { type: String, required: true, trim: true },
    description: String,
    visaCategory: { type: String, trim: true, index: true },
    visaTypes: [{ type: String, index: true }],
    supportedVisaCategories: [{ type: String, index: true }],
    category: { type: String, trim: true, index: true },
    categories: [{ type: String, trim: true, index: true }],
    editionDate: Date,
    revisionDate: Date,
    effectiveDate: Date,
    retirementDate: Date,
    officialStatus: { type: String, enum: ["current", "deprecated", "missing_review", "unknown"], default: "unknown", index: true },
    officialPdfUrl: String,
    instructionsPdfUrl: String,
    instructionsStorageKey: String,
    artifacts: {
      form: {
        sourceUrl: String,
        storageProvider: String,
        storageKey: String,
        storagePath: String,
        checksum: String,
        fileSize: Number,
        downloadedAt: Date,
        downloadAttempts: { type: Number, default: 0 },
        status: { type: String, enum: ["pending", "downloaded", "duplicate", "failed", "corrupted", "missing"], default: "pending" },
        error: String,
      },
      instructions: {
        sourceUrl: String,
        storageProvider: String,
        storageKey: String,
        storagePath: String,
        checksum: String,
        fileSize: Number,
        downloadedAt: Date,
        downloadAttempts: { type: Number, default: 0 },
        status: { type: String, enum: ["pending", "downloaded", "duplicate", "failed", "corrupted", "missing"], default: "pending" },
        error: String,
      },
    },
    relatedForms: [{ type: String, trim: true }],
    localPdfPath: String,
    pdfTemplatePath: String,
    pdfStorageKey: String,
    pdfFieldMappings: [mongoose.Schema.Types.Mixed],
    pdfMetadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    mappingGraph: { type: mongoose.Schema.Types.Mixed, default: {} },
    mappingConfiguration: { type: mongoose.Schema.Types.Mixed, default: {} },
    renderingConfiguration: { type: mongoose.Schema.Types.Mixed, default: {} },
    validationConfiguration: { type: mongoose.Schema.Types.Mixed, default: {} },
    mappingStatus: { type: String, enum: ["unmapped", "draft", "active", "needs_review", "archived"], default: "unmapped", index: true },
    mappingVersion: { type: Number, default: 0 },
    activeMappingVersion: { type: Number, default: 0 },
    latestMappingVersionId: { type: mongoose.Schema.Types.ObjectId, ref: "USCISMappingVersion" },
    activeMappingVersionId: { type: mongoose.Schema.Types.ObjectId, ref: "USCISMappingVersion" },
    validationVersion: { type: Number, default: 0 },
    renderingVersion: { type: Number, default: 0 },
    mappingAuditHistory: [mongoose.Schema.Types.Mixed],
    version: { type: String, required: true, index: true },
    versionNumber: { type: Number, default: 1, index: true },
    status: { type: String, enum: ["draft", "review", "active", "retired", "archived", "pending_review"], default: "pending_review", index: true },
    currentStatus: { type: String, enum: ["draft", "review", "active", "retired", "archived"], default: "review", index: true },
    activeFlag: { type: Boolean, default: false, index: true },
    parentVersion: { type: mongoose.Schema.Types.ObjectId, ref: "USCISFormTemplate" },
    importedAt: Date,
    activatedAt: Date,
    retiredAt: Date,
    lifecycle: {
      provider: { type: String, default: "uscis", index: true },
      sourcePageUrl: String,
      sourcePdfUrl: String,
      sourceChecksum: String,
      sourceMetadataChecksum: String,
      detectionStatus: String,
      consecutiveMisses: { type: Number, default: 0 },
      lastSeenAt: Date,
      lastSeenSyncRun: { type: mongoose.Schema.Types.ObjectId, ref: "USCISFormSyncRun" },
      detectedAt: Date,
      importedByScanner: { type: Boolean, default: false },
      reviewRequestedAt: Date,
      reviewNotes: String,
      rejectedAt: Date,
      rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      rejectionReason: String,
      activatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      retiredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      comparisonReport: mongoose.Schema.Types.Mixed,
      migrationSuggestions: [mongoose.Schema.Types.Mixed],
      impactAnalysis: mongoose.Schema.Types.Mixed,
      scanHistory: [mongoose.Schema.Types.Mixed],
      changeEvents: [mongoose.Schema.Types.Mixed],
    },
    formFields: [
      {
        fieldId: String,
        id: String,
        uniqueId: String,
        fieldName: String,
        originalName: String,
        pdfFieldName: String,
        normalizedName: String,
        normalizedPath: String,
        fieldType: String,
        // Nested one level to avoid Mongoose's `{ type: ... }` shorthand
        // detection: a bare `type: String` sibling here makes Mongoose treat
        // this whole formFields element object as "one field of type
        // String" instead of a subdocument schema, silently casting every
        // formFields entry to a string (and dropping non-string objects).
        type: { type: String },
        pdfFieldType: String,
        semanticType: String,
        fieldLabel: String,
        label: String,
        // Which of FieldLabelEnrichmentService's derivation methods produced
        // `label` (crosswalk_note / pdf_tooltip / naming_pattern /
        // labelize_fallback) - kept for traceability/debugging, not shown to
        // end users. The raw /TU tooltip text itself is NOT persisted here -
        // storing it for all ~980 fields pushed a real template document to
        // Mongo's 16MB subdocument-array ceiling (confirmed empirically); it
        // is only needed transiently, at label-derivation time.
        labelSource: String,
        sectionKey: String,
        sectionId: String,
        sectionTitle: String,
        subsectionId: String,
        groupId: String,
        parentGroup: String,
        order: Number,
        tabOrder: Number,
        required: { type: Boolean, default: false },
        readOnly: { type: Boolean, default: false },
        hidden: { type: Boolean, default: false },
        calculated: { type: Boolean, default: false },
        defaultValue: mongoose.Schema.Types.Mixed,
        currentValue: mongoose.Schema.Types.Mixed,
        options: [mongoose.Schema.Types.Mixed],
        repeatable: { type: Boolean, default: false },
        repeatableConfig: mongoose.Schema.Types.Mixed,
        helpText: String,
        placeholder: String,
        validation: mongoose.Schema.Types.Mixed,
        validationRules: mongoose.Schema.Types.Mixed,
        dependencies: [mongoose.Schema.Types.Mixed],
        conditionalLogic: mongoose.Schema.Types.Mixed,
        showWhen: mongoose.Schema.Types.Mixed,
        pageNumber: Number,
        coordinates: mongoose.Schema.Types.Mixed,
        position: mongoose.Schema.Types.Mixed,
        widgets: [mongoose.Schema.Types.Mixed],
        width: Number,
        height: Number,
        rotation: Number,
        boundingBox: mongoose.Schema.Types.Mixed,
        coordinateSystem: mongoose.Schema.Types.Mixed,
        font: mongoose.Schema.Types.Mixed,
        appearance: mongoose.Schema.Types.Mixed,
        exportValue: mongoose.Schema.Types.Mixed,
        importValue: mongoose.Schema.Types.Mixed,
        pdfFlags: Number,
        textFieldFlags: mongoose.Schema.Types.Mixed,
        choiceFieldFlags: mongoose.Schema.Types.Mixed,
        radioFieldFlags: mongoose.Schema.Types.Mixed,
        searchableText: String,
        mappings: [mongoose.Schema.Types.Mixed],
        mapping: { clientField: String, caseField: String, beneficiaryField: String, companyField: String, questionnaireField: String, ocrField: String, staticValue: String },
      },
    ],
    sections: [
      {
        sectionId: String,
        key: String,
        title: String,
        description: String,
        order: Number,
        repeatable: { type: Boolean, default: false },
        repeatableConfig: mongoose.Schema.Types.Mixed,
        conditionalLogic: mongoose.Schema.Types.Mixed,
        showWhen: mongoose.Schema.Types.Mixed,
        parentKey: String,
      },
    ],
    formStructure: { type: mongoose.Schema.Types.Mixed, default: {} },
    formLayout: { type: mongoose.Schema.Types.Mixed, default: {} },
    fieldIndexes: { type: mongoose.Schema.Types.Mixed, default: {} },
    fieldDependencies: [mongoose.Schema.Types.Mixed],
    validationRules: { type: mongoose.Schema.Types.Mixed, default: {} },
    supportedLanguages: [{ type: String, default: "en" }],
    assignmentRules: {
      visaCategories: [String],
      visaTypes: [String],
      caseTypes: [String],
      petitionTypes: [String],
      premiumProcessing: Boolean,
      applicantTypes: [String],
      organizationRules: mongoose.Schema.Types.Mixed,
      required: { type: Boolean, default: true },
    },
    documentRequirements: [mongoose.Schema.Types.Mixed],
    evidenceRequirements: [mongoose.Schema.Types.Mixed],
    instructions: String,
    definition: { type: mongoose.Schema.Types.Mixed, default: {} },
    parserMetadata: {
      version: String,
      parsedAt: Date,
      source: String,
      usedOcr: { type: Boolean, default: false },
      confidence: Number,
      status: { type: String, enum: ["parsed", "needs_review", "failed", "pending"], default: "pending" },
      reviewItems: [mongoose.Schema.Types.Mixed],
      warnings: [mongoose.Schema.Types.Mixed],
      errors: [mongoose.Schema.Types.Mixed],
    },
    importMetadata: {
      source: String,
      importedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      importedAt: Date,
      checksum: String,
      validationSummary: mongoose.Schema.Types.Mixed,
    },
    lastChecked: Date,
    lastUpdateDetected: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedAt: Date,
  },
  { timestamps: true }
);

uscisFormTemplateSchema.pre("validate", function syncDefinitionCompatibility(next) {
  if (this.formNumber && !this.formCode) this.formCode = this.formNumber;
  if (this.formCode && !this.formNumber) this.formNumber = this.formCode;
  if (!this.registryId && this.formCode && this.version) this.registryId = `${this.formCode}:${this.version}`;
  if (this.formName && !this.title) this.title = this.formName;
  if (this.title && !this.formName) this.formName = this.title;
  if (this.visaCategory && !this.supportedVisaCategories?.includes(this.visaCategory)) {
    this.supportedVisaCategories = [...(this.supportedVisaCategories || []), this.visaCategory];
  }
  if (this.supportedVisaCategories?.length && !this.visaCategory) this.visaCategory = this.supportedVisaCategories[0];
  if (this.localPdfPath && !this.pdfTemplatePath) this.pdfTemplatePath = this.localPdfPath;
  if (this.pdfTemplatePath && !this.localPdfPath) this.localPdfPath = this.pdfTemplatePath;
  if (this.status === "pending_review") this.status = "review";
  this.currentStatus = this.status;
  this.activeFlag = this.status === "active";
  if (!this.mappingConfiguration || Object.keys(this.mappingConfiguration || {}).length === 0) this.mappingConfiguration = this.mappingGraph || {};
  if (!this.validationConfiguration || Object.keys(this.validationConfiguration || {}).length === 0) this.validationConfiguration = this.validationRules || {};
  if (!this.renderingConfiguration || Object.keys(this.renderingConfiguration || {}).length === 0) {
    this.renderingConfiguration = { layout: this.formLayout || {}, structure: this.formStructure || {} };
  }
  if (!this.importedAt && this.importMetadata?.importedAt) this.importedAt = this.importMetadata.importedAt;
  this.formFields = (this.formFields || []).map((field, index) => {
    const fieldId = field.fieldId || field.fieldName || `field_${index + 1}`;
    const sectionKey = field.sectionKey || field.sectionId || "general";
    return {
      ...(field.toObject?.() || field),
      fieldId,
      fieldName: field.fieldName || fieldId,
      fieldType: field.fieldType || field.type || "text",
      type: field.type || field.fieldType || "text",
      fieldLabel: field.fieldLabel || field.label || fieldId,
      label: field.label || field.fieldLabel || fieldId,
      sectionKey,
      sectionId: field.sectionId || sectionKey,
      required: Boolean(field.required || field.validation?.required || field.validationRules?.required),
      validation: field.validation || field.validationRules || {},
      validationRules: field.validationRules || field.validation || {},
      conditionalLogic: field.conditionalLogic || field.showWhen,
      showWhen: field.showWhen || field.conditionalLogic,
    };
  });
  this.sections = (this.sections || []).map((section, index) => {
    const sectionId = section.sectionId || section.key || `section_${index + 1}`;
    return {
      ...(section.toObject?.() || section),
      sectionId,
      key: section.key || sectionId,
      order: section.order ?? index,
      conditionalLogic: section.conditionalLogic || section.showWhen,
      showWhen: section.showWhen || section.conditionalLogic,
    };
  });
  next();
});

// Matches listRegistry's default sort ({formCode:1, editionDate:-1,
// version:-1}) exactly. Without it, listing forms with no (or a partial)
// filter forces Mongo into an in-memory sort of full documents - each one
// embeds hundreds of formFields entries plus formStructure/mappingConfiguration,
// so even this collection's 7 rows blow the 32MB sort buffer
// ("Sort exceeded memory limit... Pass allowDiskUse:true", confirmed via
// GET /uscis-forms/registry returning 500). An index lets Mongo satisfy the
// sort from the index keys alone, without touching the heavy document bodies.
uscisFormTemplateSchema.index({ formCode: 1, editionDate: -1, version: -1 });
uscisFormTemplateSchema.index({ formCode: 1, version: 1 }, { unique: true });
uscisFormTemplateSchema.index({ formNumber: 1, version: 1 });
uscisFormTemplateSchema.index({ registryId: 1 }, { unique: true, sparse: true });
uscisFormTemplateSchema.index({ "artifacts.form.checksum": 1 }, { sparse: true });
uscisFormTemplateSchema.index({ "artifacts.instructions.checksum": 1 }, { sparse: true });
uscisFormTemplateSchema.index({ formCode: 1, status: 1, activeFlag: 1, editionDate: -1 });
uscisFormTemplateSchema.index({ formCode: 1, officialStatus: 1, editionDate: -1 });
uscisFormTemplateSchema.index({ formCode: 1, status: 1, editionDate: -1, effectiveDate: -1 });
uscisFormTemplateSchema.index({ "lifecycle.provider": 1, formCode: 1, status: 1 });
uscisFormTemplateSchema.index({ formCode: "text", title: "text", description: "text", visaTypes: "text" });

module.exports = mongoose.model("USCISFormTemplate", uscisFormTemplateSchema);
