const mongoose = require("mongoose");

const calendarResourceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    type: { type: String, enum: ["meeting_room", "phone_line", "video_bridge", "equipment", "staff_pool", "other"], default: "meeting_room", index: true },
    description: String,
    location: String,
    capacity: Number,
    timezone: { type: String, default: "UTC" },
    active: { type: Boolean, default: true, index: true },
    bookingRules: {
      minDurationMinutes: { type: Number, default: 15 },
      maxDurationMinutes: Number,
      requiresApproval: { type: Boolean, default: false },
      allowedRoles: [String],
    },
    integrations: {
      googleResourceId: String,
      outlookResourceEmail: String,
      zoomUserId: String,
      teamsRoomEmail: String,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

calendarResourceSchema.index({ type: 1, active: 1 });

module.exports = mongoose.model("CalendarResource", calendarResourceSchema);
