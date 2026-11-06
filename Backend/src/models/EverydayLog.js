const mongoose = require("mongoose");

// One person's "Everyday plan" (today's goals) and "Everyday report" (today's achievements) for one work day. `workDate` is the IST date the work day STARTS
// on (the day runs 21:00 IST -> 21:00 IST next day, see everyday.service.js). The dismiss / push stamps make the reminders strictly once per person per day.
const everydayLogSchema = new mongoose.Schema(
  {
    staff: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    workDate: { type: String, required: true }, // "YYYY-MM-DD"
    planItems: { type: [String], default: [] },
    reportItems: { type: [String], default: [] },
    planUpdatedAt: Date,
    reportUpdatedAt: Date,
    planPromptDismissedAt: Date,
    reportPromptDismissedAt: Date,
    planPushSentAt: Date,
    reportPushSentAt: Date,
  },
  { timestamps: true }
);

everydayLogSchema.index({ staff: 1, workDate: 1 }, { unique: true });
everydayLogSchema.index({ workDate: -1 });

module.exports = mongoose.models.EverydayLog || mongoose.model("EverydayLog", everydayLogSchema);
