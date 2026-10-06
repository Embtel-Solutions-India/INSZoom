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
  // Checklist-mapping conditions (below) reuse this same whitelist/
  // evaluator - both resolved in visaFormMapping.service.js's
  // readWhitelistedField from the EXACT existing sources already used
  // elsewhere, never re-derived: "newOfficePetition" mirrors
  // immigration-knowledge-engine.service.js's own
  // caseData.assessmentAnswers?.newOfficePetition /
  // questionnaireData.masterData.newOfficePetition resolution (the L-1A
  // business-plan-checklist gate); "hasJointSponsor" mirrors
  // Boolean(caseData.jointSponsorUser).
  "newOfficePetition",
  "hasJointSponsor",
  // PERM stage gates (config/permStages.js) - derived from Case.permWorkflow.
  "permCertified",
  "permAdjustmentStage",
  "permEmploymentAuthorization",
  "permAdvanceParole",
];

const CHECKLIST_ASSIGNMENT_TYPES = ["AUTO", "CONDITIONAL", "EXPLICIT_CM"];

const checklistMappingSchema = new mongoose.Schema(
  {
    // A Questionnaire.key from the existing checklist/questionnaire system
    // (employmentChecklists.js, familyChecklists.js, the standalone
    // *Checklist.js files, ...) - this never defines or duplicates a
    // checklist, it only references one that already exists there.
    checklistKey: { type: String, required: true, trim: true },
    assignmentType: { type: String, enum: CHECKLIST_ASSIGNMENT_TYPES, required: true },
    // Which side of a two-party filing this checklist is for (e.g.
    // "employer"/"employee", "petitioner"/"beneficiary") - purely
    // descriptive/UI, never used to decide applicability.
    // Descriptive only (never used to decide applicability - see the
    // comment above), but validated against the SAME CHECKLIST_ROLES
    // vocabulary Questionnaire.checklistRole is schema-enforced against
    // (lazy require - avoids a model-to-model top-level require cycle),
    // so this field can't silently drift into a different vocabulary
    // (e.g. "company" here vs "employer" on the real Questionnaire) even
    // though nothing here cross-references a specific Questionnaire
    // document. A resolver that needs the AUTHORITATIVE role should still
    // read it off the real Questionnaire.checklistRole, not this copy.
    role: {
      type: String,
      trim: true,
      default: "",
      validate: {
        validator: (value) => !value || require("./Questionnaire").CHECKLIST_ROLES.includes(value),
        message: (props) => `role "${props.value}" is not in Questionnaire.CHECKLIST_ROLES`,
      },
    },
    // Only meaningful when assignmentType is CONDITIONAL - the EXACT same
    // trigger DSL triggerCondition already uses ({field, operator, value} |
    // {all:[...]} | {any:[...]}, validated the same way, against the SAME
    // TRIGGER_FIELD_WHITELIST above) - reused wholesale, never a second
    // condition language. "Was a joint sponsor actually added" is expressed
    // as {field:"hasJointSponsor", operator:"equals", value:true} - no
    // special-cased condition shape needed for it.
    condition: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      validate: {
        validator: (value) => validateTriggerNode(value) === null,
        message: (props) => validateTriggerNode(props.value) || "checklistMappings.condition is invalid",
      },
    },
    notes: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

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

    // A stable identity, like formTemplateFormCode above, but pointing at a
    // USCISFormComponentDefinition rather than a whole USCISFormTemplate -
    // only meaningful for a SUPPLEMENT/FORM_COMPONENT row whose "form" is
    // really a page-range section of its parent's own PDF (e.g. I-129's
    // classification supplements), never for one with its own separate
    // template (that case uses formTemplateFormCode exactly like a
    // STANDALONE_FORM does - see I-539A, which already works this way).
    // Resolved live against the parent's CURRENT active template version at
    // read time (never cached here), the same "hint only, existence checked
    // live" contract formTemplateFormCode documents above - an edition
    // change re-discovers fresh USCISFormComponentDefinition documents
    // under the same componentCode without this field needing to change.
    componentCode: { type: String, trim: true, default: null },

    displayOrder: { type: Number, default: 0 },

    active: { type: Boolean, default: true, index: true },

    sourceVerified: { type: Boolean, default: false },
    verificationSource: { type: String, trim: true, default: "" },
    verificationDate: { type: Date, default: null },
    notes: { type: String, default: "" },

    // Which client checklist(s)/questionnaire(s) go with THIS form, for
    // THIS visa type - extends this existing registry rather than a
    // second, parallel checklist-mapping system (see
    // checklistMappings.seed.js for the actual data and
    // resolveChecklistsForCase for how it's consumed). Empty array is a
    // valid, deliberate state (GAP - this form/visa combination has no
    // authored checklist yet) - never silently defaulted to another
    // visa's checklist.
    checklistMappings: { type: [checklistMappingSchema], default: [] },
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
visaFormMappingSchema.statics.CHECKLIST_ASSIGNMENT_TYPES = CHECKLIST_ASSIGNMENT_TYPES;

module.exports = mongoose.models.VisaFormMapping || mongoose.model("VisaFormMapping", visaFormMappingSchema);
