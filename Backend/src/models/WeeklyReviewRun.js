const mongoose = require("mongoose");

// One document per weekly review reminder (the week it was sent for; weekKey = that Saturday's IST date). `notified` records every person who has had it.
const weeklyReviewRunSchema = new mongoose.Schema(
  {
    weekKey: { type: String, required: true, unique: true }, // IST date of that Saturday, YYYY-MM-DD
    sentAt: { type: Date, default: Date.now },
    // everyone who already got this week's reminder: each person is added atomically BEFORE they are notified, so nobody is notified twice
    notified: [{ type: mongoose.Schema.Types.ObjectId }],
    recipients: { type: Number, default: 0 },
    failures: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("WeeklyReviewRun", weeklyReviewRunSchema);
