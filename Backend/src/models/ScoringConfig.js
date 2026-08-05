const mongoose = require("mongoose");

// Versioned, admin-editable tier/scoring rules per visa pathway — the
// "Excel workbook" the founder tunes without a code change. Only one
// isActive:true document per visaPathway at a time (enforced in
// quizAdmin.service); old versions retained for audit, never deleted.
const tierRuleSchema = new mongoose.Schema(
  {
    tier: { type: String, enum: ["A", "B", "C", "D"], required: true },
    minCriteriaMet: { type: Number, required: true },
    maxCriteriaMet: { type: Number, default: null },
    pathwayString: { type: String, required: true },
    routing: { type: String, enum: ["direct_priority", "direct", "strategy_queue", "nurture"], required: true },
  },
  { _id: false }
);

const scoringConfigSchema = new mongoose.Schema(
  {
    visaPathway: { type: String, required: true, index: true },
    version: { type: Number, required: true, default: 1 },
    isActive: { type: Boolean, default: true, index: true },
    filingStrengthThreshold: { type: Number, default: 2 },
    developableThreshold: { type: Number, default: 1 },
    tierRules: { type: [tierRuleSchema], default: [] },
    // Visa-appropriate "if this isn't your strongest fit, consider these
    // instead" suggestions surfaced by recommendation.service.js. Optional —
    // when empty/unset, recommendation.service.js falls back to a generic
    // default rather than requiring every ScoringConfig to set this.
    alternativePathways: { type: [String], default: [] },
    criterionWeights: { type: Map, of: Number, default: new Map() },
    effectiveFrom: { type: Date, default: Date.now },
    effectiveTo: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

scoringConfigSchema.index({ visaPathway: 1, version: -1 });
scoringConfigSchema.index({ visaPathway: 1, isActive: 1 });

module.exports = mongoose.model("ScoringConfig", scoringConfigSchema);
