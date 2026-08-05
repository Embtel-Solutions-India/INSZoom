const mongoose = require("mongoose");
const Question = require("./Question");

// "petitioner"/"beneficiary" are the family/sponsor-visa (K-1/K-3) two-party
// path — additive, mirrors "employer"/"employee" as a separate pair, never
// reused/overloaded onto them.
const CHECKLIST_ROLES = ["employer", "employee", "petitioner", "beneficiary", "client", "business_plan", "case_manager", "team_lead", "admin", ""];

// Assigns or removes a *different* checklist (Questionnaire) when this
// questionnaire's answers satisfy `condition` — evaluated on submit by
// checklist-rule-engine.service.js. Reuses Question's exact recursive AND/OR
// condition shape rather than redefining it.
const checklistTriggerSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: String,
    sourceQuestionKey: { type: String, required: true },
    condition: { type: Question.conditionalGroupSchema, default: () => ({}) },
    action: { type: String, enum: ["assign", "remove"], required: true },
    targetQuestionnaireKey: { type: String, required: true },
    targetRole: { type: String, enum: CHECKLIST_ROLES },
    active: { type: Boolean, default: true },
  },
  { _id: true }
);

const auditHistorySchema = new mongoose.Schema(
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

const sectionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    title: { type: String, required: true },
    description: String,
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
    repeatable: { type: Boolean, default: false },
    minRepeats: { type: Number, default: 0 },
    maxRepeats: Number,
    conditionalLogic: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: true }
);

const pageSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    title: { type: String, required: true },
    description: String,
    order: { type: Number, default: 0 },
    sectionKeys: [{ type: String }],
    conditionalLogic: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: true }
);

const approvalStepSchema = new mongoose.Schema(
  {
    name: String,
    role: String,
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    status: { type: String, enum: ["pending", "approved", "rejected", "skipped"], default: "pending" },
    decidedAt: Date,
    notes: String,
  },
  { _id: true }
);

const collaborationCommentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    body: String,
    targetType: { type: String, enum: ["questionnaire", "page", "section", "question"], default: "questionnaire" },
    targetKey: String,
    resolved: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const questionnaireSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    description: String,
    version: { type: Number, default: 1 },
    visaType: { type: String, index: true },
    isActive: { type: Boolean, default: true, index: true },
    status: { type: String, enum: ["draft", "published", "archived"], default: "draft", index: true },
    type: {
      type: String,
      enum: ["questionnaire", "template", "library_item", "uscis_mapping"],
      default: "questionnaire",
      index: true,
    },
    module: { type: String, enum: ["cases", "clients", "employers", "uscis_forms", "custom"], default: "cases", index: true },
    category: { type: String, default: "immigration", index: true },
    // Explicit opt-in for a questionnaire meant to apply across every visa
    // (e.g. a truly generic intake form) — the ONLY way a questionnaire with
    // no visaType/visaTypes/assignmentRules.visaTypes can still be assigned
    // to a case. Absence of a visa scope must never itself mean "matches
    // every visa" (see ImmigrationKnowledgeEngineService.questionnaireApplies).
    appliesToAllVisas: { type: Boolean, default: false },
    visaTypes: [{ type: String, index: true }],
    caseTypes: [{ type: String, index: true }],
    tags: [{ type: String, index: true }],
    isTemplate: { type: Boolean, default: false, index: true },
    templateCategory: { type: String, index: true },
    checklistRole: { type: String, enum: CHECKLIST_ROLES, default: "", index: true },
    isDefault: { type: Boolean, default: false, index: true },
    libraryVisibility: { type: String, enum: ["private", "team", "organization", "public"], default: "organization", index: true },
    sourceQuestionnaire: { type: mongoose.Schema.Types.ObjectId, ref: "Questionnaire" },
    rootQuestionnaire: { type: mongoose.Schema.Types.ObjectId, ref: "Questionnaire" },
    parentVersion: { type: mongoose.Schema.Types.ObjectId, ref: "Questionnaire" },
    latestVersion: { type: Boolean, default: true, index: true },
    versionLabel: String,
    changeSummary: String,
    pages: [pageSchema],
    sections: [sectionSchema],
    settings: {
      multiStep: { type: Boolean, default: true },
      autoSave: { type: Boolean, default: true },
      allowBackNavigation: { type: Boolean, default: true },
      requireReview: { type: Boolean, default: true },
      progressMode: { type: String, enum: ["questions", "sections", "weighted"], default: "questions" },
      defaultLocale: { type: String, default: "en" },
      supportedLocales: [{ type: String }],
      enableCollaboration: { type: Boolean, default: true },
      enableBranching: { type: Boolean, default: true },
      enableDigitalSignature: { type: Boolean, default: false },
      allowPdfExport: { type: Boolean, default: true },
      allowImportExport: { type: Boolean, default: true },
    },
    builder: {
      dragDropEnabled: { type: Boolean, default: true },
      layout: { type: String, enum: ["single_page", "multi_page", "wizard"], default: "wizard" },
      pageOrder: [{ type: String }],
      sectionOrder: [{ type: String }],
      questionOrder: [{ type: String }],
      canvas: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    visibility: {
      roles: [{ type: String }],
      companies: [{ type: mongoose.Schema.Types.ObjectId, ref: "Company" }],
      caseTypes: [{ type: String }],
      visaTypes: [{ type: String }],
    },
    assignmentRules: {
      visaCategories: [String],
      visaTypes: [String],
      caseTypes: [String],
      petitionTypes: [String],
      applicantTypes: [String],
      employerTypes: [String],
      organizationRules: mongoose.Schema.Types.Mixed,
      required: { type: Boolean, default: true },
      priority: { type: Number, default: 0 },
      // L-1A's Business Plan checklist only applies to a New Office
      // petition — gated on the case's own "Is this a New Office petition?"
      // intake answer (caseData.assessmentAnswers.newOfficePetition), not a
      // visa/case-type dimension. See ImmigrationKnowledgeEngineService.
      requiresNewOfficePetition: { type: Boolean, default: false },
    },
    // Dynamic checklist assignment: assign/remove other Questionnaires based
    // on this one's answers. See checklist-rule-engine.service.js.
    checklistTriggers: [checklistTriggerSchema],
    documentRequirements: [mongoose.Schema.Types.Mixed],
    evidenceRequirements: [mongoose.Schema.Types.Mixed],
    requiredCanonicalFields: [String],
    taskTemplates: [mongoose.Schema.Types.Mixed],
    approval: {
      status: { type: String, enum: ["not_required", "draft", "pending_review", "approved", "rejected"], default: "draft", index: true },
      requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      requestedAt: Date,
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      reviewedAt: Date,
      notes: String,
      steps: [approvalStepSchema],
    },
    collaboration: {
      lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      lockedAt: Date,
      lockExpiresAt: Date,
      activeUsers: [
        {
          user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          role: String,
          lastSeenAt: Date,
        },
      ],
      comments: [collaborationCommentSchema],
    },
    localization: { type: mongoose.Schema.Types.Mixed, default: {} },
    uscisMappings: [
      {
        formNumber: String,
        formVersion: String,
        fieldMappings: { type: mongoose.Schema.Types.Mixed, default: {} },
      },
    ],
    analytics: {
      assignedCount: { type: Number, default: 0 },
      startedCount: { type: Number, default: 0 },
      submittedCount: { type: Number, default: 0 },
      averageCompletionSeconds: { type: Number, default: 0 },
      averageCompletionPercent: { type: Number, default: 0 },
      clonedCount: { type: Number, default: 0 },
      abandonedCount: { type: Number, default: 0 },
      lastSubmittedAt: Date,
    },
    aiGeneration: {
      enabled: { type: Boolean, default: false },
      prompt: String,
      provider: String,
      model: String,
      generatedAt: Date,
      generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    generation: {
      source: { type: String, enum: ["manual", "uscis_question_library"], default: "manual", index: true },
      fingerprint: { type: String, unique: true, sparse: true, index: true },
      formTemplateIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "USCISFormTemplate" }],
      libraryItemIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "QuestionLibraryItem" }],
      generatedAt: Date,
      generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    importExport: {
      importedFrom: String,
      importedAt: Date,
      importedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      exportedAt: Date,
      exportedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    pdf: {
      enabled: { type: Boolean, default: false },
      templateDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document" },
      outputFolder: String,
    },
    digitalSignature: {
      required: { type: Boolean, default: false },
      provider: String,
      signerRoles: [{ type: String }],
    },
    publishedAt: Date,
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    auditHistory: [auditHistorySchema],
  },
  { timestamps: true }
);

questionnaireSchema.pre("validate", function syncEnterpriseFields(next) {
  if (this.visaType && !this.visaTypes?.includes(this.visaType)) {
    this.visaTypes = [...(this.visaTypes || []), this.visaType];
  }
  if (!this.visaType && this.visaTypes?.length) this.visaType = this.visaTypes[0];
  if (this.isActive === false && this.status !== "archived") this.status = "archived";
  if (this.status === "archived") this.isActive = false;
  if (this.status !== "archived" && this.isActive === undefined) this.isActive = true;
  next();
});

questionnaireSchema.index({ key: 1, version: 1 }, { unique: true });
questionnaireSchema.index({ status: 1, module: 1, category: 1 });
questionnaireSchema.index({ isTemplate: 1, libraryVisibility: 1, category: 1 });
questionnaireSchema.index({ rootQuestionnaire: 1, version: -1 });
questionnaireSchema.index({ "assignmentRules.visaTypes": 1, status: 1, latestVersion: 1 });
questionnaireSchema.index({ status: 1, isActive: 1, latestVersion: 1, isDefault: 1, checklistRole: 1, visaType: 1, version: -1 });
questionnaireSchema.index({ status: 1, isActive: 1, latestVersion: 1, isDefault: 1, visaTypes: 1, version: -1 });

module.exports = mongoose.model("Questionnaire", questionnaireSchema);
