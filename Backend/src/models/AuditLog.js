const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    userRole: String,
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: String,
    changes: mongoose.Schema.Types.Mixed,
    previousValue: mongoose.Schema.Types.Mixed,
    newValue: mongoose.Schema.Types.Mixed,
    ipAddress: String,
    userAgent: String,
    device: String,
    browser: String,
    requestId: String,
    sessionId: String,
    status: { type: String, enum: ["success", "failure", "blocked", "pending"], default: "success", index: true },
    severity: { type: String, enum: ["low", "medium", "high", "critical"], default: "low", index: true },
    source: { type: String, enum: ["api", "auth", "system", "webhook", "job", "import", "export"], default: "api", index: true },
    metadata: mongoose.Schema.Types.Mixed,
    details: String,
    description: String,
  },
  { timestamps: true }
);

auditLogSchema.index({ userId: 1 });
auditLogSchema.index({ entityType: 1, entityId: 1 });
// TTL: bounds this append-only collection's growth. 2-year default retention —
// adjust expireAfterSeconds if a different compliance retention window applies.
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 * 2 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ severity: 1, status: 1, createdAt: -1 });

auditLogSchema.pre("save", function preventAuditMutation(next) {
  if (!this.isNew) {
    const error = new Error("Audit logs are immutable");
    error.status = 409;
    return next(error);
  }
  return next();
});

module.exports = mongoose.model("AuditLog", auditLogSchema);
