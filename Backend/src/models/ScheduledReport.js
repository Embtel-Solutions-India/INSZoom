const mongoose = require("mongoose");

const scheduledReportSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    reportType: {
      type: String,
      enum: ["dashboard", "case_analytics", "revenue", "users", "documents", "workflow", "questionnaire", "messaging", "appointments", "custom"],
      default: "dashboard",
      index: true,
    },
    schedule: {
      frequency: { type: String, enum: ["daily", "weekly", "monthly", "quarterly"], default: "weekly" },
      timezone: { type: String, default: "UTC" },
      nextRunAt: Date,
      lastRunAt: Date,
    },
    recipients: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        email: String,
      },
    ],
    filters: mongoose.Schema.Types.Mixed,
    exportFormat: { type: String, enum: ["json", "csv", "pdf", "xlsx"], default: "json" },
    status: { type: String, enum: ["active", "paused", "failed", "archived"], default: "active", index: true },
    lastResult: mongoose.Schema.Types.Mixed,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

scheduledReportSchema.index({ "schedule.nextRunAt": 1, status: 1 });

module.exports = mongoose.model("ScheduledReport", scheduledReportSchema);
