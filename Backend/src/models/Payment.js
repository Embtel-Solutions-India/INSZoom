const mongoose = require("mongoose");
const { PACKAGE_NAMES } = require("../config/packages");

const PAYMENT_STATUSES = ["not_started", "draft", "pending", "processing", "authorized", "partial", "partially_paid", "paid", "succeeded", "overdue", "failed", "refunded", "partially_refunded", "cancelled", "expired"];
const TRANSACTION_STATUSES = ["draft", "pending", "processing", "authorized", "paid", "succeeded", "failed", "cancelled", "expired", "refunded", "partially_refunded", "requires_action"];
const REFUND_STATUSES = ["pending", "succeeded", "failed", "cancelled"];

const transactionSchema = new mongoose.Schema(
  {
    amount: Number,
    currency: { type: String, default: "usd" },
    gateway: { type: String, enum: ["stripe", "manual", "bank_transfer", "cash", "other"], default: "stripe" },
    paymentMethod: String,
    transactionId: String,
    gatewayTransactionId: String,
    stripeSessionId: String,
    checkoutUrl: String,
    stripePaymentIntentId: String,
    paymentRequestId: { type: String, index: true },
    idempotencyKey: String,
    scheduleKey: String,
    installment: Number,
    label: String,
    status: { type: String, enum: TRANSACTION_STATUSES, default: "pending", index: true },
    failureReason: String,
    providerResponse: mongoose.Schema.Types.Mixed,
    retryCount: { type: Number, default: 0 },
    nextRetryAt: Date,
    paidAt: Date,
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const refundSchema = new mongoose.Schema(
  {
    amount: Number,
    currency: { type: String, default: "usd" },
    reason: String,
    status: { type: String, enum: REFUND_STATUSES, default: "pending" },
    transactionId: String,
    gatewayRefundId: String,
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    requestedAt: { type: Date, default: Date.now },
    processedAt: Date,
  },
  { _id: true }
);

const scheduleSchema = new mongoose.Schema(
  {
    installment: Number,
    sequence: Number,
    amount: Number,
    dueDate: Date,
    status: { type: String, enum: ["scheduled", "pending", "paid", "overdue", "cancelled"], default: "pending" },
    paidAt: Date,
    transaction: { type: mongoose.Schema.Types.ObjectId },
  },
  { _id: true }
);

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, index: true },
    status: { type: String, enum: ["draft", "issued", "paid", "void", "overdue"], default: "issued" },
    issuedAt: { type: Date, default: Date.now },
    dueDate: Date,
    subtotal: Number,
    discountAmount: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    total: Number,
    currency: { type: String, default: "usd" },
    organization: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
    client: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case" },
    billingItems: [
      {
        code: String,
        description: { type: String, required: true },
        quantity: { type: Number, default: 1, min: 0 },
        unitAmount: { type: Number, required: true, min: 0 },
        amount: { type: Number, required: true, min: 0 },
        taxable: { type: Boolean, default: false },
      },
    ],
    notes: String,
    pdfUrl: String,
  },
  { _id: true }
);

const reconciliationSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ["unreconciled", "matched", "mismatch", "ignored"], default: "unreconciled" },
    gatewayBalanceTransactionId: String,
    gatewayFeeAmount: { type: Number, default: 0 },
    netAmount: Number,
    reconciledAt: Date,
    reconciledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    notes: String,
  },
  { _id: false }
);

const auditHistorySchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    performedAt: { type: Date, default: Date.now },
    changes: mongoose.Schema.Types.Mixed,
    ipAddress: String,
    userAgent: String,
  },
  { _id: true }
);

// Must be an explicit Schema, not a bare object literal: a nested array
// element definition that itself has a field named `type` (webhook events
// naturally have an event `type`) gets misread by Mongoose's schema compiler
// as a type descriptor (`{ type: String }`) for the whole element instead of
// a field named "type" — silently downgrading this to an array of strings
// and making every `.push()` throw a CastError. An explicit Schema instance
// has no such ambiguity.
const webhookEventSchema = new mongoose.Schema(
  {
    eventId: String,
    type: String,
    receivedAt: { type: Date, default: Date.now },
    processedAt: Date,
    status: String,
  },
  { _id: false }
);

const paymentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    case: { type: mongoose.Schema.Types.ObjectId, ref: "Case", index: true },
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", index: true },
    clientPortalId: { type: String, index: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", index: true },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: "Team", index: true },

    invoiceNumber: { type: String, unique: true, sparse: true },
    invoices: [invoiceSchema],

    package: { type: String, enum: [...PACKAGE_NAMES, ""], default: "" },
    packageKey: String,
    packageName: String,
    pricingVersion: String,

    baseAmount: { type: Number, default: 0 },
    totalFee: { type: Number, default: 0 },
    subtotalAmount: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    discountLabel: { type: String, default: "" },
    appliedReferralCode: { type: String, default: "" },
    taxAmount: { type: Number, default: 0 },
    taxRate: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    amountPaid: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 },
    refundedAmount: { type: Number, default: 0 },
    remainingAmount: { type: Number, default: 0 },
    currency: { type: String, default: "usd" },

    status: { type: String, enum: PAYMENT_STATUSES, default: "not_started", index: true },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: "not_started", index: true },
    lifecycleStatus: {
      type: String,
      enum: ["draft", "pending", "processing", "authorized", "succeeded", "failed", "refunded", "partially_refunded", "cancelled", "expired"],
      default: "draft",
      index: true,
    },
    paymentDate: Date,
    processingLock: {
      requestId: String,
      lockedAt: Date,
      lockedUntil: Date,
    },

    planKey: { type: String, enum: ["pay_in_full", "two_installments", "four_installments", "custom"], default: "pay_in_full" },
    recurring: {
      enabled: { type: Boolean, default: false },
      interval: { type: String, enum: ["month", "quarter", "year", ""], default: "" },
      nextRunAt: Date,
      cancelledAt: Date,
    },
    nextPaymentAmount: Number,
    nextPaymentDueDate: Date,
    paymentSchedule: [scheduleSchema],
    transactions: [transactionSchema],
    paymentHistory: [
      {
        amount: Number,
        paymentDate: Date,
        paymentMethod: String,
        transactionId: String,
        notes: String,
      },
    ],
    refunds: [refundSchema],
    receipts: [
      {
        receiptNumber: String,
        transactionId: mongoose.Schema.Types.ObjectId,
        amount: Number,
        issuedAt: { type: Date, default: Date.now },
        downloadUrl: String,
        emailedAt: Date,
      },
    ],
    disputes: [
      {
        providerDisputeId: String,
        amount: Number,
        status: String,
        reason: String,
        openedAt: Date,
        resolvedAt: Date,
      },
    ],
    fraudReview: {
      status: { type: String, enum: ["not_required", "pending", "approved", "blocked"], default: "not_required" },
      score: Number,
      reasons: [String],
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      reviewedAt: Date,
    },
    reconciliation: reconciliationSchema,
    webhookEvents: [webhookEventSchema],
    replayProtection: {
      processedEventIds: [{ type: String, index: true }],
      lastWebhookAt: Date,
    },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    legacySource: { type: String, enum: ["BAIS", "INSZoom", "shared", ""], default: "shared" },
    auditHistory: [auditHistorySchema],
  },
  { timestamps: true }
);

function hasSettlementStatus(status) {
  return ["paid", "succeeded", "partial", "partially_paid", "refunded", "partially_refunded"].includes(status);
}

paymentSchema.pre("validate", function syncPaymentCompatibility(next) {
  if (this.case && !this.caseId) this.caseId = this.case;
  if (this.caseId && !this.case) this.case = this.caseId;
  if (this.totalAmount && !this.totalFee) this.totalFee = this.totalAmount;
  if (this.totalFee && !this.totalAmount) this.totalAmount = this.totalFee;
  if (this.amountPaid !== undefined && this.paidAmount !== this.amountPaid) this.paidAmount = this.amountPaid;
  if (this.paidAmount !== undefined && this.amountPaid !== this.paidAmount) this.amountPaid = this.paidAmount;
  const netPaid = Math.max((this.amountPaid || 0) - (this.refundedAmount || 0), 0);
  this.remainingAmount = Math.max((this.totalAmount || this.totalFee || 0) - netPaid, 0);
  const normalizedStatus = this.refundedAmount >= this.amountPaid && this.amountPaid > 0
    ? "refunded"
    : this.refundedAmount > 0
      ? "partially_refunded"
      : this.remainingAmount <= 0 && this.amountPaid > 0
        ? "paid"
        : this.amountPaid > 0
          ? "partially_paid"
          : hasSettlementStatus(this.status || this.paymentStatus)
            ? "not_started"
            : this.status || this.paymentStatus || "not_started";
  this.status = normalizedStatus === "partially_paid" ? "partial" : normalizedStatus;
  this.paymentStatus = normalizedStatus;
  if (["paid", "succeeded"].includes(this.paymentStatus)) this.lifecycleStatus = "succeeded";
  else if (this.paymentStatus === "partially_paid") this.lifecycleStatus = "processing";
  else if (["refunded", "partially_refunded", "failed", "cancelled", "expired", "authorized", "processing", "pending", "draft"].includes(this.paymentStatus)) this.lifecycleStatus = this.paymentStatus;
  else if (this.paymentStatus === "not_started") this.lifecycleStatus = "draft";
  if (!this.invoiceNumber) this.invoiceNumber = `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  next();
});

paymentSchema.pre("save", function protectPaidInvoices(next) {
  if (!this.isNew && this.isModified("invoices") && (this.amountPaid || this.paidAmount || 0) > 0) {
    const error = new Error("Invoices cannot be modified after payment activity begins");
    error.status = 409;
    return next(error);
  }
  return next();
});

paymentSchema.index({ caseId: 1, createdAt: -1 });
paymentSchema.index({ user: 1, createdAt: -1 });
paymentSchema.index({ paymentStatus: 1, nextPaymentDueDate: 1 });
paymentSchema.index({ companyId: 1, paymentStatus: 1 });
paymentSchema.index({ teamId: 1, paymentStatus: 1 });
paymentSchema.index({ "transactions.stripeSessionId": 1 });
paymentSchema.index({ "transactions.stripePaymentIntentId": 1 });
paymentSchema.index({ "transactions.idempotencyKey": 1 });
paymentSchema.index({ "webhookEvents.eventId": 1 });

module.exports = mongoose.model("Payment", paymentSchema);
