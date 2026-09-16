const mongoose = require("mongoose");

// Every write through the settings engine (SettingsEngineService.set/
// bulkSet/rollback) records one of these, independent of the general
// audit.service audit log (that one is mirrored to as well where present —
// see settingsEngine.service.js). sensitive:true registry entries store
// '[REDACTED]' for previousValue/newValue — the fact of a change is
// recorded, never a secret's value.
const settingsAuditLogSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, index: true },
    category: { type: String, index: true },
    scope: { type: String, enum: ["system", "organization", "team", "user"], required: true },
    scopeId: { type: mongoose.Schema.Types.Mixed, default: null },
    previousValue: { type: mongoose.Schema.Types.Mixed },
    newValue: { type: mongoose.Schema.Types.Mixed },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    changedByRole: { type: String },
    ip: { type: String },
    userAgent: { type: String },
    reason: { type: String, default: "" },
    action: { type: String, enum: ["set", "bulk_set", "rollback"], default: "set" },
  },
  { timestamps: { createdAt: "at", updatedAt: false } }
);

settingsAuditLogSchema.index({ at: -1 });

module.exports = mongoose.model("SettingsAuditLog", settingsAuditLogSchema);
