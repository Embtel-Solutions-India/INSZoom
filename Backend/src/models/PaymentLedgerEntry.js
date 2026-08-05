const mongoose = require("mongoose");

const paymentLedgerEntrySchema = new mongoose.Schema(
  {
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", required: true, index: true },
    transactionId: { type: mongoose.Schema.Types.ObjectId, index: true },
    invoiceNumber: { type: String, index: true },
    entryType: {
      type: String,
      enum: ["invoice", "authorization", "charge", "refund", "fee", "adjustment", "write_off", "reconciliation"],
      required: true,
      index: true,
    },
    direction: { type: String, enum: ["debit", "credit"], required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "usd" },
    balanceAfter: Number,
    provider: { type: String, enum: ["stripe", "manual", "bank_transfer", "cash", "other"], default: "stripe" },
    providerEventId: String,
    providerObjectId: String,
    description: String,
    metadata: mongoose.Schema.Types.Mixed,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    ipAddress: String,
    userAgent: String,
  },
  { timestamps: true }
);

paymentLedgerEntrySchema.index({ providerEventId: 1, entryType: 1 }, { unique: true, sparse: true });
paymentLedgerEntrySchema.index(
  { paymentId: 1, transactionId: 1, entryType: 1 },
  { unique: true, partialFilterExpression: { transactionId: { $type: "objectId" }, entryType: "charge" } }
);

paymentLedgerEntrySchema.pre("save", function preventLedgerMutation(next) {
  if (!this.isNew) {
    const error = new Error("Ledger entries are immutable");
    error.status = 409;
    return next(error);
  }
  return next();
});

module.exports = mongoose.model("PaymentLedgerEntry", paymentLedgerEntrySchema);
