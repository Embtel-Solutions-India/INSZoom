// One reviewer's answer for one golden-set entry (plan Phase 2 deliverable): "Right", "Wrong" (with what it should be) or "Not sure". The entry itself lives in the
// committed draft file; `contentHash` ties the answer to the exact wording that was reviewed, so an entry that is later reworded needs a fresh answer.
const mongoose = require("mongoose");

const goldenSetReviewSchema = new mongoose.Schema(
  {
    entryId: { type: String, required: true, unique: true, index: true },
    contentHash: { type: String, required: true },
    formCode: { type: String, required: true, index: true },
    verdict: { type: String, enum: ["right", "wrong", "unsure", "blank"], required: true },
    reason: { type: String, default: "", maxlength: 2000 }, // why it is wrong (required for "wrong")
    correction: { type: String, default: "", maxlength: 2000 }, // what the box should be filled with instead
    shouldBeBlank: { type: Boolean, default: false }, // the box should be left empty (no information stored in it)
    note: { type: String, default: "", maxlength: 2000 },
    reviewerEmail: { type: String, required: true },
    reviewer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.models.GoldenSetReview || mongoose.model("GoldenSetReview", goldenSetReviewSchema);
