const mongoose = require("mongoose");

// One line of an attorney's PERSONAL timeline on a case: what this attorney did (opened it, read the petition, gave feedback, completed the review) or was asked to do
// (a petition was sent to them). Private to the attorney: it is never shown to the client, and the staff case timeline (Case.timeline) is a different, separate record.
const attorneyCaseEventSchema = new mongoose.Schema(
  {
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", required: true },
    attorneyId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, required: true, enum: ["case_opened", "petition_received", "petition_viewed", "feedback_sent", "review_completed", "review_reopened"] },
    title: { type: String, required: true, maxlength: 200 },
    description: { type: String, default: "", maxlength: 500 },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

attorneyCaseEventSchema.index({ attorneyId: 1, caseId: 1, createdAt: -1 });

module.exports = mongoose.model("AttorneyCaseEvent", attorneyCaseEventSchema);
