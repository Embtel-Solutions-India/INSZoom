const mongoose = require("mongoose");

const paymentRequestSchema = new mongoose.Schema(
  {
    requestId: { type: String, required: true, unique: true, index: true },
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", index: true },
    transactionId: { type: mongoose.Schema.Types.ObjectId },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    amount: Number,
    currency: { type: String, default: "usd" },
    status: {
      type: String,
      enum: ["received", "processing", "requires_action", "completed", "failed", "expired"],
      default: "received",
      index: true,
    },
    gateway: { type: String, enum: ["stripe", "manual", "bank_transfer", "cash", "other"], default: "stripe" },
    gatewaySessionId: String,
    gatewayPaymentIntentId: String,
    gatewayResponse: mongoose.Schema.Types.Mixed,
    duplicateCount: { type: Number, default: 0 },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    expiresAt: Date,
    ipAddress: String,
    userAgent: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model("PaymentRequest", paymentRequestSchema);
