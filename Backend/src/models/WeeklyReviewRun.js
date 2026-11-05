const mongoose = require("mongoose");

// One document per Friday review reminder (the week it was sent for). The unique weekKey is the claim: the first process to insert it sends the
// e-mails, every other tick or instance (and a restart on the same day) hits the duplicate key and sends nothing - so nobody gets it twice.
const weeklyReviewRunSchema = new mongoose.Schema(
  {
    weekKey: { type: String, required: true, unique: true }, // IST date of that Friday, YYYY-MM-DD
    sentAt: { type: Date, default: Date.now },
    recipients: { type: Number, default: 0 },
    failures: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("WeeklyReviewRun", weeklyReviewRunSchema);
