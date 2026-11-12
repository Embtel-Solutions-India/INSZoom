const mongoose = require("mongoose");

// An email that must NOT be skipped but cannot go yet: the client it is for has not set a password (their account is not activated; the invitation e-mail is the only
// message they get until then). It waits here ("waiting"); when the client sets their password it is scheduled one minute apart from the others ("scheduled",
// sendAfter) and a background worker sends each one at its time. See modules/email/deferredEmail.service.js.
const STATUSES = ["waiting", "scheduled", "sending", "sent", "skipped", "failed"];

const deferredEmailSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    to: { type: String, required: true, trim: true, lowercase: true },
    templateKey: { type: String, required: true },
    data: mongoose.Schema.Types.Mixed,
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", index: true },
    triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    event: String,
    status: { type: String, enum: STATUSES, default: "waiting", index: true },
    sendAfter: Date,
    attempts: { type: Number, default: 0 },
    error: String,
    sentAt: Date,
    dedupeKey: { type: String, index: true },
  },
  { timestamps: true }
);

deferredEmailSchema.index({ status: 1, sendAfter: 1 });

module.exports = mongoose.models.DeferredEmail || mongoose.model("DeferredEmail", deferredEmailSchema);
module.exports.STATUSES = STATUSES;
