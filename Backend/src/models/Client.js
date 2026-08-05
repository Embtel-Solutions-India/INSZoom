const mongoose = require("mongoose");

const childSchema = new mongoose.Schema(
  {
    name: String,
    dob: String,
    dateOfBirth: String,
    country: String,
    nationality: String,
  },
  { _id: true }
);

const employmentSchema = new mongoose.Schema(
  {
    employer: String,
    jobTitle: String,
    startDate: String,
    endDate: String,
    current: { type: Boolean, default: false },
    address: String,
    supervisor: String,
    notes: String,
  },
  { _id: true }
);

const educationSchema = new mongoose.Schema(
  {
    institution: String,
    degree: String,
    fieldOfStudy: String,
    startDate: String,
    endDate: String,
    country: String,
    notes: String,
  },
  { _id: true }
);

const immigrationHistorySchema = new mongoose.Schema(
  {
    status: String,
    visaType: String,
    startDate: String,
    endDate: String,
    receiptNumber: String,
    notes: String,
  },
  { _id: true }
);

const travelHistorySchema = new mongoose.Schema(
  {
    country: String,
    purpose: String,
    arrivalDate: String,
    departureDate: String,
    statusAtEntry: String,
    notes: String,
  },
  { _id: true }
);

const addressSchema = new mongoose.Schema(
  {
    address: String,
    apartment: String,
    city: String,
    state: String,
    zipCode: String,
    country: String,
    fromDate: String,
    toDate: String,
    current: { type: Boolean, default: false },
  },
  { _id: true }
);

const timelineSchema = new mongoose.Schema(
  {
    type: { type: String, default: "activity", index: true },
    title: { type: String, required: true },
    description: String,
    metadata: mongoose.Schema.Types.Mixed,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const noteSchema = new mongoose.Schema(
  {
    note: { type: String, required: true },
    isInternal: { type: Boolean, default: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdAt: { type: Date, default: Date.now },
    updatedAt: Date,
  },
  { _id: true }
);

const auditSchema = new mongoose.Schema(
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

const clientSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", unique: true, sparse: true, index: true },
    beneficiary: { type: mongoose.Schema.Types.ObjectId, ref: "Beneficiary", unique: true, sparse: true, index: true },
    clientPortalId: { type: String, unique: true, sparse: true, index: true },
    status: { type: String, enum: ["lead", "active", "inactive", "on_hold", "archived"], default: "active", index: true },

    firstName: { type: String, trim: true },
    middleName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    fullName: { type: String, trim: true, index: true },
    email: { type: String, lowercase: true, trim: true, index: true },
    dateOfBirth: String,
    gender: { type: String, enum: ["male", "female", "non-binary", "prefer-not", ""] },
    maritalStatus: { type: String, enum: ["single", "married", "divorced", "widowed", "separated", ""] },
    nativeLanguage: String,
    countryOfBirth: String,
    countryOfCitizenship: String,
    nationality: String,

    primaryPhone: String,
    whatsappNumber: String,
    preferredContact: { type: String, enum: ["email", "phone", "whatsapp", "sms", "portal", ""] },
    address: String,
    apartment: String,
    city: String,
    state: String,
    zipCode: String,
    country: String,
    addressHistory: [addressSchema],

    emergencyName: String,
    emergencyRelation: String,
    emergencyPhone: String,
    emergencyEmail: String,

    spouseFullName: String,
    spouseDOB: String,
    spouseNationality: String,
    spouseVisaStatus: String,
    spouseEmail: String,
    spousePhone: String,
    numberOfDependents: { type: Number, default: 0 },
    children: [childSchema],
    dependents: [childSchema],

    passportNumber: String,
    passportCountry: String,
    passportIssueDate: String,
    passportExpirationDate: String,
    passportInfo: { type: mongoose.Schema.Types.Mixed, default: {} },
    passportDetails: { type: mongoose.Schema.Types.Mixed, default: {} },

    visaCategory: { type: String, default: "", index: true },
    visaType: { type: String, default: "", index: true },
    currentVisaStatus: String,
    visaExpirationDate: String,
    immigrationStatus: String,
    immigrationInfo: { type: mongoose.Schema.Types.Mixed, default: {} },
    immigrationHistory: [immigrationHistorySchema],
    travelHistory: [travelHistorySchema],

    employmentHistory: [employmentSchema],
    educationHistory: [educationSchema],
    familyInformation: { type: mongoose.Schema.Types.Mixed, default: {} },
    additionalInformation: { type: mongoose.Schema.Types.Mixed, default: {} },
    dynamicCaseInformation: { type: mongoose.Schema.Types.Mixed, default: {} },
    intakeData: { type: mongoose.Schema.Types.Mixed, default: {} },
    intakeProgress: {
      overall: { type: Number, min: 0, max: 100, default: 0 },
      sections: { type: mongoose.Schema.Types.Mixed, default: {} },
      missingSections: [String],
      missingRequiredFields: [String],
      lastCalculatedAt: Date,
    },
    intakeSubmission: {
      status: { type: String, enum: ["not_started", "draft", "submitted", "locked", "reopened"], default: "not_started", index: true },
      caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", index: true },
      submittedAt: Date,
      submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      lockedAt: Date,
      lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      lastDraftSavedAt: Date,
      lastAutoSavedAt: Date,
      version: { type: Number, default: 0 },
    },

    criminalRecord: { type: String, enum: ["yes", "no", ""] },
    criminalDetails: String,
    visaDenial: { type: String, enum: ["yes", "no", ""] },
    visaDenialDetails: String,
    deportation: { type: String, enum: ["yes", "no", ""] },
    deportationDetails: String,
    priorApplications: { type: String, enum: ["yes", "no", ""] },
    priorApplicationsDetails: String,
    declaration: { type: Boolean, default: false },

    assessmentCompleted: { type: Boolean, default: false },
    assessmentAnswers: { type: mongoose.Schema.Types.Mixed, default: null },
    assessmentRecommendedVisa: { type: String, default: "" },
    assessmentMatchPercentage: { type: Number, default: 0 },
    selectedPlan: { type: String, enum: ["premium", "standard", "self-file", "self_file", "guided_review", "full_service", ""], default: "" },
    planSelectedAt: Date,

    completed: { type: Boolean, default: false, index: true },
    lastStep: { type: Number, default: 1 },
    profileCompletion: { type: Number, default: 0 },

    assignedCaseManager: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    assignedSalesManager: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", index: true },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: "Team", index: true },

    syncStatus: { type: String, enum: ["local", "synced", "pending", "failed"], default: "local", index: true },
    lastSyncedAt: Date,
    source: { type: String, enum: ["BAIS", "INSZoom", "shared", "import", ""], default: "shared" },

    timeline: [timelineSchema],
    notes: [noteSchema],
    activityHistory: [timelineSchema],
    auditHistory: [auditSchema],
  },
  { timestamps: true }
);

clientSchema.pre("validate", function syncNames(next) {
  if (!this.fullName) this.fullName = [this.firstName, this.middleName, this.lastName].filter(Boolean).join(" ").trim();
  if (!this.fullName && this.email) this.fullName = this.email.split("@")[0];
  if (!this.email && this.user?.email) this.email = this.user.email;
  next();
});

clientSchema.index({ fullName: "text", email: "text", visaType: "text", clientPortalId: "text" });
clientSchema.index({ assignedCaseManager: 1, status: 1 });
clientSchema.index({ companyId: 1, status: 1 });
clientSchema.index({ teamId: 1, status: 1 });

module.exports = mongoose.model("Client", clientSchema);
