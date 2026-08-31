const mongoose = require("mongoose");

/**
 * Provenance schema for individual canonical fields.
 * Every field in canonicalData uses this schema to track
 * where the value came from and whether it has been locked.
 */
const canonicalFieldSchema = new mongoose.Schema(
  {
    value: { type: mongoose.Schema.Types.Mixed, default: null },
    source: {
      type: String,
      enum: ["questionnaire", "ocr", "case_manager_edit", "import", "form_edit"],
      default: "questionnaire",
    },
    sourceId: { type: mongoose.Schema.Types.Mixed, default: null },
    sourceField: { type: String, default: null },
    updatedAt: { type: Date, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    revision: { type: Number, default: 0 },
    profileOwner: { type: String, enum: ["employer", "employee", "beneficiary", "case", null], default: null },
    caseScope: { type: mongoose.Schema.Types.Mixed, default: null },
    lastChangeId: { type: String, default: null },
    /**
     * When true: questionnaire submissions and OCR extractions cannot
     * overwrite this value. Only an explicit case manager edit can change it.
     */
    locked: { type: Boolean, default: false },
    /**
     * Set when a questionnaire re-submit conflicts with a case manager edit.
     * The case manager must resolve the conflict before the field is updated.
     */
    conflictPending: {
      conflictValue: { type: mongoose.Schema.Types.Mixed, default: null },
      conflictSource: { type: String, default: null },
      conflictSourceId: { type: mongoose.Schema.Types.Mixed, default: null },
      conflictSourceField: { type: String, default: null },
      conflictRevision: { type: Number, default: null },
      conflictAt: { type: Date, default: null },
      conflictBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      conflictReason: { type: String, default: null },
    },
    history: [
      {
        value: { type: mongoose.Schema.Types.Mixed, default: null },
        source: String,
        sourceId: { type: mongoose.Schema.Types.Mixed, default: null },
        sourceField: String,
        updatedAt: Date,
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        revision: Number,
        action: String,
        reason: String,
        changeId: String,
      },
    ],
  },
  { _id: false }
);

const employerProfileSchema = new mongoose.Schema(
  {
    /**
     * The principal Case that owns this employer profile.
     * All child cases in this matter reference this document via
     * Case.employerProfileId.
     */
    // Uniquely indexed below (employerProfileSchema.index) rather than here —
    // a plain `index: true` here alongside that call would register the same
    // field twice (Mongoose warns on this as a duplicate schema index).
    principalCaseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Case",
      required: true,
    },

    /**
     * Canonical employer/petitioner data.
     * Each field uses the canonicalFieldSchema for full provenance tracking.
     *
     * IMPORTANT: These are the USCIS-relevant employer fields. New fields
     * may be added here as visa types require them. Fields must never be
     * deleted — use the 'locked' flag to prevent overwrites instead.
     */
    canonicalData: {
      // Legal identity
      legalName: { type: canonicalFieldSchema, default: () => ({}) },
      dbaName: { type: canonicalFieldSchema, default: () => ({}) },
      ein: { type: canonicalFieldSchema, default: () => ({}) },
      registrationNumber: { type: canonicalFieldSchema, default: () => ({}) },

      // Address
      address: {
        street: { type: canonicalFieldSchema, default: () => ({}) },
        street2: { type: canonicalFieldSchema, default: () => ({}) },
        city: { type: canonicalFieldSchema, default: () => ({}) },
        county: { type: canonicalFieldSchema, default: () => ({}) },
        state: { type: canonicalFieldSchema, default: () => ({}) },
        zipCode: { type: canonicalFieldSchema, default: () => ({}) },
        country: { type: canonicalFieldSchema, default: () => ({}) },
      },

      // NAICS / business classification
      naicsCode: { type: canonicalFieldSchema, default: () => ({}) },
      businessType: { type: canonicalFieldSchema, default: () => ({}) },
      businessWebsite: { type: canonicalFieldSchema, default: () => ({}) },
      businessDescription: { type: canonicalFieldSchema, default: () => ({}) },

      // Financial
      yearEstablished: { type: canonicalFieldSchema, default: () => ({}) },
      grossAnnualIncome: { type: canonicalFieldSchema, default: () => ({}) },
      netAnnualIncome: { type: canonicalFieldSchema, default: () => ({}) },
      numberOfEmployees: { type: canonicalFieldSchema, default: () => ({}) },
      numberOfH1BWorkers: { type: canonicalFieldSchema, default: () => ({}) },
      numberOfH1BL1Workers: { type: canonicalFieldSchema, default: () => ({}) },

      // Contact
      contact: {
        name: { type: canonicalFieldSchema, default: () => ({}) },
        title: { type: canonicalFieldSchema, default: () => ({}) },
        phone: { type: canonicalFieldSchema, default: () => ({}) },
        fax: { type: canonicalFieldSchema, default: () => ({}) },
        email: { type: canonicalFieldSchema, default: () => ({}) },
      },

      // Authorized representative
      authorizedRepresentative: {
        firstName: { type: canonicalFieldSchema, default: () => ({}) },
        lastName: { type: canonicalFieldSchema, default: () => ({}) },
        name: { type: canonicalFieldSchema, default: () => ({}) },
        title: { type: canonicalFieldSchema, default: () => ({}) },
        phone: { type: canonicalFieldSchema, default: () => ({}) },
        email: { type: canonicalFieldSchema, default: () => ({}) },
      },

      // H-1B / LCA specific
      isFirstLca: { type: canonicalFieldSchema, default: () => ({}) },
      dolVerificationCompleted: { type: canonicalFieldSchema, default: () => ({}) },
      lcaNumber: { type: canonicalFieldSchema, default: () => ({}) },
      lcaWageLevel: { type: canonicalFieldSchema, default: () => ({}) },
      prevailingWage: { type: canonicalFieldSchema, default: () => ({}) },
      actualWage: { type: canonicalFieldSchema, default: () => ({}) },
      offeredPosition: {
        jobTitle: { type: canonicalFieldSchema, default: () => ({}) },
        salary: { type: canonicalFieldSchema, default: () => ({}) },
        startDate: { type: canonicalFieldSchema, default: () => ({}) },
        endClientName: { type: canonicalFieldSchema, default: () => ({}) },
        jobDescription: { type: canonicalFieldSchema, default: () => ({}) },
      },
      workSiteAddress: {
        companyName: { type: canonicalFieldSchema, default: () => ({}) },
        street: { type: canonicalFieldSchema, default: () => ({}) },
        city: { type: canonicalFieldSchema, default: () => ({}) },
        state: { type: canonicalFieldSchema, default: () => ({}) },
        zipCode: { type: canonicalFieldSchema, default: () => ({}) },
        county: { type: canonicalFieldSchema, default: () => ({}) },
      },
      additionalWorkSites: { type: canonicalFieldSchema, default: () => ({}) },

      // Supporting documents references (not the files themselves)
      feinProofDocumentReference: { type: canonicalFieldSchema, default: () => ({}) },
      irsDocumentReference: { type: canonicalFieldSchema, default: () => ({}) },
      stateIncorporationReference: { type: canonicalFieldSchema, default: () => ({}) },
      businessLicenseReference: { type: canonicalFieldSchema, default: () => ({}) },
      companyLetterheadReference: { type: canonicalFieldSchema, default: () => ({}) },
    },

    /** Document-level audit trail */
    updatedAt: { type: Date, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    collection: "employerprofiles",
  }
);

employerProfileSchema.index({ principalCaseId: 1 }, { unique: true });

module.exports = mongoose.model("EmployerProfile", employerProfileSchema);
