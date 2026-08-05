const mongoose = require("mongoose");

// Tier C/D triage queue (and the Tier A/B fallback when no booking roster
// is configured yet — see routing.service.js). Staff claim/assign items
// from here instead of a live calendar.
const strategyCallQueueItemSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
    tier: { type: String, enum: ["A", "B", "C", "D"], required: true },
    visaPathway: { type: String },
    languagePreference: { type: String, default: "English" },
    status: { type: String, enum: ["queued", "claimed", "contacted", "booked", "closed"], default: "queued", index: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

strategyCallQueueItemSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model("StrategyCallQueueItem", strategyCallQueueItemSchema);
