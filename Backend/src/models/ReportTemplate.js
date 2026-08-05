const mongoose = require("mongoose");

const reportTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    description: String,
    reportType: {
      type: String,
      enum: ["case", "financial", "user", "company", "ocr", "workflow", "audit", "eod", "custom"],
      required: true,
      index: true,
    },
    dataSource: String,
    filters: mongoose.Schema.Types.Mixed,
    columns: [
      {
        key: String,
        label: String,
        type: String,
      },
    ],
    groupBy: [String],
    sortBy: mongoose.Schema.Types.Mixed,
    chartConfig: mongoose.Schema.Types.Mixed,
    visibility: {
      owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
      roles: [String],
      users: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      publicToAdmins: { type: Boolean, default: false },
    },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

reportTemplateSchema.index({ reportType: 1, active: 1 });

module.exports = mongoose.model("ReportTemplate", reportTemplateSchema);
