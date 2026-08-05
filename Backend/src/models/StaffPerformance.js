const mongoose = require("mongoose");

const staffPerformanceSchema = new mongoose.Schema(
  {
    staff: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    role: { type: String, enum: ["case_manager", "team_lead", "admin", "super_admin"], required: true, index: true },
    period: { type: String, enum: ["today", "this_week", "this_month"], required: true, index: true },
    periodStart: { type: Date, required: true, index: true },
    periodEnd: { type: Date, required: true },
    activeCases: { type: Number, default: 0 },
    closedCases: { type: Number, default: 0 },
    overdueCases: { type: Number, default: 0 },
    reviewsCompleted: { type: Number, default: 0 },
    pendingReviews: { type: Number, default: 0 },
    averageReviewDays: { type: Number, default: 0 },
    lettersCompleted: { type: Number, default: 0 },
    pendingLetters: { type: Number, default: 0 },
    averageCompletionDays: { type: Number, default: 0 },
    metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
    score: { type: Number, default: 0 },
  },
  { timestamps: true }
);

staffPerformanceSchema.index({ staff: 1, periodStart: -1 });

module.exports = mongoose.model("StaffPerformance", staffPerformanceSchema);
