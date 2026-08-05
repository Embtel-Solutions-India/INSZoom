const mongoose = require("mongoose");

// Versioned, admin-editable public quiz question set per visa pathway.
// Only one isActive:true document may exist per visaPathway at a time
// (enforced in quizAdmin.service, not the schema) — activating a new
// version deactivates the prior one non-destructively; old versions are
// retained for audit, never deleted.
const profileQuestionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    type: { type: String, enum: ["select", "text"], default: "text" },
    options: { type: [String], default: [] },
    required: { type: Boolean, default: true },
  },
  { _id: false }
);

const criteriaQuestionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    uscisCriterion: { type: String, default: "" },
    helpText: { type: String, default: "" },
    answerScale: {
      min: { type: Number, default: 0 },
      max: { type: Number, default: 3 },
    },
    scaleLabels: { type: [String], default: ["None", "Developing", "Solid", "Strong"] },
  },
  { _id: false }
);

const quizDefinitionSchema = new mongoose.Schema(
  {
    visaPathway: { type: String, required: true, index: true },
    version: { type: Number, required: true, default: 1 },
    isActive: { type: Boolean, default: true, index: true },
    profileQuestions: { type: [profileQuestionSchema], default: [] },
    criteriaQuestions: { type: [criteriaQuestionSchema], default: [] },
    effectiveFrom: { type: Date, default: Date.now },
    effectiveTo: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

quizDefinitionSchema.index({ visaPathway: 1, version: -1 });
quizDefinitionSchema.index({ visaPathway: 1, isActive: 1 });

module.exports = mongoose.model("QuizDefinition", quizDefinitionSchema);
