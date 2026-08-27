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
      enum: ["questionnaire", "ocr", "case_manager_edit", "import"],
      default: "questionnaire",
    },
    updatedAt: { type: Date, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    revision: { type: Number, default: 0 },
    locked: { type: Boolean, default: false },
    conflictPending: {
      conflictValue: { type: mongoose.Schema.Types.Mixed, default: null },
      conflictSource: { type: String, default: null },
      conflictAt: { type: Date, default: null },
    },
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
      countryOfCitizenship: { type: canonicalFieldSchema, default: () => ({}) },
      nationality: { type: canonicalFieldSchema, default: () => ({}) },

      // Contact
      email: { type: canonicalFieldSchema, default: () => ({}) },
      phone: { type: canonicalFieldSchema, default: () => ({}) },

      // Address
      currentAddress: {
        street: { type: canonicalFieldSchema, default: () => ({}) },
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
      i94Number: { type: canonicalFieldSchema, default: () => ({}) },
      i94ExpirationDate: { type: canonicalFieldSchema, default: () => ({}) },
      alienRegistrationNumber: { type: canonicalFieldSchema, default: () => ({}) },
      sevisId: { type: canonicalFieldSchema, default: () => ({}) },

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
