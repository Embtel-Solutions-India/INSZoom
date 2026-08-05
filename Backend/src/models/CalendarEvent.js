const mongoose = require("mongoose");

const calendarEventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, index: true },
    description: String,
    eventType: {
      type: String,
      enum: ["holiday", "uscis_deadline", "case_deadline", "task_deadline", "payment_due", "availability_block", "external_event", "custom"],
      default: "custom",
      index: true,
    },
    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true, index: true },
    timezone: { type: String, default: "UTC" },
    allDay: { type: Boolean, default: false },
    visibility: { type: String, enum: ["private", "team", "company", "public"], default: "team", index: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", index: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", index: true },
    beneficiaryId: { type: mongoose.Schema.Types.ObjectId, ref: "Beneficiary", index: true },
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", index: true },
    source: { type: String, enum: ["manual", "appointment", "workflow", "uscis", "holiday_feed", "google", "outlook", "system"], default: "manual", index: true },
    externalProvider: { type: String, enum: ["google", "outlook", "zoom", "teams", "none"], default: "none" },
    externalEventId: String,
    metadata: mongoose.Schema.Types.Mixed,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    deletedAt: Date,
  },
  { timestamps: true }
);

calendarEventSchema.index({ startAt: 1, endAt: 1, eventType: 1 });
calendarEventSchema.index({ ownerId: 1, startAt: 1 });

module.exports = mongoose.model("CalendarEvent", calendarEventSchema);
