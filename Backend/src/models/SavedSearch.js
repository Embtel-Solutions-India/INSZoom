const mongoose = require("mongoose");

const savedSearchSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: String,
    query: { type: String, default: "", trim: true },
    entities: [{ type: String, index: true }],
    filters: { type: mongoose.Schema.Types.Mixed, default: {} },
    sort: { type: mongoose.Schema.Types.Mixed, default: {} },
    visibility: { type: String, enum: ["private", "team", "organization"], default: "private", index: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: "Team", index: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", index: true },
    pinned: { type: Boolean, default: false, index: true },
    lastRunAt: Date,
    runCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

savedSearchSchema.index({ owner: 1, updatedAt: -1 });
savedSearchSchema.index({ visibility: 1, updatedAt: -1 });
savedSearchSchema.index({ name: "text", query: "text", description: "text" });

module.exports = mongoose.model("SavedSearch", savedSearchSchema);
