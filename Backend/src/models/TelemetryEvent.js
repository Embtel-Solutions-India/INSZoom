const mongoose = require("mongoose");

// Product-analytics event spine — deliberately separate from AuditLog.
// AuditLog answers "who did what to what, for compliance"; this answers
// "what happened in the funnel, for product metrics." Never mix the two:
// this collection must stay safe to aggregate/export to a BI tool without
// touching anything security-sensitive.
const telemetryEventSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, index: true },
    sessionId: { type: String, default: "", index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    properties: { type: mongoose.Schema.Types.Mixed, default: {} },
    utm: {
      source: String,
      medium: String,
      campaign: String,
      term: String,
      content: String,
    },
    source: { type: String, enum: ["web", "api", "system"], default: "web" },
    ipHash: { type: String, default: "" },
    occurredAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

telemetryEventSchema.index({ name: 1, occurredAt: -1 });
telemetryEventSchema.index({ sessionId: 1, occurredAt: 1 });
// TTL retention consistent with AuditLog's approach — telemetry is
// higher-volume/lower-stakes than audit, so a shorter window is appropriate.
telemetryEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 });

module.exports = mongoose.model("TelemetryEvent", telemetryEventSchema);
