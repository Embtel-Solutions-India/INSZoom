const mongoose = require("mongoose");

// A weekly star rating (1-5) with an optional review, given to a case manager by an admin / team lead / super admin.
// One rating per (case manager, week, rater): rating again in the same week replaces the earlier one.
// `weekStart` is the Monday 00:00 (server time) of the week being rated.
const caseManagerRatingSchema = new mongoose.Schema(
  {
    caseManager: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    ratedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    ratedByRole: { type: String, default: "" },
    weekStart: { type: Date, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    review: { type: String, trim: true, maxlength: 2000, default: "" },
  },
  { timestamps: true }
);

caseManagerRatingSchema.index({ caseManager: 1, weekStart: -1 });
caseManagerRatingSchema.index({ caseManager: 1, weekStart: 1, ratedBy: 1 }, { unique: true });

module.exports = mongoose.model("CaseManagerRating", caseManagerRatingSchema);
