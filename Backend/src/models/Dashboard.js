const mongoose = require("mongoose");

const widgetSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    title: String,
    type: { type: String, enum: ["metric", "chart", "table", "timeline", "list", "ai_insight", "custom"], default: "metric" },
    dataSource: String,
    query: mongoose.Schema.Types.Mixed,
    visualization: mongoose.Schema.Types.Mixed,
    layout: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
      w: { type: Number, default: 4 },
      h: { type: Number, default: 3 },
    },
    refreshSeconds: { type: Number, default: 300 },
    visibleToRoles: [String],
  },
  { _id: true }
);

const dashboardSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    description: String,
    dashboardType: { type: String, enum: ["saved", "template", "system"], default: "saved", index: true },
    role: { type: String, index: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    sharedWithRoles: [String],
    sharedWithUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    widgets: [widgetSchema],
    filters: mongoose.Schema.Types.Mixed,
    isDefault: { type: Boolean, default: false, index: true },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

dashboardSchema.index({ owner: 1, active: 1 });
dashboardSchema.index({ role: 1, dashboardType: 1, active: 1 });

module.exports = mongoose.model("Dashboard", dashboardSchema);
