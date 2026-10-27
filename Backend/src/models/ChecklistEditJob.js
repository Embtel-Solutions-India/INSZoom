const mongoose = require("mongoose");

// Durable record of ONE checklist edit a case manager asked for (removing a question, changing its wording). The editor shows the change at once and
// the server does the work afterwards: the job is claimed with a lease, retried with a growing delay until it succeeds (also after a restart), and edits
// to the same checklist always run in the order they were made. See modules/questionnaires/checklist-edit-jobs.service.js.
const checklistEditJobSchema = new mongoose.Schema(
  {
    caseId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    checklistId: { type: String, required: true },
    op: { type: String, enum: ["update", "remove", "restore"], required: true },
    questionKey: { type: String, required: true },
    patch: { type: mongoose.Schema.Types.Mixed, default: {} },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, required: true },
    status: { type: String, enum: ["pending", "processing", "done", "failed"], default: "pending" },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    lockedUntil: Date,
    lastError: String,
    completedAt: Date,
  },
  { timestamps: true, collection: "checklisteditjobs" }
);

checklistEditJobSchema.index({ status: 1, nextAttemptAt: 1 });
checklistEditJobSchema.index({ caseId: 1, checklistId: 1, status: 1, createdAt: 1 });

module.exports = mongoose.models.ChecklistEditJob || mongoose.model("ChecklistEditJob", checklistEditJobSchema);
