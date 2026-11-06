const mongoose = require("mongoose");

// What an internal team member did on a work day, for the EOD board's four numbers. One row per (person, work day, kind, thing): opening the same case ten times is ONE
// case worked, chatting with the same person ten times is ONE message person. `day` is the work-day key (see everyday.service.js workDateOf).
const staffActivitySchema = new mongoose.Schema(
  {
    staff: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    day: { type: String, required: true },
    kind: { type: String, enum: ["case", "closed", "document", "message"], required: true },
    ref: { type: String, required: true },
    at: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

staffActivitySchema.index({ staff: 1, day: 1, kind: 1, ref: 1 }, { unique: true });
staffActivitySchema.index({ day: 1 });

module.exports = mongoose.models.StaffActivity || mongoose.model("StaffActivity", staffActivitySchema);
