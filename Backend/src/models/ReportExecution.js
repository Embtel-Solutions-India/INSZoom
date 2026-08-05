const mongoose = require("mongoose");

const reportExecutionSchema = new mongoose.Schema(
  {
    template: { type: mongoose.Schema.Types.ObjectId, ref: "ReportTemplate", index: true },
    reportType: { type: String, required: true, index: true },
    name: String,
    filters: mongoose.Schema.Types.Mixed,
    format: { type: String, enum: ["json", "csv", "xlsx", "pdf"], default: "json", index: true },
    status: { type: String, enum: ["queued", "running", "completed", "failed"], default: "completed", index: true },
    rowCount: { type: Number, default: 0 },
    summary: mongoose.Schema.Types.Mixed,
    downloadUrl: String,
    error: String,
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    startedAt: Date,
    completedAt: Date,
    ipAddress: String,
    userAgent: String,
  },
  { timestamps: true }
);

reportExecutionSchema.index({ generatedBy: 1, createdAt: -1 });
reportExecutionSchema.index({ reportType: 1, createdAt: -1 });

module.exports = mongoose.model("ReportExecution", reportExecutionSchema);
