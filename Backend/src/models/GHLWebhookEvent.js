const mongoose = require("mongoose");

// Idempotency log + processing state machine for inbound GHL webhooks.
//   received -> processing -> processed | ignored
//   processing -> failed (retried with backoff) -> dead (after max attempts)
const ghlWebhookEventSchema = new mongoose.Schema(
  {
    webhookId: { type: String, required: true, unique: true },
    eventType: { type: String, required: true },
    eventVersion: String,
    locationId: String,
    opportunityId: String,
    contactId: String,
    payload: mongoose.Schema.Types.Mixed,
    eventTimestamp: Date,
    receivedAt: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ["received", "processing", "processed", "ignored", "deferred", "failed", "dead"],
      default: "received",
    },
    processingAttempts: { type: Number, default: 0 },
    // Times this event was parked waiting on our own pending outbound change.
    deferrals: { type: Number, default: 0 },
    lastAttemptAt: Date,
    nextAttemptAt: { type: Date, default: Date.now },
    lockedUntil: Date,
    lastError: String,
    processedAt: Date,
  },
  { timestamps: true }
);

ghlWebhookEventSchema.index({ status: 1, nextAttemptAt: 1 });
ghlWebhookEventSchema.index({ opportunityId: 1, receivedAt: -1 });
// Only finished events expire; failed/dead/deferred ones stay for debugging.
ghlWebhookEventSchema.index(
  { processedAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 30, partialFilterExpression: { status: { $in: ["processed", "ignored"] } } }
);

module.exports = mongoose.model("GHLWebhookEvent", ghlWebhookEventSchema);
