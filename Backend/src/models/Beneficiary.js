const mongoose = require("mongoose");

const addressSchema = new mongoose.Schema(
  {
    label: String,
    address: String,
    addressLine1: String,
    addressLine2: String,
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

const employmentSchema = new mongoose.Schema(
  {
    employer: String,
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
    jobTitle: String,
    occupation: String,
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

const familyMemberSchema = new mongoose.Schema(
  {
    name: String,
    relationship: String,
    dob: String,
    dateOfBirth: String,
    country: String,
    nationality: String,
    immigrationStatus: String,
    email: String,
    phone: String,
    isDependent: { type: Boolean, default: false },
  },
  { _id: true }
);

const travelSchema = new mongoose.Schema(
  {
    country: String,
    purpose: String,
    arrivalDate: String,
    departureDate: String,
    visaType: String,
    notes: String,
  },
  { _id: true }
);

const immigrationHistorySchema = new mongoose.Schema(
  {
    visaType: String,
    status: String,
    country: String,
    receiptNumber: String,
    startDate: String,
    endDate: String,
    outcome: String,
    notes: String,
  },
  { _id: true }
);

const contactSchema = new mongoose.Schema(
  {
    name: String,
    relationship: String,
    phone: String,
    email: String,
    address: String,
    isPrimary: { type: Boolean, default: false },
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

const beneficiarySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true, sparse: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", index: true, sparse: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", index: true },
    caseIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Case", index: true }],

    beneficiaryNumber: { type: String, unique: true, sparse: true, index: true },
    clientPortalId: { type: String, sparse: true, index: true },
    type: { type: String, enum: ["principal", "dependent", "employee", "family", "other"], default: "principal", index: true },
    status: { type: String, enum: ["lead", "active", "inactive", "on_hold", "archived"], default: "active", index: true },

    firstName: { type: String, trim: true },
    middleName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    fullName: { type: String, trim: true, index: true },
    email: { type: String, lowercase: true, trim: true, index: true },
    primaryPhone: String,
    whatsappNumber: String,
    preferredContact: { type: String, enum: ["email", "phone", "whatsapp", "sms", "portal", ""] },

    dateOfBirth: String,
    gender: { type: String, enum: ["male", "female", "non-binary", "prefer-not", ""] },
    maritalStatus: { type: String, enum: ["single", "married", "divorced", "widowed", "separated", ""] },
    nativeLanguage: String,
    countryOfBirth: String,
    countryOfCitizenship: String,
    nationality: String,

    address: String,
    apartment: String,
    city: String,
    state: String,
    zipCode: String,
    country: String,
    addressHistory: [addressSchema],
    emergencyContacts: [contactSchema],

    familyMembers: [familyMemberSchema],
    dependents: [familyMemberSchema],
    numberOfDependents: { type: Number, default: 0 },

    passport: {
      number: String,
      country: String,
      issueDate: String,
      expirationDate: { type: String, index: true },
      placeOfIssue: String,
      metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    passportNumber: String,
    passportCountry: String,
    passportIssueDate: String,
    passportExpirationDate: { type: String, index: true },

    visa: {
      category: { type: String, default: "", index: true },
      type: { type: String, default: "", index: true },
      status: String,
      expirationDate: { type: String, index: true },
      issueDate: String,
      sponsor: String,
      metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    visaCategory: { type: String, default: "", index: true },
    visaType: { type: String, default: "", index: true },
    currentVisaStatus: String,
    visaExpirationDate: { type: String, index: true },
    immigrationStatus: String,

    sevisId: { type: String, trim: true, index: true },
    i94Number: { type: String, trim: true, index: true },
    i94ExpirationDate: String,
    alienRegistrationNumber: { type: String, trim: true, index: true },
    ssnLast4: String,
    ssnEncrypted: String,

    immigrationInfo: { type: mongoose.Schema.Types.Mixed, default: {} },
    immigrationHistory: [immigrationHistorySchema],
    travelHistory: [travelSchema],
    employmentHistory: [employmentSchema],
    educationHistory: [educationSchema],

    criminalRecord: { type: String, enum: ["yes", "no", ""] },
    criminalDetails: String,
    visaDenial: { type: String, enum: ["yes", "no", ""] },
    visaDenialDetails: String,
    deportation: { type: String, enum: ["yes", "no", ""] },
    deportationDetails: String,
    priorApplications: { type: String, enum: ["yes", "no", ""] },
    priorApplicationsDetails: String,

    assignedCaseManager: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: "Team", index: true },

    profileCompletion: { type: Number, default: 0 },
    source: { type: String, enum: ["BAIS", "INSZoom", "shared", "import", ""], default: "shared" },
    notes: [noteSchema],
    timeline: [timelineSchema],
    activityHistory: [timelineSchema],
    auditHistory: [auditSchema],
  },
  { timestamps: true }
);

beneficiarySchema.pre("validate", function syncCompatibilityFields(next) {
  if (!this.fullName) this.fullName = [this.firstName, this.middleName, this.lastName].filter(Boolean).join(" ").trim();
  if (!this.fullName && this.email) this.fullName = this.email.split("@")[0];
  if (!this.passportNumber && this.passport?.number) this.passportNumber = this.passport.number;
  if (!this.passport?.number && this.passportNumber) this.passport = { ...(this.passport || {}), number: this.passportNumber };
  if (!this.passportCountry && this.passport?.country) this.passportCountry = this.passport.country;
  if (!this.passport?.country && this.passportCountry) this.passport = { ...(this.passport || {}), country: this.passportCountry };
  if (!this.passportIssueDate && this.passport?.issueDate) this.passportIssueDate = this.passport.issueDate;
  if (!this.passport?.issueDate && this.passportIssueDate) this.passport = { ...(this.passport || {}), issueDate: this.passportIssueDate };
  if (!this.passportExpirationDate && this.passport?.expirationDate) this.passportExpirationDate = this.passport.expirationDate;
  if (!this.passport?.expirationDate && this.passportExpirationDate) this.passport = { ...(this.passport || {}), expirationDate: this.passportExpirationDate };
  if (!this.visaCategory && this.visa?.category) this.visaCategory = this.visa.category;
  if (!this.visa?.category && this.visaCategory) this.visa = { ...(this.visa || {}), category: this.visaCategory };
  if (!this.visaType && this.visa?.type) this.visaType = this.visa.type;
  if (!this.visa?.type && this.visaType) this.visa = { ...(this.visa || {}), type: this.visaType };
  if (!this.currentVisaStatus && this.visa?.status) this.currentVisaStatus = this.visa.status;
  if (!this.visa?.status && this.currentVisaStatus) this.visa = { ...(this.visa || {}), status: this.currentVisaStatus };
  if (!this.visaExpirationDate && this.visa?.expirationDate) this.visaExpirationDate = this.visa.expirationDate;
  if (!this.visa?.expirationDate && this.visaExpirationDate) this.visa = { ...(this.visa || {}), expirationDate: this.visaExpirationDate };
  next();
});

beneficiarySchema.index({ fullName: "text", email: "text", visaType: "text", beneficiaryNumber: "text", clientPortalId: "text" });
beneficiarySchema.index({ user: 1, status: 1 });
beneficiarySchema.index({ client: 1, status: 1 });
beneficiarySchema.index({ companyId: 1, status: 1 });
beneficiarySchema.index({ assignedCaseManager: 1, status: 1 });
beneficiarySchema.index({ visaExpirationDate: 1, status: 1 });
beneficiarySchema.index({ passportExpirationDate: 1, status: 1 });

module.exports = mongoose.model("Beneficiary", beneficiarySchema);
