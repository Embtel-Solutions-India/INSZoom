const mongoose = require("mongoose");

const conditionalRuleSchema = new mongoose.Schema(
  {
    questionKey: String,
    operator: {
      type: String,
      enum: ["equals", "not_equals", "in", "not_in", "exists", "missing", "empty", "not_empty", "gt", "gte", "lt", "lte", "contains", "not_contains"],
      default: "equals",
    },
    value: mongoose.Schema.Types.Mixed,
  },
  { _id: false }
);

const conditionalGroupSchema = new mongoose.Schema(
  {
    mode: { type: String, enum: ["all", "any"], default: "all" },
    rules: [conditionalRuleSchema],
    groups: [{ type: mongoose.Schema.Types.Mixed }],
  },
  { _id: false }
);

const validationRuleSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["required", "min", "max", "minLength", "maxLength", "regex", "email", "phone", "date", "fileType", "fileSize"],
      required: true,
    },
    value: mongoose.Schema.Types.Mixed,
    severity: { type: String, enum: ["error", "warning"], default: "error" },
    message: String,
  },
  { _id: false }
);

const optionSchema = new mongoose.Schema(
  {
    label: String,
    value: mongoose.Schema.Types.Mixed,
    metadata: mongoose.Schema.Types.Mixed,
  },
  { _id: false }
);

const questionSchema = new mongoose.Schema(
  {
    libraryItem: { type: mongoose.Schema.Types.ObjectId, ref: "QuestionLibraryItem", index: true },
    libraryKey: { type: String, trim: true, index: true },
    libraryVersion: { type: Number, default: 1 },
    questionnaire: { type: mongoose.Schema.Types.ObjectId, ref: "Questionnaire", required: true, index: true },
    questionnaireKey: { type: String, index: true },
    questionnaireVersion: { type: Number, default: 1, index: true },
    key: { type: String, required: true, trim: true },
    sectionKey: { type: String, default: "general", index: true },
    parentQuestionKey: String,
    order: { type: Number, default: 0, index: true },
    type: {
      type: String,
      enum: [
        "text",
        "textarea",
        "number",
        "currency",
        "percent",
        "date",
        "datetime",
        "email",
        "phone",
        "select",
        "multiselect",
        "multi_select",
        "radio",
        "checkbox",
        "boolean",
        "file",
        "file-multiple",
        "address",
        "person",
        "employment",
        "education",
        "travel_history",
        "immigration_history",
        "passport",
        "visa",
        "i94",
        "signature",
        "rich_text",
        "page_break",
        "section_break",
        "repeating_group",
        "group",
        "computed",
      ],
      default: "text",
    },
    pageKey: { type: String, default: "page_1", index: true },
    groupKey: String,
    nestedLevel: { type: Number, default: 0 },
    label: { type: String, required: true },
    description: String,
    helpText: String,
    placeholder: String,
    defaultValue: mongoose.Schema.Types.Mixed,
    options: [optionSchema],
    validationRules: [validationRuleSchema],
    conditionalLogic: {
      mode: { type: String, enum: ["all", "any"], default: "all" },
      rules: [conditionalRuleSchema],
      groups: [conditionalGroupSchema],
    },
    showIf: {
      field: String,
      operator: {
        type: String,
        enum: ["equals", "not_equals", "contains", "greater_than", "less_than", "exists", "not_exists", ""],
        default: "",
      },
      value: mongoose.Schema.Types.Mixed,
    },
    branching: {
      enabled: { type: Boolean, default: false },
      rules: [
        {
          when: { type: mongoose.Schema.Types.Mixed, default: {} },
          goToPageKey: String,
          goToSectionKey: String,
          hideQuestionKeys: [String],
          showQuestionKeys: [String],
        },
      ],
    },
    dependencies: [String],
    repeatable: { type: Boolean, default: false },
    repeatableConfig: {
      min: { type: Number, default: 0 },
      max: Number,
      labelTemplate: String,
      allowClientAdd: { type: Boolean, default: true },
    },
    nestedQuestions: [{ type: mongoose.Schema.Types.ObjectId, ref: "Question" }],
    layout: {
      width: { type: String, enum: ["full", "half", "third", "quarter"], default: "full" },
      column: Number,
      row: Number,
      draggable: { type: Boolean, default: true },
      cssClass: String,
    },
    visibility: {
      roles: [{ type: String }],
      portals: [{ type: String, enum: ["client", "admin", "employer", "employee"] }],
      readOnlyRoles: [{ type: String }],
    },
    fileConstraints: {
      allowedMimeTypes: [{ type: String }],
      maxFileSizeMb: Number,
      maxFiles: Number,
      requireDocumentCategory: String,
    },
    calculation: {
      formula: String,
      operation: { type: String, enum: ["none", "sum", "count", "average", "concat"], default: "none" },
      dependencies: [{ type: String }],
      precision: Number,
    },
    mapping: {
      masterDataPath: String,
      canonicalPath: String,
      uscisFormNumber: String,
      uscisFieldName: String,
      uscisFieldPath: String,
      transform: String,
    },
    uscisMappings: [{ type: String }],
    eligibilityWeight: { type: Number, default: 0 },
    evidenceCategory: { type: String, index: true },
    localization: { type: mongoose.Schema.Types.Mixed, default: {} },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    required: { type: Boolean, default: false, index: true },
    active: { type: Boolean, default: true, index: true },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

questionSchema.pre("validate", function syncEnterpriseFields(next) {
  const typeAliases = {
    multiselect: "multi_select",
    "file-multiple": "file",
  };
  if (typeAliases[this.type]) {
    this.metadata = { ...(this.metadata || {}), requestedType: this.type };
    this.type = typeAliases[this.type];
  }
  if (this.description && !this.helpText) this.helpText = this.description;
  if (this.helpText && !this.description) this.description = this.helpText;
  if (this.isActive === false) this.active = false;
  if (this.active === false) this.isActive = false;
  if (this.active !== false && this.isActive === undefined) this.isActive = true;

  if (this.showIf?.field) {
    const operatorMap = {
      greater_than: "gt",
      less_than: "lt",
      not_exists: "missing",
    };
    this.conditionalLogic = {
      mode: "all",
      rules: [{
        questionKey: this.showIf.field,
        operator: operatorMap[this.showIf.operator] || this.showIf.operator || "equals",
        value: this.showIf.value,
      }],
      groups: [],
    };
  } else if (!this.showIf?.field && this.conditionalLogic?.rules?.length) {
    const firstRule = this.conditionalLogic.rules[0];
    const operatorMap = {
      gt: "greater_than",
      gte: "greater_than",
      lt: "less_than",
      lte: "less_than",
      missing: "not_exists",
    };
    this.showIf = {
      field: firstRule.questionKey,
      operator: operatorMap[firstRule.operator] || firstRule.operator,
      value: firstRule.value,
    };
  }

  if (this.uscisMappings?.length && !this.mapping?.uscisFieldPath) {
    const [firstMapping] = this.uscisMappings;
    const [formNumber, ...pathParts] = String(firstMapping).split(".");
    this.mapping = {
      ...(this.mapping || {}),
      uscisFormNumber: formNumber,
      uscisFieldPath: pathParts.join("."),
    };
  } else if (this.mapping?.uscisFormNumber && this.mapping?.uscisFieldPath && !this.uscisMappings?.length) {
    this.uscisMappings = [`${this.mapping.uscisFormNumber}.${this.mapping.uscisFieldPath}`];
  }

  next();
});

questionSchema.index({ questionnaire: 1, key: 1 }, { unique: true });
questionSchema.index({ questionnaire: 1, active: 1, pageKey: 1, sectionKey: 1, order: 1 });
questionSchema.index({ questionnaire: 1, sectionKey: 1, order: 1 });
questionSchema.index({ questionnaire: 1, pageKey: 1, order: 1 });
questionSchema.index({ questionnaire: 1, groupKey: 1, order: 1 });

const Question = mongoose.model("Question", questionSchema);
// Exposed so other models (e.g. Questionnaire.checklistTriggers) can reuse the
// exact same recursive AND/OR condition shape instead of redefining it.
Question.conditionalRuleSchema = conditionalRuleSchema;
Question.conditionalGroupSchema = conditionalGroupSchema;

module.exports = Question;
