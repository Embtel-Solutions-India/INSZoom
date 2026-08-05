const mongoose = require("mongoose");

const searchHistorySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    query: { type: String, default: "", trim: true, index: true },
    normalizedQuery: { type: String, default: "", trim: true, index: true },
    entities: [{ type: String }],
    filters: { type: mongoose.Schema.Types.Mixed, default: {} },
    resultCount: { type: Number, default: 0 },
    durationMs: Number,
    source: { type: String, enum: ["global", "autocomplete", "suggestion", "natural_language"], default: "global", index: true },
    ipAddress: String,
    userAgent: String,
  },
  { timestamps: true }
);

searchHistorySchema.index({ user: 1, createdAt: -1 });
searchHistorySchema.index({ normalizedQuery: 1, createdAt: -1 });

module.exports = mongoose.model("SearchHistory", searchHistorySchema);
