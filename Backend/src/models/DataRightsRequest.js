const mongoose = require("mongoose");

// Right-to-export / right-to-delete request + fulfilment workflow (PRD C-6).
// `resultRef` stores only a pointer to where an export artifact lives
// (e.g. a Document storageKey) — never the subject's data itself, so this
// collection is safe to list/browse without re-exposing what was exported.
const dataRightsRequestSchema = new mongoose.Schema(
  {
    subjectUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    type: { type: String, enum: ["export", "erasure"], required: true },
    status: { type: String, enum: ["pending", "approved", "rejected", "completed", "failed"], default: "pending", index: true },
    reason: { type: String, default: "" },
    resultRef: { type: String, default: "" },
    failureReason: { type: String, default: "" },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    completedAt: Date,
  },
  { timestamps: true }
);

dataRightsRequestSchema.index({ subjectUserId: 1, createdAt: -1 });
dataRightsRequestSchema.index({ type: 1, status: 1 });

module.exports = mongoose.model("DataRightsRequest", dataRightsRequestSchema);
