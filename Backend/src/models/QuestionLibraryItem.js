const mongoose = require("mongoose");

const sourceSchema = new mongoose.Schema(
  {
    formTemplate: { type: mongoose.Schema.Types.ObjectId, ref: "USCISFormTemplate", required: true },
    formCode: { type: String, required: true, trim: true },
    formVersion: { type: String, required: true, trim: true },
    editionDate: Date,
    fieldId: { type: String, required: true },
    fieldName: String,
    pageNumber: Number,
    sectionKey: String,
    subsectionKey: String,
    required: { type: Boolean, default: false },
    conditional: { type: Boolean, default: false },
    repeatable: { type: Boolean, default: false },
    validationRules: mongoose.Schema.Types.Mixed,
    dependencies: [mongoose.Schema.Types.Mixed],
    extractionConfidence: Number,
    parserStatus: String,
    synchronizedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const questionLibraryItemSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, index: true },
    canonicalPath: { type: String, trim: true, sparse: true, index: true },
    label: { type: String, required: true, trim: true, index: true },
    normalizedLabel: { type: String, required: true, trim: true, index: true },
    aliases: [{ type: String, trim: true }],
    sectionKey: { type: String, required: true, index: true },
    sectionTitle: { type: String, required: true },
    type: { type: String, required: true, default: "text", index: true },
    options: [mongoose.Schema.Types.Mixed],
    requirement: {
      type: String,
      enum: ["required", "optional", "conditional", "mixed"],
      default: "optional",
      index: true,
    },
    repeatable: { type: Boolean, default: false, index: true },
    repeatableConfig: mongoose.Schema.Types.Mixed,
    validationRules: [mongoose.Schema.Types.Mixed],
    dependencies: [mongoose.Schema.Types.Mixed],
    conditionalLogic: mongoose.Schema.Types.Mixed,
    sources: [sourceSchema],
    sourceForms: [{ type: String, trim: true, index: true }],
    sourceFieldCount: { type: Number, default: 0 },
    confidence: { type: Number, min: 0, max: 1, default: 0 },
    review: {
      status: { type: String, enum: ["approved", "needs_review", "rejected"], default: "needs_review", index: true },
      reasons: [String],
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      reviewedAt: Date,
      notes: String,
    },
    lawFirmSpecific: { type: Boolean, default: false, index: true },
    organization: { type: mongoose.Schema.Types.ObjectId, ref: "Company", index: true },
    active: { type: Boolean, default: true, index: true },
    version: { type: Number, default: 1 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

questionLibraryItemSchema.index({ sectionKey: 1, active: 1, label: 1 });
questionLibraryItemSchema.index({ sourceForms: 1, active: 1 });
questionLibraryItemSchema.index({ organization: 1, lawFirmSpecific: 1, active: 1 });
questionLibraryItemSchema.index({ normalizedLabel: 1, type: 1 });

module.exports = mongoose.model("QuestionLibraryItem", questionLibraryItemSchema);
