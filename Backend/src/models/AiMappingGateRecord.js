// One accuracy evaluation of the AI field-mapping engine against the signed golden set (Phase 4). APPEND-ONLY and permanent: a later evaluation SUPERSEDES an earlier one simply by
// being newer (the gate always reads the latest record); nothing is edited or removed, so the history of what was measured, with which prompt and model, stays on record.
//   met                  every pre-approved criterion held (see form-ai-mapping/accuracy/thresholds.js)
//   promptVersion/model  what produced the suggestions: a change of either makes the record stale (the gate closes until it is evaluated again)
//   goldenChecksum       the golden draft that was the answer key: if the key changes, the record no longer describes it
const mongoose = require("mongoose");
const { appendOnly } = require("./helpers/appendOnly");

const aiMappingGateRecordSchema = new mongoose.Schema(
  {
    evaluatedAt: { type: Date, default: Date.now },
    source: { type: String, enum: ["shadow_store", "live", "manual"], default: "shadow_store" },
    by: { type: String, default: "system" },
    met: { type: Boolean, required: true, index: true },
    thresholds: { type: mongoose.Schema.Types.Mixed, default: {} },
    summary: { type: mongoose.Schema.Types.Mixed, default: {} }, // results, blockers, overall + per-family / per-kind metrics, violation totals - never client data
    promptVersion: { type: String, required: true },
    model: { type: String, required: true },
    goldenChecksum: { type: String, required: true },
    families: { type: [String], default: [] },
    forms: { type: [String], default: [] },
    expiresAt: { type: Date, required: true },
  },
  { minimize: false }
);

aiMappingGateRecordSchema.index({ evaluatedAt: -1 });
appendOnly(aiMappingGateRecordSchema, "AiMappingGateRecord");

module.exports = mongoose.models.AiMappingGateRecord || mongoose.model("AiMappingGateRecord", aiMappingGateRecordSchema);
