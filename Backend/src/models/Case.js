const mongoose = require("mongoose");
const { CASE_LIFECYCLE_STAGES, CASE_STATUSES, CRM_STAGES, PRIORITIES, STAGE_NAMES } = require("../modules/cases/case.constants");
const { PACKAGE_NAMES } = require("../config/packages");

const activitySchema = new mongoose.Schema(
  {
    action: String,
    description: String,
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const auditHistorySchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    entity: { type: String, default: "case" },
    changes: mongoose.Schema.Types.Mixed,
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    performedAt: { type: Date, default: Date.now },
    ipAddress: String,
    userAgent: String,
    description: String,
  },
  { _id: true }
);

const timelineEventSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    title: { type: String, required: true },
    description: String,
    metadata: mongoose.Schema.Types.Mixed,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const internalNoteSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    note: { type: String, required: true, trim: true },
    isInternal: { type: Boolean, default: true },
    category: {
      type: String,
      enum: ["general", "legal_strategy", "evidence", "forms", "client_communication", "filing", "deadline"],
      default: "general",
      index: true,
    },
    visibility: { type: String, enum: ["team", "private"], default: "team", index: true },
    pinned: { type: Boolean, default: false, index: true },
    mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    attachments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Document" }],
    editHistory: [
      {
        previousNote: String,
        editedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        editedAt: { type: Date, default: Date.now },
      },
    ],
    deletedAt: Date,
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdAt: { type: Date, default: Date.now },
    updatedAt: Date,
  },
  { _id: true }
);

const assignmentHistorySchema = new mongoose.Schema(
  {
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    previousAssignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    assignedAt: { type: Date, default: Date.now },
    role: { type: String, enum: ["primary_owner", "secondary_owner", "team_lead", "case_manager", "agent"], required: true },
    notes: String,
    changeType: { type: String, enum: ["assigned", "reassigned", "removed"], default: "assigned" },
  },
  { _id: true }
);

const keyDateSchema = new mongoose.Schema(
  {
    label: String,
    date: Date,
    completed: { type: Boolean, default: false },
  },
  { _id: false }
);

const stageHistorySchema = new mongoose.Schema(
  {
    stage: { type: Number, required: true },
    stageName: { type: String, required: true },
    crmStage: { type: String, enum: CRM_STAGES },
    enteredAt: { type: Date, default: Date.now },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    notes: String,
  },
  { _id: true }
);

const checklistFileSchema = new mongoose.Schema(
  {
    originalName: String,
    storedName: String,
    storageKey: String,
    size: Number,
    mimeType: String,
    uploadedAt: { type: Date, default: Date.now },
    document: { type: mongoose.Schema.Types.ObjectId, ref: "Document" },
  },
  { _id: false }
);

const checklistItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    documentType: String,
    description: String,
    required: { type: Boolean, default: true },
    category: { type: String, default: "general" },
    targetRole: { type: String, enum: ["employee", "employer", "client", "both", "business_plan", "case_manager", "team_lead", "admin", ""], default: "client", index: true },
    status: {
      type: String,
      enum: ["pending", "requested", "submitted", "uploaded", "approved", "rejected"],
      default: "pending",
    },
    requestedDate: Date,
    participantId: { type: mongoose.Schema.Types.ObjectId, index: true },
    dueDate: Date,
    uploadedDate: Date,
    uploadedFiles: [checklistFileSchema],
    adminNotes: String,
    notes: String,
    submittedAt: Date,
    reviewedAt: Date,
    // Only present for requirements sourced from a questionnaire's
    // conditional file question (question.conditionalLogic) - preserves
    // when the document applies once it's merged into the case-level
    // checklist, since the live questionnaire re-fetch isn't always used.
    condition: mongoose.Schema.Types.Mixed,
  },
  { _id: true }
);

const referenceSchema = new mongoose.Schema(
  {
    refId: { type: mongoose.Schema.Types.ObjectId, required: true },
    refModel: { type: String, required: true },
    label: String,
    status: String,
    version: String,
    editionDate: Date,
    mappingVersion: Number,
    validationVersion: Number,
    renderingVersion: Number,
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const linkedCaseSchema = new mongoose.Schema(
  {
    case: { type: mongoose.Schema.Types.ObjectId, ref: "Case", required: true },
    relationship: { type: String, enum: ["related", "parent", "child", "derivative", "amendment", "extension", "renewal", "appeal"], default: "related" },
    notes: String,
    linkedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    linkedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const questionnaireReferenceSchema = new mongoose.Schema(
  {
    questionnaireId: { type: mongoose.Schema.Types.ObjectId },
    responseId: String,
    questionnaireTemplateId: { type: mongoose.Schema.Types.ObjectId },
    title: String,
    targetRole: { type: String, enum: ["employer", "employee", "client", "business_plan", "case_manager", "team_lead", "admin", "petitioner", "beneficiary", ""], default: "" },
    participantId: { type: mongoose.Schema.Types.ObjectId, index: true },
    participantRole: { type: String, index: true },
    // Checklist lifecycle: not_started -> in_progress -> completed -> submitted -> (returned -> in_progress) | approved.
    // Auto-transitioned in questionnaire.service.js's saveAnswers/submitResponse/approveResponse.
    status: { type: String, enum: ["not_started", "in_progress", "completed", "submitted", "returned", "approved"], default: "not_started" },
    // Soft-remove flag for checklist-rule-engine.service.js's "remove" action -
    // preserves the reference/answers instead of deleting them outright.
    active: { type: Boolean, default: true },
    sentAt: Date,
    submittedAt: Date,
    approvedAt: Date,
    dueDate: Date,
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    notes: String,
  },
  { _id: true }
);

const addonSchema = new mongoose.Schema(
  {
    service: { type: String, required: true, trim: true },
    key: { type: String, required: true, index: true },
    form: String,
    status: {
      type: String,
      enum: ["available", "pending_payment", "payment_pending", "paid", "waiting_for_information", "ready_for_preparation", "prepared", "filed", "clock_started", "completed", "cancelled"],
      default: "pending_payment",
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ["not_started", "pending", "paid", "failed", "refunded"],
      default: "not_started",
      index: true,
    },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: "Payment" },
    governmentFeeCents: { type: Number, default: 0 },
    attorneyFeeCents: { type: Number, default: 0 },
    totalFeeCents: { type: Number, default: 0 },
    processingTime: String,
    purchasedAt: Date,
    paidAt: Date,
    filedAt: Date,
    clockStartedAt: Date,
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    intake: {
      alienRegistrationNumber: String,
      uscisOnlineAccountNumber: String,
      filerFamilyName: String,
      filerGivenName: String,
      companyOrganizationName: String,
      mailingStreet: String,
      mailingApt: String,
      mailingCity: String,
      mailingState: String,
      mailingZipCode: String,
      mailingProvince: String,
      mailingPostalCode: String,
      mailingCountry: String,
      samePhysicalAddress: String,
      physicalStreet: String,
      physicalApt: String,
      physicalCity: String,
      physicalState: String,
      physicalZipCode: String,
      physicalProvince: String,
      physicalPostalCode: String,
      physicalCountry: String,
      relatedReceiptNumber: String,
      relatedReceiptNumber2: String,
      companyContact: String,
      ein: String,
      pointOfContact: String,
      pointOfContactFamilyName: String,
      pointOfContactGivenName: String,
      pointOfContactTitle: String,
      relatedFormNumber: String,
      petitionerFamilyName: String,
      petitionerGivenName: String,
      beneficiaryFamilyName: String,
      beneficiaryGivenName: String,
    },
    requiredDocuments: [
      {
        name: String,
        documentType: String,
        required: { type: Boolean, default: true },
        status: { type: String, default: "requested" },
      },
    ],
    history: [
      {
        status: String,
        note: String,
        at: { type: Date, default: Date.now },
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      },
    ],
  },
  { _id: true }
);

const participantApprovalSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["employer", "employee", "case_manager"], required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    status: { type: String, enum: ["not_requested", "requested", "approved", "rejected", "changes_requested"], default: "not_requested", index: true },
    requestedAt: Date,
    decidedAt: Date,
    notes: String,
  },
  { _id: true }
);

const informationRequestSchema = new mongoose.Schema(
  {
    target: { type: String, enum: ["employer", "employee"], required: true, index: true },
    title: { type: String, required: true },
    description: String,
    requestType: { type: String, enum: ["profile", "questionnaire", "document", "approval", "other"], default: "other", index: true },
    documentType: String,
    status: { type: String, enum: ["open", "submitted", "approved", "rejected", "closed"], default: "open", index: true },
    dueDate: Date,
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    participantId: { type: mongoose.Schema.Types.ObjectId, index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    requestedAt: { type: Date, default: Date.now },
    submittedAt: Date,
    resolvedAt: Date,
    task: { type: mongoose.Schema.Types.ObjectId, ref: "Task" },
    notes: String,
  },
  { _id: true }
);

const participantInviteSchema = new mongoose.Schema(
  {
    email: { type: String, lowercase: true, trim: true },
    name: String,
    phone: String,
    status: { type: String, enum: ["not_sent", "sent", "accepted", "declined", "expired", ""], default: "" },
    invitedAt: Date,
    acceptedAt: Date,
    declinedAt: Date,
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    tokenVersion: { type: Number, default: 0 },
  },
  { _id: false }
);

const participantProgressSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ["not_started", "not_invited", "invited", "in_progress", "submitted", "needs_info", "approved", "declined", "deleted", "replaced"], default: "not_started", index: true },
    percent: { type: Number, min: 0, max: 100, default: 0 },
    questionnaire: mongoose.Schema.Types.Mixed,
    checklist: mongoose.Schema.Types.Mixed,
    documents: mongoose.Schema.Types.Mixed,
    ocr: mongoose.Schema.Types.Mixed,
    forms: mongoose.Schema.Types.Mixed,
    lastCalculatedAt: Date,
  },
  { _id: false }
);

const caseParticipantSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["employer", "employee", "beneficiary", "dependent", "petitioner", "client", "business", "case_manager", "team_lead", "admin", ""],
      required: true,
      index: true,
    },
    label: String,
    status: {
      type: String,
      enum: ["active", "invited", "in_progress", "submitted", "needs_info", "approved", "declined", "deleted", "replaced", "inactive"],
      default: "active",
      index: true,
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", index: true },
    beneficiaryId: { type: mongoose.Schema.Types.ObjectId, ref: "Beneficiary", index: true },
    petitionerId: { type: mongoose.Schema.Types.ObjectId, refPath: "participants.petitionerModel", index: true },
    petitionerModel: { type: String, enum: ["User", "Client", "Company", "Beneficiary", ""], default: "" },
    email: { type: String, lowercase: true, trim: true, index: true },
    name: String,
    phone: String,
    invite: participantInviteSchema,
    questionnaireId: { type: mongoose.Schema.Types.ObjectId, ref: "Questionnaire", index: true },
    responseId: { type: String, index: true },
    canonicalProfileId: { type: mongoose.Schema.Types.ObjectId, index: true },
    canonicalProfile: mongoose.Schema.Types.Mixed,
    documentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Document", index: true }],
    ocrResultIds: [{ type: mongoose.Schema.Types.ObjectId, index: true }],
    checklistItemIds: [{ type: mongoose.Schema.Types.ObjectId }],
    uscisFormIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "CaseForm", index: true }],
    letterIds: [{ type: mongoose.Schema.Types.ObjectId, index: true }],
    evidenceIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Document", index: true }],
    progress: participantProgressSchema,
    reviewStatus: { type: String, enum: ["not_started", "pending", "in_review", "needs_info", "approved", "rejected"], default: "not_started", index: true },
    submissionStatus: { type: String, enum: ["not_started", "in_progress", "submitted", "accepted", "rejected"], default: "not_started", index: true },
    activityLog: [activitySchema],
    notificationIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Notification" }],
    metadata: mongoose.Schema.Types.Mixed,
    replacedBy: { type: mongoose.Schema.Types.ObjectId },
    replacedAt: Date,
    deletedAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { _id: true, timestamps: true }
);

const caseSchema = new mongoose.Schema(
  {
    caseId: { type: String, unique: true, sparse: true },
    caseNumber: { type: String, unique: true, required: true },
    clientPortalId: { type: String, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    employeeUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    employerUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    clientProfile: { type: mongoose.Schema.Types.ObjectId, ref: "Client", index: true },
    beneficiary: { type: mongoose.Schema.Types.ObjectId, ref: "Beneficiary", index: true },
    petitioner: { type: mongoose.Schema.Types.ObjectId, refPath: "petitionerModel", index: true },
    petitionerModel: { type: String, enum: ["User", "Client", "Company", "Beneficiary", ""], default: "" },
    petitionerName: { type: String, trim: true },
    petitionerEin: { type: String, trim: true },
    employerCompanyProfile: { type: mongoose.Schema.Types.Mixed, default: {} },
    employer: { type: mongoose.Schema.Types.ObjectId, ref: "Company", index: true },
    organization: { type: mongoose.Schema.Types.ObjectId, ref: "Company", index: true },
    parentCase: { type: mongoose.Schema.Types.ObjectId, ref: "Case", index: true },
    childCases: [{ type: mongoose.Schema.Types.ObjectId, ref: "Case", index: true }],
    linkedCases: [linkedCaseSchema],
    // Single-party filings (COS/extension/EAD/reinstatement — see
    // Backend/src/config/filingTypes.js) are standalone by design: this is
    // an OPTIONAL, nullable pointer to a principal case (e.g. an H-4
    // Extension's underlying H-1B case) for informational linkage only.
    // Never required, never creates a dependency — a filing with this unset
    // works identically to one with it set. Additive alongside (not a
    // replacement for) parentCase/linkedCases, which serve broader/different
    // purposes across the rest of the app.
    principalCaseRef: { type: mongoose.Schema.Types.ObjectId, ref: "Case", index: true, default: null },
    clientName: { type: String, trim: true },
    clientEmail: { type: String, lowercase: true, trim: true },
    employeeInvite: {
      email: { type: String, lowercase: true, trim: true },
      name: String,
      phone: String,
      status: { type: String, enum: ["not_sent", "sent", "accepted", "expired", ""], default: "" },
      invitedAt: Date,
      acceptedAt: Date,
      invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },

    visaCategory: { type: String, default: "" },
    visaType: { type: String, required: true, trim: true },
    caseType: { type: String, default: "immigration", index: true },
    petitionType: { type: String, trim: true, index: true },
    petitionSubType: { type: String, trim: true },
    package: { type: String, enum: [...PACKAGE_NAMES, ""], default: "" },
    primaryPackage: { type: String, trim: true },
    addons: [addonSchema],
    jobPosition: {
      title: String,
      socCode: String,
      salary: Number,
      salaryUnit: { type: String, enum: ["hour", "week", "biweekly", "month", "year", ""], default: "" },
      worksiteAddress: mongoose.Schema.Types.Mixed,
      workLocations: [mongoose.Schema.Types.Mixed],
      startDate: Date,
      endDate: Date,
      endClientName: String,
      fullTime: { type: Boolean, default: true },
      duties: String,
      minimumRequirements: String,
      managerName: String,
      managerTitle: String,
      workforce: mongoose.Schema.Types.Mixed,
    },
    employerEmployeeWorkflow: {
      employerStatus: { type: String, enum: ["not_started", "invited", "in_progress", "submitted", "needs_info", "approved"], default: "not_started", index: true },
      employeeStatus: { type: String, enum: ["not_invited", "invited", "in_progress", "submitted", "needs_info", "approved"], default: "not_invited", index: true },
      caseManagerStatus: { type: String, enum: ["new_case", "waiting_for_employee", "waiting_for_employer", "ready_for_review", "ready_for_petition", "ready_to_file", "filed", "rfe", "approved", "closed"], default: "new_case", index: true },
      employerSubmittedAt: Date,
      employeeSubmittedAt: Date,
      readyForReviewAt: Date,
    },
    participantApprovals: [participantApprovalSchema],
    informationRequests: [informationRequestSchema],
    participants: [caseParticipantSchema],

    // Family/sponsor visa two-party path (K-1/K-3: petitioner + beneficiary) —
    // additive and separate from employerUser/employeeUser/employeeInvite/
    // employerEmployeeWorkflow above, which this does NOT reuse or overload.
    // Mirrors that shape 1:1 under its own field names; see
    // modules/family-workflow/.
    petitionerUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    beneficiaryUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    beneficiaryInvite: {
      email: { type: String, lowercase: true, trim: true },
      name: String,
      phone: String,
      status: { type: String, enum: ["not_sent", "sent", "accepted", "expired", ""], default: "" },
      invitedAt: Date,
      acceptedAt: Date,
      invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    // Mirrors employeeCompletionMode's request-level concept ("employer_completes"
    // vs "invite"), but persisted on the case since the family flow has no
    // separate questionnaireData.masterData assignment-mode convention to piggyback on.
    familyCompletionMode: { type: String, enum: ["petitioner_completes", "invite_beneficiary", ""], default: "" },
    familyWorkflow: {
      petitionerStatus: { type: String, enum: ["not_started", "in_progress", "submitted", "needs_info", "approved"], default: "not_started", index: true },
      beneficiaryStatus: { type: String, enum: ["not_invited", "invited", "in_progress", "submitted", "needs_info", "approved"], default: "not_invited", index: true },
      caseManagerStatus: { type: String, enum: ["new_case", "waiting_for_beneficiary", "waiting_for_petitioner", "ready_for_review", "ready_for_petition", "ready_to_file", "filed", "rfe", "approved", "closed"], default: "new_case", index: true },
      petitionerSubmittedAt: Date,
      beneficiarySubmittedAt: Date,
      readyForReviewAt: Date,
    },

    currentStage: { type: Number, default: 0, min: 0, max: 7 },
    stage: { type: String, enum: CRM_STAGES, default: "intake", index: true },
    workflow: {
      stage: { type: String, enum: CRM_STAGES, default: "intake" },
      status: { type: String, enum: CASE_STATUSES, default: "active" },
      filingReadinessScore: { type: Number, min: 0, max: 100, default: 0 },
      lastTransitionAt: Date,
      lastTransitionBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    stageHistory: [stageHistorySchema],

    status: { type: String, enum: CASE_STATUSES, default: "active", index: true },
    previousStatus: { type: String, enum: CASE_STATUSES },
    archivedAt: Date,
    archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reopenedAt: Date,
    reopenedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    priority: { type: String, enum: PRIORITIES, default: "medium", index: true },

    assignedAgent: String,
    agentEmail: String,
    assignedAgentUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    primaryOwner: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    secondaryOwner: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    assignedTeamLead: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    assignedCaseManager: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    // Attorney of record during preparation/filing (distinct from
    // immigrationLifecycle.tracking.filing.filingAttorney, which records who
    // filed AFTER the fact). PetitionAssemblyService's buildMergeContext
    // already reads caseData.assignedAttorney to decide G-28 inclusion and
    // attorney presence in the merge context - this field never existed on
    // the schema, so that check silently evaluated to undefined/false for
    // every case. Phase H6.
    assignedAttorney: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    assignmentHistory: [assignmentHistorySchema],
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", index: true },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: "Team", index: true },

    filingDate: Date,
    uscisNumber: String,
    uscisReceiptNumber: String,
    receiptTracking: {
      receiptNumber: String,
      status: String,
      lastCheckedAt: Date,
      source: { type: String, enum: ["manual", "uscis", "import", ""], default: "manual" },
      history: [
        {
          status: String,
          checkedAt: { type: Date, default: Date.now },
          source: String,
          notes: String,
        },
      ],
    },
    uscisDecisionDate: Date,
    uscisDecision: { type: String, enum: ["approved", "denied", "rfe", "pending", ""] },
    rfeDeadline: Date,
    rfeResponseDate: Date,
    visaExpirationDate: Date,
    filingDeadline: Date,
    interviewDate: Date,
    biometricAppointmentDate: Date,
    keyDates: [keyDateSchema],

    documentChecklist: [checklistItemSchema],
    checklistItems: [checklistItemSchema],
    documentReferences: [{ type: mongoose.Schema.Types.ObjectId, ref: "Document" }],
    googleDrive: {
      syncStatus: { type: String, enum: ["not_started", "queued", "syncing", "synced", "failed", "not_configured"], default: "not_started", index: true },
      rootFolderId: String,
      folderId: String,
      folderPath: String,
      webViewLink: String,
      folders: mongoose.Schema.Types.Mixed,
      attempts: { type: Number, default: 0 },
      lastSyncedAt: Date,
      lastAttemptAt: Date,
      lastError: String,
    },
    excelWorkbook: {
      syncStatus: { type: String, enum: ["not_started", "generating", "updated", "failed"], default: "not_started", index: true },
      document: { type: mongoose.Schema.Types.ObjectId, ref: "Document" },
      storageKey: String,
      googleDriveFileId: String,
      generatedAt: Date,
      generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      lastError: String,
    },
    uscisFormReferences: [referenceSchema],
    questionnaireReferences: [questionnaireReferenceSchema],
    questionnaireData: {
      masterData: { type: mongoose.Schema.Types.Mixed, default: {} },
      masterDataPrefill: [
        {
          path: { type: String, required: true },
          value: mongoose.Schema.Types.Mixed,
          label: String,
          sourceDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document" },
          extractionId: { type: mongoose.Schema.Types.ObjectId, ref: "DocumentExtraction" },
          confidenceScore: Number,
          status: { type: String, enum: ["pending", "accepted", "rejected", "edited"], default: "pending" },
          existingValue: mongoose.Schema.Types.Mixed,
          extractedAt: { type: Date, default: Date.now },
        },
      ],
      responseId: { type: String, index: true },
      questionnaireId: { type: mongoose.Schema.Types.ObjectId, ref: "Questionnaire" },
      questionnaireKey: String,
      questionnaireVersion: Number,
      progress: { type: mongoose.Schema.Types.Mixed, default: {} },
      validation: {
        errors: [mongoose.Schema.Types.Mixed],
        warnings: [mongoose.Schema.Types.Mixed],
        missingRequired: [mongoose.Schema.Types.Mixed],
      },
      visibleQuestionKeys: [String],
      answeredQuestionKeys: [String],
      sectionProgress: [mongoose.Schema.Types.Mixed],
      lastAutoSavedAt: Date,
      lastSubmittedAt: Date,
      lastSyncedAt: Date,
      syncedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    knowledgePlan: {
      status: { type: String, enum: ["pending", "configured", "needs_configuration", "error"], default: "pending", index: true },
      ruleSources: [mongoose.Schema.Types.Mixed],
      formAssignments: [mongoose.Schema.Types.Mixed],
      questionnaireAssignments: [mongoose.Schema.Types.Mixed],
      documentRequirements: [mongoose.Schema.Types.Mixed],
      evidenceRequirements: [mongoose.Schema.Types.Mixed],
      requiredCanonicalFields: [String],
      missingCanonicalFields: [String],
      configurationIssues: [mongoose.Schema.Types.Mixed],
      autoFill: mongoose.Schema.Types.Mixed,
      generatedAt: Date,
      generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      sourceFingerprint: String,
    },
    paymentReferences: [{ type: mongoose.Schema.Types.ObjectId, ref: "Payment" }],
    taskReferences: [{ type: mongoose.Schema.Types.ObjectId, ref: "Task" }],
    workflowReferences: [{ type: mongoose.Schema.Types.ObjectId, ref: "Workflow" }],
    attachmentReferences: [{ type: mongoose.Schema.Types.ObjectId, ref: "Document" }],
    notificationReferences: [{ type: mongoose.Schema.Types.ObjectId, ref: "Notification" }],

    activityLog: [activitySchema],
    timeline: [timelineEventSchema],
    auditHistory: [auditHistorySchema],
    notes: String,
    externalNotes: [internalNoteSchema],
    internalNotes: [internalNoteSchema],

    plan: {
      tier: { type: String, enum: [...PACKAGE_NAMES, ""], default: "" },
      selectedAt: Date,
      paymentStatus: { type: String, enum: ["not_started", "pending", "paid", "failed", "refunded"], default: "not_started" },
      amount: { type: Number, default: 0 },
      currency: { type: String, default: "USD" },
      paidAt: Date,
      paymentRef: String,
    },

    assessmentAnswers: { type: mongoose.Schema.Types.Mixed, default: null },
    assessmentMatchPercentage: { type: Number, default: 0 },
    eligibility: {
      latestEvaluation: mongoose.Schema.Types.Mixed,
      recommendationHistory: [mongoose.Schema.Types.Mixed],
      caseManagerOverrides: [mongoose.Schema.Types.Mixed],
      lastEvaluatedAt: Date,
      lastEvaluatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    immigrationLifecycle: {
      filingStatus: {
        type: String,
        enum: ["prepared", "ready_for_review", "approved_for_filing", "ready_to_file", "filed", "received_by_uscis", "in_processing", "completed", "rejected", "withdrawn", "closed", ""],
        default: "",
        index: true,
      },
      filings: [mongoose.Schema.Types.Mixed],
      receipts: [mongoose.Schema.Types.Mixed],
      governmentStatusHistory: [mongoose.Schema.Types.Mixed],
      rfes: [mongoose.Schema.Types.Mixed],
      approvals: [mongoose.Schema.Types.Mixed],
      denials: [mongoose.Schema.Types.Mixed],
      deadlines: [mongoose.Schema.Types.Mixed],
      journeyEvents: [mongoose.Schema.Types.Mixed],
      futureRecommendations: [mongoose.Schema.Types.Mixed],
      tracking: {
        status: {
          type: String,
          enum: ["draft", "ready_to_file", "filed", "delivered", "receipt_issued", "biometrics_scheduled", "biometrics_completed", "interview_scheduled", "interview_completed", "rfe_issued", "rfe_response_submitted", "transferred", "approved", "denied", "withdrawn", "closed"],
          default: "draft",
          index: true,
        },
        filing: {
          filingDate: Date,
          receiptNumber: String,
          serviceCenter: String,
          lockbox: String,
          filingMethod: { type: String, enum: ["", "paper", "online"], default: "" },
          carrier: { type: String, enum: ["", "fedex", "ups", "usps", "other"], default: "" },
          trackingNumber: String,
          deliveryConfirmationDate: Date,
          filingAttorney: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          filingFeeCents: { type: Number, min: 0, default: 0 },
          premiumProcessing: { type: Boolean, default: false },
        },
        rfe: {
          issueDate: Date,
          responseDueDate: Date,
          responseSubmittedDate: Date,
          responsibleCaseManager: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          documentReferences: [{ type: mongoose.Schema.Types.ObjectId, ref: "Document" }],
          aiSummary: String,
          responseStatus: {
            type: String,
            enum: ["", "pending", "preparing", "under_review", "ready_to_submit", "submitted", "accepted", "closed"],
            default: "",
          },
        },
        notes: String,
        lastUpdatedAt: Date,
        lastUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      },
      lastLifecycleUpdatedAt: Date,
      lastLifecycleUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    canonicalProfile: {
      profile: { type: mongoose.Schema.Types.Mixed, default: {} },
      fieldMetadata: { type: mongoose.Schema.Types.Mixed, default: {} },
      sources: [mongoose.Schema.Types.Mixed],
      conflicts: [mongoose.Schema.Types.Mixed],
      validation: { type: mongoose.Schema.Types.Mixed, default: {} },
      missingFields: [mongoose.Schema.Types.Mixed],
      version: { type: Number, default: 0 },
      status: { type: String, enum: ["not_built", "valid", "needs_review", "invalid"], default: "not_built", index: true },
      lastBuiltAt: Date,
      lastBuiltBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      sourceFingerprint: String,
    },
    canonicalHistory: [
      {
        version: Number,
        action: String,
        changes: mongoose.Schema.Types.Mixed,
        conflicts: [mongoose.Schema.Types.Mixed],
        validation: mongoose.Schema.Types.Mixed,
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        changedAt: { type: Date, default: Date.now },
        source: String,
        reason: String,
        snapshot: mongoose.Schema.Types.Mixed,
      },
    ],
    journeyProgress: {
      percent: { type: Number, min: 0, max: 100, default: 5 },
      currentMilestone: { type: String, default: "case_created", index: true },
      nextAction: {
        key: String,
        label: String,
        route: String,
        role: String,
      },
      milestones: [mongoose.Schema.Types.Mixed],
      metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
      lastCalculatedAt: Date,
      lastCalculatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    filingReadinessScore: { type: Number, min: 0, max: 100, default: 0 },
    lastSyncedAt: { type: Date, default: null },
    legacySource: { type: String, enum: ["BAIS", "INSZoom", "shared", ""], default: "shared" },
    // Set only by Backend/src/seeds/* on records those seeds actually CREATE.
    // Unrelated to `legacySource` (sync-origin marker). Consumed only by
    // DELETE /api/admin/demo-data.
    isDemoData: { type: Boolean, default: false, index: true },

    // ─── PHASE 2 ADDITIONS ──────────────────────────────────────────────────
    // These fields support the new case structure architecture.
    // ALL are optional with safe defaults. NO existing field is modified.
    //
    // NOTE: parent-case linkage already exists as `parentCase` (line 417) —
    // no separate `parentCaseId` is added here, per the Phase 1 audit finding
    // that adding a second field for the same concept would be redundant.
    // `createdBy` (line 406) also already exists as a simple ObjectId ref
    // User and is left unmodified.

    /**
     * The structural type of this case.
     * 'single'            = sole applicant, no children, no employer/employee
     * 'employer_employee' = employer + N employee child cases
     * 'family'            = petitioner + one beneficiary child case
     *
     * CRITICAL: single cases NEVER have children. childCaseCount MUST be 0 for single.
     */
    caseStructure: {
      type: String,
      enum: ["single", "employer_employee", "family"],
      default: null,
      index: true,
    },

    /**
     * The role this case plays within its case structure.
     * 'single'      = sole applicant case (caseStructure must be 'single')
     * 'principal'   = employer or petitioner in a multi-person matter
     * 'employee'    = individual employee child case
     * 'beneficiary' = beneficiary child case
     */
    caseRole: {
      type: String,
      enum: ["single", "principal", "employee", "beneficiary"],
      default: null,
      index: true,
    },

    /**
     * For child cases only: the sequential letter index within the parent matter.
     * 'A', 'B', 'C' ... 'Z', then 'AA', 'AB', etc.
     * NULL for single and principal cases.
     */
    childIndex: {
      type: String,
      default: null,
    },

    /**
     * For principal cases only: the total number of child cases in this matter.
     * 0 for single cases (must never be 1 for single — use 0).
     * 1 for family cases.
     * N for employer_employee cases.
     */
    childCaseCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * Where this case originated.
     * 'lead_conversion'   = created from an approved Lead via the admin Leads page
     * 'admin_direct'      = created directly by an Admin without a prior Lead
     * 'team_lead_direct'  = created directly by a Team Lead without a prior Lead
     */
    creationSource: {
      type: String,
      enum: ["lead_conversion", "admin_direct", "team_lead_direct"],
      default: null,
    },

    /**
     * The Lead document that was converted to create this case.
     * Only set when creationSource = 'lead_conversion'.
     * Null for direct-creation cases.
     *
     * Named `leadId` (not `caseLeadId`) — confirmed no existing field of
     * this name on Case as of this Phase 2 pass.
     */
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      default: null,
    },

    /**
     * The consultation appointment associated with this case's lead conversion.
     * Only set when creationSource = 'lead_conversion'.
     *
     * Named `consultationId` (not `caseConsultationId`) — confirmed no
     * existing field of this name on Case as of this Phase 2 pass.
     */
    consultationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      default: null,
    },

    /**
     * For employer/employee and family cases: the ObjectId of the EmployerProfile
     * document that holds shared employer/petitioner canonical data.
     * NULL for single cases.
     * Set on the principal case and inherited (referenced) by child cases.
     */
    employerProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EmployerProfile",
      default: null,
    },

    /**
     * For child cases only: the ObjectId of this child's personal EmployeeProfile
     * or BeneficiaryProfile (same model, discriminated by type field within it).
     * NULL for single and principal cases.
     */
    personProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    /**
     * Controls how employee/beneficiary data is entered.
     * 'not_required' = single-person visa, no other parties (never changes)
     * 'not_set'      = employer/family case, employer has not yet chosen
     * 'fill_self'    = employer/petitioner will fill employee/beneficiary tabs
     * 'invite'       = employees/beneficiary will be invited to fill their own data
     *
     * CRITICAL: single cases MUST have dataEntryMode = 'not_required'. This must
     * never be changed for single cases under any circumstance.
     */
    dataEntryMode: {
      type: String,
      enum: ["not_required", "not_set", "fill_self", "invite"],
      default: null,
    },

    /**
     * For child cases only: true when this child case has been individually
     * reassigned to a different case manager than the principal case's default.
     * False means this child inherits the principal's assignment.
     */
    assignmentOverridden: {
      type: Boolean,
      default: false,
    },
    // ─── END PHASE 2 ADDITIONS ───────────────────────────────────────────────
  },
  { timestamps: true }
);

caseSchema.pre("validate", function syncLegacyFields(next) {
  if (!this.caseId) this.caseId = this.caseNumber;
  if (!this.caseNumber) this.caseNumber = this.caseId;
  if (!this.clientPortalId) this.clientPortalId = this.caseId || this.caseNumber;
  if (this.stage && this.workflow) this.workflow.stage = this.stage;
  if (this.status && this.workflow) this.workflow.status = this.status;
  if (this.uscisNumber && !this.uscisReceiptNumber) this.uscisReceiptNumber = this.uscisNumber;
  if (this.uscisReceiptNumber && !this.uscisNumber) this.uscisNumber = this.uscisReceiptNumber;
  if ((!this.documentChecklist || this.documentChecklist.length === 0) && this.checklistItems?.length) {
    this.documentChecklist = this.checklistItems;
  }
  if ((!this.checklistItems || this.checklistItems.length === 0) && this.documentChecklist?.length) {
    this.checklistItems = this.documentChecklist;
  }
  if (!Array.isArray(this.participants)) this.participants = [];

  const hasParticipant = (role, userId, email, companyId) => this.participants.some((participant) => {
    if (participant.role !== role || participant.status === "deleted") return false;
    if (userId && participant.userId?.toString?.() === userId.toString()) return true;
    if (email && participant.email === String(email).toLowerCase()) return true;
    if (companyId && participant.companyId?.toString?.() === companyId.toString()) return true;
    return false;
  });
  if (this.employerUser && !hasParticipant("employer", this.employerUser, null, this.companyId || this.employer || this.organization)) {
    this.participants.push({
      role: "employer",
      status: "active",
      userId: this.employerUser,
      companyId: this.companyId || this.employer || this.organization,
      name: this.petitionerName,
      progress: { status: this.employerEmployeeWorkflow?.employerStatus || "not_started" },
    });
  }
  const legacyEmployeeEmail = this.employeeInvite?.email || this.clientEmail;
  if ((this.employeeUser || legacyEmployeeEmail || this.beneficiary) && !hasParticipant("employee", this.employeeUser || this.user, legacyEmployeeEmail, null)) {
    this.participants.push({
      role: "employee",
      status: this.employeeInvite?.status === "sent" ? "invited" : "active",
      userId: this.employeeUser || this.user,
      beneficiaryId: this.beneficiary,
      email: legacyEmployeeEmail,
      name: this.employeeInvite?.name || this.clientName,
      phone: this.employeeInvite?.phone,
      invite: this.employeeInvite,
      progress: { status: this.employerEmployeeWorkflow?.employeeStatus || "not_started" },
    });
  }
  if (this.petitionerUser && !hasParticipant("petitioner", this.petitionerUser, null, null)) {
    this.participants.push({ role: "petitioner", status: "active", userId: this.petitionerUser, progress: { status: this.familyWorkflow?.petitionerStatus || "not_started" } });
  }
  if ((this.beneficiaryUser || this.beneficiaryInvite?.email) && !hasParticipant("beneficiary", this.beneficiaryUser || this.user, this.beneficiaryInvite?.email, null)) {
    this.participants.push({
      role: "beneficiary",
      status: this.beneficiaryInvite?.status === "sent" ? "invited" : "active",
      userId: this.beneficiaryUser || this.user,
      email: this.beneficiaryInvite?.email,
      name: this.beneficiaryInvite?.name,
      phone: this.beneficiaryInvite?.phone,
      invite: this.beneficiaryInvite,
      progress: { status: this.familyWorkflow?.beneficiaryStatus || "not_started" },
    });
  }
  next();
});

caseSchema.index({ user: 1, createdAt: -1 });
caseSchema.index({ createdAt: -1, _id: -1 });
caseSchema.index({ status: 1, createdAt: -1, _id: -1 });
caseSchema.index({ stage: 1, createdAt: -1, _id: -1 });
caseSchema.index({ visaType: 1, createdAt: -1, _id: -1 });
caseSchema.index({ employeeUser: 1, createdAt: -1 });
caseSchema.index({ "participants._id": 1, "participants.role": 1, "participants.status": 1 });
caseSchema.index({ "participants.userId": 1, "participants.status": 1, updatedAt: -1 });
caseSchema.index({ "participants.email": 1, "participants.role": 1, "participants.status": 1 });
caseSchema.index({ "participants.role": 1, "participants.status": 1, visaType: 1 });
caseSchema.index({ "participants.questionnaireId": 1, "participants.responseId": 1 });
caseSchema.index({ employerUser: 1, createdAt: -1 });
caseSchema.index({ petitionerUser: 1, createdAt: -1 });
caseSchema.index({ beneficiaryUser: 1, createdAt: -1 });
caseSchema.index({ createdBy: 1, createdAt: -1 });
caseSchema.index({ clientProfile: 1, createdAt: -1 });
caseSchema.index({ beneficiary: 1, createdAt: -1 });
caseSchema.index({ petitioner: 1, createdAt: -1 });
caseSchema.index({ employer: 1, status: 1 });
caseSchema.index({ organization: 1, status: 1 });
caseSchema.index({ companyId: 1, "employerEmployeeWorkflow.caseManagerStatus": 1 });
caseSchema.index({ parentCase: 1, createdAt: -1 });
caseSchema.index({ caseType: 1, status: 1 });
caseSchema.index({ petitionType: 1, status: 1 });
caseSchema.index({ uscisReceiptNumber: 1 });
caseSchema.index({ stage: 1, status: 1 });
caseSchema.index({ primaryOwner: 1, status: 1 });
caseSchema.index({ secondaryOwner: 1, status: 1 });
caseSchema.index({ assignedTeamLead: 1, status: 1 });
caseSchema.index({ assignedCaseManager: 1, status: 1 });
caseSchema.index({ assignedCaseManager: 1, rfeDeadline: 1 });
caseSchema.index({ assignedCaseManager: 1, updatedAt: -1 });
caseSchema.index({ companyId: 1, status: 1 });
caseSchema.index({ teamId: 1, status: 1 });
caseSchema.index({ lastSyncedAt: -1 });
caseSchema.index({ "canonicalProfile.status": 1, "canonicalProfile.lastBuiltAt": -1 });
caseSchema.index({ visaType: 1, status: 1 });
caseSchema.index({ visaCategory: 1, status: 1 });
caseSchema.index({ package: 1, status: 1 });
caseSchema.index({ "plan.paymentStatus": 1 });
caseSchema.index({ "questionnaireReferences.responseId": 1, "questionnaireReferences.active": 1, "questionnaireReferences.status": 1 });
caseSchema.index({ "questionnaireReferences.targetRole": 1, "questionnaireReferences.active": 1, "questionnaireReferences.status": 1 });
caseSchema.index({ "questionnaireReferences.participantId": 1, "questionnaireReferences.targetRole": 1, "questionnaireReferences.status": 1 });
// Fast path for the case search box (case.service.js's resolveCaseSearchFilter)
// — falls back to the unanchored regex scan below when $text finds nothing,
// so substring search still works, just usually via this index instead.
caseSchema.index({ clientName: "text", clientEmail: "text", caseId: "text", caseNumber: "text", uscisReceiptNumber: "text", petitionType: "text" });

// PHASE 2 ADDITIONS
caseSchema.index({ caseStructure: 1, status: 1 });
caseSchema.index({ caseRole: 1, status: 1 });
caseSchema.index({ employerProfileId: 1 });
caseSchema.index({ personProfileId: 1 });
caseSchema.index({ creationSource: 1, createdAt: -1 });
caseSchema.index({ dataEntryMode: 1, status: 1 });

caseSchema.statics.stageNames = STAGE_NAMES;
caseSchema.statics.crmStages = CRM_STAGES;
caseSchema.statics.lifecycleStages = CASE_LIFECYCLE_STAGES;
caseSchema.statics.statuses = CASE_STATUSES;
caseSchema.statics.priorities = PRIORITIES;

module.exports = mongoose.model("Case", caseSchema);
