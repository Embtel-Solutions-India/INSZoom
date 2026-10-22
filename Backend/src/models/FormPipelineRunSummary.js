// Phase 5: one row per scheduled run of a form-pipeline job (catalog sync, autopilot, edition upgrade), so the governance screen can show "what ran, how long, what changed".
// Counts only: no case data, no form content. Kept 90 days (TTL on expireAt); the recorder also prunes everything beyond the newest 200 rows per kind.
const mongoose = require("mongoose");

const RUN_KINDS = ["catalog_sync", "autopilot", "edition_upgrade"];

const formPipelineRunSummarySchema = new mongoose.Schema(
  {
    kind: { type: String, enum: RUN_KINDS, required: true },
    startedAt: { type: Date, required: true },
    finishedAt: Date,
    durationMs: Number,
    checked: { type: Number, default: 0 },
    changed: { type: Number, default: 0 },
    promoted: { type: Number, default: 0 },
    held: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    error: String,
    expireAt: Date,
  },
  { versionKey: false }
);

// the app runs with autoIndex off: scripts/createFormGovernanceIndexes.js --apply creates these
formPipelineRunSummarySchema.index({ kind: 1, startedAt: -1 });
formPipelineRunSummarySchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.FormPipelineRunSummary || mongoose.model("FormPipelineRunSummary", formPipelineRunSummarySchema);
module.exports.RUN_KINDS = RUN_KINDS;
