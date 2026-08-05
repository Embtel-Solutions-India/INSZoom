const mongoose = require("mongoose");

const EMAIL_STATUSES = ["queued", "sent", "failed", "skipped"];

const emailLogSchema = new mongoose.Schema(
  {
    templateKey: { type: String, required: true, index: true },
    to: { type: String, required: true, trim: true, lowercase: true, index: true },
    cc: [{ type: String, trim: true, lowercase: true }],
    subject: { type: String, required: true },
    status: { type: String, enum: EMAIL_STATUSES, default: "queued", index: true },
    error: String,
    providerMessageId: String,
    attempts: { type: Number, default: 0 },
    sentAt: Date,

    // Linking context so any email can be traced back to the entity that triggered it
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    data: mongoose.Schema.Types.Mixed,
    source: { type: String, enum: ["BAIS", "INSZoom", "shared", "system"], default: "shared" },
  },
  { timestamps: true }
);

emailLogSchema.index({ createdAt: -1 });
emailLogSchema.index({ caseId: 1, createdAt: -1 });

module.exports = mongoose.model("EmailLog", emailLogSchema);
module.exports.EMAIL_STATUSES = EMAIL_STATUSES;
