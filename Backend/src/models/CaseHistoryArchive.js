const mongoose = require("mongoose");

// Overflow storage for capped embedded-history arrays (Case.stageHistory,
// activityLog, timeline, auditHistory, and similar unbounded arrays on other
// models). Nothing is discarded when an array is capped at write time — the
// entries pushed out by the cap land here instead, keyed by the owning
// document so they can still be looked up if ever needed.
const caseHistoryArchiveSchema = new mongoose.Schema(
  {
    entityType: { type: String, required: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true },
    fieldName: { type: String, required: true },
    entries: { type: [mongoose.Schema.Types.Mixed], required: true },
  },
  { timestamps: true }
);

caseHistoryArchiveSchema.index({ entityType: 1, entityId: 1, fieldName: 1 });

module.exports = mongoose.model("CaseHistoryArchive", caseHistoryArchiveSchema);
