// Authoritative business registry: which government forms/artifacts apply
// to which visa/case type, and how they should be provisioned. This is the
// SOLE authority on applicability - USCISFormTemplate.assignmentRules and
// template import status are separate, orthogonal, purely technical/
// rendering concerns evaluated on top of (never instead of) this registry.
// See Backend/docs (VisaFormMapping plan) for the full design rationale.
const mongoose = require("mongoose");

const IMMIGRATION_NATURE = [
  "TEMPORARY_NONIMMIGRANT",
  "PERMANENT_IMMIGRANT",
  "CONDITIONAL_PERMANENT_RESIDENT",
  "CITIZENSHIP",
  "TRAVEL_DOCUMENT",
  "EMPLOYMENT_AUTHORIZATION",
  "STATUS_CHANGE_EXTENSION",
  "CONSULAR_PROCESSING",
  "POST_APPROVAL",
  "HUMANITARIAN",
  "STUDENT_EXCHANGE",
  "PERMANENT_RESIDENT_DOCUMENT",
  "OTHER",
];

const AGENCIES = ["USCIS", "DOL", "DOS", "SEVP", "SCHOOL_OR_PROGRAM_SPONSOR", "OTHER"];

const PROVISIONING_TYPES = ["AUTO_CREATE", "CONDITIONAL", "LATER_STAGE", "REFERENCE", "NOT_APPLICABLE"];

const COMPONENT_TYPES = ["STANDALONE_FORM", "FORM_COMPONENT", "SUPPLEMENT", "ONLINE_APPLICATION", "GOVERNMENT_DOCUMENT", "REFERENCE_DOCUMENT"];

const PROCESSING_PATHS = ["CONSULAR", "ADJUSTMENT_OF_STATUS", "CHANGE_OF_STATUS", "EXTENSION_OF_STATUS", "PETITION_ONLY", "EMPLOYMENT_AUTHORIZATION", "TRAVEL_DOCUMENT", "POST_APPROVAL", "NVC", "OTHER"];

// Whitelist of Case fields a triggerCondition may reference. Deliberately
// narrow and grounded only in fields confirmed to exist on Case.js (or
// added by this same change) - never arbitrary dot-paths. Enforced both
// here (schema validation) and by the registry validator.
const TRIGGER_FIELD_WHITELIST = [
  "visaType",
  "visaCategory",
  "caseType",
  "petitionType",
  "petitionSubType",
  "premiumProcessing",
  "processingPath",
  // Reuses the exact same source uscis-form.service.js's existing
  // hasAttorneyOnRecord() already checks (caseData.assignedAttorney ||
  // caseData.attorney) - not a new/invented field.
  "attorneyOnRecord",
];

function validateTriggerNode(node, path = "triggerCondition") {
  if (node === null || node === undefined) return null;
  if (typeof node !== "object") return `${path} must be an object`;
  if (Array.isArray(node.all)) {
    if (!node.all.length) return `${path}.all must be a non-empty array`;
    for (let i = 0; i < node.all.length; i++) {
      const err = validateTriggerNode(node.all[i], `${path}.all[${i}]`);
      if (err) return err;
    }
    return null;
  }
  if (Array.isArray(node.any)) {
    if (!node.any.length) return `${path}.any must be a non-empty array`;
    for (let i = 0; i < node.any.length; i++) {
      const err = validateTriggerNode(node.any[i], `${path}.any[${i}]`);
      if (err) return err;
    }
    return null;
  }
  if (!node.field || !TRIGGER_FIELD_WHITELIST.includes(node.field)) {
    return `${path}.field "${node.field}" is not in the approved trigger field whitelist`;
  }
  const validOperators = ["equals", "notEquals", "in", "notIn", "exists"];
  if (!validOperators.includes(node.operator)) {
    return `${path}.operator "${node.operator}" must be one of ${validOperators.join(", ")}`;
  }
  return null;
}

const visaFormMappingSchema = new mongoose.Schema(
  {
    visaType: { type: String, required: true, trim: true, index: true },
    visaCategory: { type: String, trim: true },
    caseType: { type: String, trim: true },
    immigrationNature: { type: String, enum: IMMIGRATION_NATURE, required: true },

    formNumber: { type: String, required: true, trim: true },
    formName: { type: String, required: true, trim: true },
    agency: { type: String, enum: AGENCIES, required: true },

    provisioningType: { type: String, enum: PROVISIONING_TYPES, required: true, index: true },

    // Empty array = applies to every processing path (wildcard). A
    // dedicated first-class dimension, deliberately NOT folded into
    // triggerCondition.
    processingPaths: { type: [{ type: String, enum: PROCESSING_PATHS }], default: [] },

    // Generic trigger DSL: { field, operator, value } | { all: [...] } | { any: [...] }.
    // Validated against TRIGGER_FIELD_WHITELIST at save time (path-level
    // validator, not a pre("validate") hook - Mongoose's validateSync()
    // does not run document middleware, only real validators, so a hook
    // here would silently never fire for any synchronous validation call).
    triggerCondition: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      validate: {
        validator: (value) => validateTriggerNode(value) === null,
        message: (props) => validateTriggerNode(props.value) || "triggerCondition is invalid",
      },
    },

    initialCaseCreation: { type: Boolean, default: false },
    stage: { type: String, trim: true, default: "" },

    parentForm: { type: String, trim: true, default: null },
    componentType: { type: String, enum: COMPONENT_TYPES, required: true },

    // Hint only - which USCISFormTemplate.formCode to look for. Template
    // EXISTENCE/applicability is always checked live at resolution time,
    // never cached as a boolean here.
    formTemplateFormCode: { type: String, trim: true, lowercase: true, default: null },

    displayOrder: { type: Number, default: 0 },

    active: { type: Boolean, default: true, index: true },

    sourceVerified: { type: Boolean, default: false },
    verificationSource: { type: String, trim: true, default: "" },
    verificationDate: { type: Date, default: null },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

visaFormMappingSchema.index({ visaType: 1, formNumber: 1, componentType: 1 }, { unique: true });

visaFormMappingSchema.statics.IMMIGRATION_NATURE = IMMIGRATION_NATURE;
visaFormMappingSchema.statics.AGENCIES = AGENCIES;
visaFormMappingSchema.statics.PROVISIONING_TYPES = PROVISIONING_TYPES;
visaFormMappingSchema.statics.COMPONENT_TYPES = COMPONENT_TYPES;
visaFormMappingSchema.statics.PROCESSING_PATHS = PROCESSING_PATHS;
visaFormMappingSchema.statics.TRIGGER_FIELD_WHITELIST = TRIGGER_FIELD_WHITELIST;
visaFormMappingSchema.statics.validateTriggerNode = validateTriggerNode;

module.exports = mongoose.models.VisaFormMapping || mongoose.model("VisaFormMapping", visaFormMappingSchema);
