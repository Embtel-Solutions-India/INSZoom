const mongoose = require("mongoose");

const timeWindowSchema = new mongoose.Schema(
  {
    dayOfWeek: { type: Number, min: 0, max: 6, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    timezone: { type: String, default: "UTC" },
  },
  { _id: true }
);

const blackoutSchema = new mongoose.Schema(
  {
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    reason: String,
  },
  { _id: true }
);

const calendarAvailabilitySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
    timezone: { type: String, default: "UTC" },
    slotDurationMinutes: { type: Number, default: 30 },
    bufferBeforeMinutes: { type: Number, default: 0 },
    bufferAfterMinutes: { type: Number, default: 0 },
    workingHours: [timeWindowSchema],
    blackouts: [blackoutSchema],
    maxAppointmentsPerDay: Number,
    selfSchedulingEnabled: { type: Boolean, default: false },
    meetingLocationPreferences: {
      allowVideo: { type: Boolean, default: true },
      allowPhone: { type: Boolean, default: true },
      allowOffice: { type: Boolean, default: true },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CalendarAvailability", calendarAvailabilitySchema);
