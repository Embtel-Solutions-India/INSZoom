const mongoose = require("mongoose");

// Durable record of a permanent case deletion. The case, its child cases and any orphaned client accounts are removed
// from the database immediately (so they vanish from every portal at once); everything that only existed for them
// (answers, documents and their stored files, forms, messages, audit rows, ...) is swept by a background worker from
// this record. The job holds every id the sweep needs, so it can be retried safely: each step is "delete where id is in
// this list", which is idempotent.
const caseDeletionJobSchema = new mongoose.Schema(
  {
    caseIds: [{ type: mongoose.Schema.Types.ObjectId }],
    caseNumbers: [String],
    userIds: [{ type: mongoose.Schema.Types.ObjectId }],
    emails: [String],
    requestedBy: { type: mongoose.Schema.Types.ObjectId },
    status: { type: String, enum: ["pending", "processing", "done", "failed"], default: "pending" },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    lockedUntil: Date,
    lastError: String,
    result: { type: mongoose.Schema.Types.Mixed },
    completedAt: Date,
  },
  { timestamps: true, collection: "casedeletionjobs" }
);

caseDeletionJobSchema.index({ status: 1, nextAttemptAt: 1 });

module.exports = mongoose.models.CaseDeletionJob || mongoose.model("CaseDeletionJob", caseDeletionJobSchema);
