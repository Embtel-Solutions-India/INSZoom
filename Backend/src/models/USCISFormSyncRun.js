const mongoose = require("mongoose");

const uscisFormSyncRunSchema = new mongoose.Schema(
  {
    provider: { type: String, default: "uscis", index: true },
    sourceUrls: [String],
    status: { type: String, enum: ["running", "completed", "partial", "failed"], default: "running", index: true },
    startedAt: { type: Date, default: Date.now, index: true },
    completedAt: Date,
    durationMs: Number,
    triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    trigger: { type: String, enum: ["scheduled", "manual", "api", "test"], default: "scheduled" },
    summary: {
      formsDiscovered: { type: Number, default: 0 },
      formsProcessed: { type: Number, default: 0 },
      newForms: { type: Number, default: 0 },
      updatedEditions: { type: Number, default: 0 },
      deprecatedForms: { type: Number, default: 0 },
      missingMappings: { type: Number, default: 0 },
      unchangedForms: { type: Number, default: 0 },
      failures: { type: Number, default: 0 },
    },
    newForms: [mongoose.Schema.Types.Mixed],
    updatedEditions: [mongoose.Schema.Types.Mixed],
    deprecatedForms: [mongoose.Schema.Types.Mixed],
    missingMappings: [mongoose.Schema.Types.Mixed],
    failures: [mongoose.Schema.Types.Mixed],
    results: [mongoose.Schema.Types.Mixed],
    metadata: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

uscisFormSyncRunSchema.index({ provider: 1, startedAt: -1 });
uscisFormSyncRunSchema.index({ status: 1, startedAt: -1 });

module.exports = mongoose.model("USCISFormSyncRun", uscisFormSyncRunSchema);
