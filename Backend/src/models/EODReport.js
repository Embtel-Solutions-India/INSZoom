const mongoose = require("mongoose");

const eodReportSchema = new mongoose.Schema(
  {
    staff: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    role: {
      type: String,
      enum: ["team_lead", "case_manager", "admin", "super_admin"],
      required: true,
      index: true,
    },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: "Team", index: true },
    department: { type: String, trim: true },
    date: { type: Date, required: true, index: true },
    casesWorked: { type: Number, default: 0 },
    casesClosed: { type: Number, default: 0 },
    documentsReviewed: { type: Number, default: 0 },
    messagesReplied: { type: Number, default: 0 },
    pendingTasks: { type: Number, default: 0 },
    hoursWorked: Number,
    blockers: String,
    notes: String,
    reviewed: { type: Boolean, default: false, index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: Date,
    reviewComment: String,
    source: { type: String, enum: ["manual", "automatic"], default: "manual", index: true },
    generatedAt: Date,
  },
  { timestamps: true }
);

eodReportSchema.index({ staff: 1, date: -1 }, { unique: true });
eodReportSchema.index({ role: 1, date: -1 });
eodReportSchema.index({ teamId: 1, date: -1 });

module.exports = mongoose.model("EODReport", eodReportSchema);
