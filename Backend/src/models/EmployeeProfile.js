const mongoose = require("mongoose");

/**
 * Reuse the same canonicalFieldSchema pattern as EmployerProfile.
 * Each individual data point carries full provenance.
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
    locked: { type: Boolean, default: false },
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

const employeeProfileSchema = new mongoose.Schema(
  {
    /**
     * The specific child Case this profile belongs to.
     * One EmployeeProfile per child Case — never shared between children.
     */
    // Uniquely indexed below (employeeProfileSchema.index) rather than here —
    // see EmployerProfile.js's identical note on principalCaseId.
    caseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Case",
      required: true,
    },

    /**
     * The principal Case that this child Case belongs to.
     * Used for efficient queries across all employees in a matter.
     */
    principalCaseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Case",
      required: true,
      index: true,
    },

    /**
     * Discriminator: 'employee' or 'beneficiary'.
     * Same schema, different semantic meaning.
     */
    profileType: {
      type: String,
      enum: ["employee", "beneficiary"],
      required: true,
      index: true,
    },

    /**
     * Canonical personal data for this individual.
     * Employee A and Employee B each have their own entirely separate document.
     * The agent must NEVER write Employee A's data into Employee B's profile.
     */
    canonicalData: {
      // Identity
      firstName: { type: canonicalFieldSchema, default: () => ({}) },
      middleName: { type: canonicalFieldSchema, default: () => ({}) },
      lastName: { type: canonicalFieldSchema, default: () => ({}) },
      dateOfBirth: { type: canonicalFieldSchema, default: () => ({}) },
      gender: { type: canonicalFieldSchema, default: () => ({}) },
      countryOfBirth: { type: canonicalFieldSchema, default: () => ({}) },
      stateProvinceOfBirth: { type: canonicalFieldSchema, default: () => ({}) },
      countryOfCitizenship: { type: canonicalFieldSchema, default: () => ({}) },
      nationality: { type: canonicalFieldSchema, default: () => ({}) },
      otherNamesUsed: { type: canonicalFieldSchema, default: () => ({}) },
      socialSecurityNumber: { type: canonicalFieldSchema, default: () => ({}) },
      priorPetitionNumber: { type: canonicalFieldSchema, default: () => ({}) },

      // Contact
      email: { type: canonicalFieldSchema, default: () => ({}) },
      phone: { type: canonicalFieldSchema, default: () => ({}) },

      // Address
      currentAddress: {
        street: { type: canonicalFieldSchema, default: () => ({}) },
        street2: { type: canonicalFieldSchema, default: () => ({}) },
        city: { type: canonicalFieldSchema, default: () => ({}) },
        state: { type: canonicalFieldSchema, default: () => ({}) },
        zipCode: { type: canonicalFieldSchema, default: () => ({}) },
        country: { type: canonicalFieldSchema, default: () => ({}) },
      },

      // Passport
      passport: {
        number: { type: canonicalFieldSchema, default: () => ({}) },
        country: { type: canonicalFieldSchema, default: () => ({}) },
        issueDate: { type: canonicalFieldSchema, default: () => ({}) },
        expirationDate: { type: canonicalFieldSchema, default: () => ({}) },
        placeOfIssue: { type: canonicalFieldSchema, default: () => ({}) },
      },

      // Current immigration status
      currentVisaStatus: { type: canonicalFieldSchema, default: () => ({}) },
      currentVisaExpiry: { type: canonicalFieldSchema, default: () => ({}) },
      lastArrivalDate: { type: canonicalFieldSchema, default: () => ({}) },
      i94Number: { type: canonicalFieldSchema, default: () => ({}) },
      i94ExpirationDate: { type: canonicalFieldSchema, default: () => ({}) },
      alienRegistrationNumber: { type: canonicalFieldSchema, default: () => ({}) },
      sevisId: { type: canonicalFieldSchema, default: () => ({}) },

      // H-1B filing-specific data
      h1bClassification: { type: canonicalFieldSchema, default: () => ({}) },
      capSelectionNoticeReference: { type: canonicalFieldSchema, default: () => ({}) },
      hasValidPassport: { type: canonicalFieldSchema, default: () => ({}) },
      consulateLocation: { type: canonicalFieldSchema, default: () => ({}) },
      foreignAddress: {
        street: { type: canonicalFieldSchema, default: () => ({}) },
        street2: { type: canonicalFieldSchema, default: () => ({}) },
        city: { type: canonicalFieldSchema, default: () => ({}) },
        state: { type: canonicalFieldSchema, default: () => ({}) },
        zipCode: { type: canonicalFieldSchema, default: () => ({}) },
        country: { type: canonicalFieldSchema, default: () => ({}) },
      },
      highestEducationLevel: { type: canonicalFieldSchema, default: () => ({}) },
      primaryFieldOfStudy: { type: canonicalFieldSchema, default: () => ({}) },
      usAdvancedDegree: {
        hasDegree: { type: canonicalFieldSchema, default: () => ({}) },
        institutionName: { type: canonicalFieldSchema, default: () => ({}) },
        degreeAwardedDate: { type: canonicalFieldSchema, default: () => ({}) },
        degreeType: { type: canonicalFieldSchema, default: () => ({}) },
        institutionAddress: { type: canonicalFieldSchema, default: () => ({}) },
      },
      replaceI94: { type: canonicalFieldSchema, default: () => ({}) },
      hasDependents: { type: canonicalFieldSchema, default: () => ({}) },
      dependentCount: { type: canonicalFieldSchema, default: () => ({}) },
      inRemovalProceedings: { type: canonicalFieldSchema, default: () => ({}) },
      priorImmigrantPetitionByCompany: { type: canonicalFieldSchema, default: () => ({}) },
      priorH1BInLastSevenYears: { type: canonicalFieldSchema, default: () => ({}) },
      h1bDeniedInLastSevenYears: { type: canonicalFieldSchema, default: () => ({}) },
      h1bDenialExplanation: { type: canonicalFieldSchema, default: () => ({}) },
      priorHLStayHistory: { type: canonicalFieldSchema, default: () => ({}) },

      // Employment (for employee profiles)
      positionTitle: { type: canonicalFieldSchema, default: () => ({}) },
      positionSocCode: { type: canonicalFieldSchema, default: () => ({}) },
      salary: { type: canonicalFieldSchema, default: () => ({}) },
      salaryUnit: { type: canonicalFieldSchema, default: () => ({}) },
      startDate: { type: canonicalFieldSchema, default: () => ({}) },
      endDate: { type: canonicalFieldSchema, default: () => ({}) },
      fullTime: { type: canonicalFieldSchema, default: () => ({}) },

      // Education history (array — each item is a plain object, no provenance per-item)
      educationHistory: {
        type: canonicalFieldSchema,
        default: () => ({ value: [] }),
      },

      // Employment history
      employmentHistory: {
        type: canonicalFieldSchema,
        default: () => ({ value: [] }),
      },

      // Immigration history
      immigrationHistory: {
        type: canonicalFieldSchema,
        default: () => ({ value: [] }),
      },

      // Travel history
      travelHistory: {
        type: canonicalFieldSchema,
        default: () => ({ value: [] }),
      },

      // Family (for beneficiary profiles)
      maritalStatus: { type: canonicalFieldSchema, default: () => ({}) },
      spouseInfo: {
        type: canonicalFieldSchema,
        default: () => ({ value: null }),
      },

      // Background
      criminalRecord: { type: canonicalFieldSchema, default: () => ({}) },
      visaDenial: { type: canonicalFieldSchema, default: () => ({}) },
      deportation: { type: canonicalFieldSchema, default: () => ({}) },

      documentReferences: {
        academicCertificates: { type: canonicalFieldSchema, default: () => ({}) },
        credentialEvaluation: { type: canonicalFieldSchema, default: () => ({}) },
        trainingCertificates: { type: canonicalFieldSchema, default: () => ({}) },
        resume: { type: canonicalFieldSchema, default: () => ({}) },
        experienceLetters: { type: canonicalFieldSchema, default: () => ({}) },
        priorI797: { type: canonicalFieldSchema, default: () => ({}) },
        i20F1Notices: { type: canonicalFieldSchema, default: () => ({}) },
        i94: { type: canonicalFieldSchema, default: () => ({}) },
        passport: { type: canonicalFieldSchema, default: () => ({}) },
        ssn: { type: canonicalFieldSchema, default: () => ({}) },
        driverLicense: { type: canonicalFieldSchema, default: () => ({}) },
        recentPayslips: { type: canonicalFieldSchema, default: () => ({}) },
        dependentDocuments: { type: canonicalFieldSchema, default: () => ({}) },
      },
    },

    updatedAt: { type: Date, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    collection: "employeeprofiles",
  }
);

// One profile per child case — enforced uniquely
employeeProfileSchema.index({ caseId: 1 }, { unique: true });
employeeProfileSchema.index({ principalCaseId: 1, profileType: 1 });

module.exports = mongoose.model("EmployeeProfile", employeeProfileSchema);
