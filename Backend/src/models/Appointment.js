const mongoose = require("mongoose");

const STATUS_VALUES = ["pending", "scheduled", "confirmed", "contacted", "completed", "cancelled", "no_show", "rescheduled"];
const TYPE_VALUES = ["consultation", "initial_consultation", "follow_up_consultation", "case_review_consultation", "emergency_consultation", "case_review", "document_review", "interview_prep", "biometrics", "uscis_interview", "payment", "deadline_review", "client_check_in", "internal_meeting", "general"];
const LOCATION_TYPES = ["video", "phone", "office", "external", "other"];
const REMINDER_CHANNELS = ["in_app", "email", "sms", "push", "socket"];

const attendeeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    name: String,
    email: String,
    role: String,
    responseStatus: {
      type: String,
      enum: ["pending", "accepted", "declined", "tentative"],
      default: "pending",
    },
  },
  { _id: true }
);

const reminderSchema = new mongoose.Schema(
  {
    remindAt: Date,
    minutesBefore: Number,
    channel: { type: String, enum: REMINDER_CHANNELS, default: "in_app" },
    sent: { type: Boolean, default: false },
    sentAt: Date,
  },
  { _id: true }
);

const calendarSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ["internal", "google", "outlook", "zoom", "teams", "other"], default: "internal" },
    externalCalendarId: String,
    externalEventId: String,
    htmlLink: String,
    syncStatus: { type: String, enum: ["not_synced", "synced", "failed"], default: "not_synced" },
    lastSyncedAt: Date,
    syncError: String,
  },
  { _id: false }
);

const recurrenceSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    frequency: { type: String, enum: ["daily", "weekly", "monthly", "yearly"] },
    interval: { type: Number, default: 1 },
    count: Number,
    until: Date,
    daysOfWeek: [Number],
    parentAppointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment" },
    seriesId: { type: String, index: true },
  },
  { _id: false }
);

const auditHistorySchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    performedAt: { type: Date, default: Date.now },
    changes: mongoose.Schema.Types.Mixed,
    ipAddress: String,
    userAgent: String,
  },
  { _id: true }
);

const appointmentSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    email: { type: String, lowercase: true, trim: true },
    phone: String,
    visaType: String,
    message: String,
    notes: String,

    title: { type: String, default: "Appointment" },
    description: String,
    type: { type: String, enum: TYPE_VALUES, default: "consultation", index: true },
    status: { type: String, enum: STATUS_VALUES, default: "pending", index: true },
    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium" },

    startAt: { type: Date, index: true },
    endAt: { type: Date, index: true },
    timezone: { type: String, default: "UTC" },
    durationMinutes: { type: Number, default: 30 },

    locationType: { type: String, enum: LOCATION_TYPES, default: "phone" },
    location: String,
    meetingUrl: String,
    meetingProvider: { type: String, enum: ["manual", "zoom", "google_meet", "teams", "phone", "in_person"], default: "manual" },
    meetingProviderMetadata: mongoose.Schema.Types.Mixed,

    linkedUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", index: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    caseManagerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", index: true },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: "Team", index: true },
    resourceIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "CalendarResource", index: true }],
    attendees: [attendeeSchema],

    reminders: [reminderSchema],
    calendar: calendarSchema,
    recurrence: recurrenceSchema,

    cancellationReason: String,
    cancelledAt: Date,
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    rescheduledFrom: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment" },
    rescheduledTo: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment" },
    selfScheduled: { type: Boolean, default: false, index: true },
    confirmationRequired: { type: Boolean, default: false },
    // Internal-only priority label copied from the originating quiz Lead's
    // tier (Phase 1 free-consultation booking) — never shown to the
    // prospect; purely a staff-facing triage signal alongside `priority`.
    leadTier: { type: String, enum: ["A", "B", "C", "D", null], default: null },
    aiSuggestionMetadata: mongoose.Schema.Types.Mixed,
    publicBooking: { type: Boolean, default: false, index: true },
    legacySource: { type: String, enum: ["BAIS", "INSZoom", "shared", ""], default: "shared" },
    auditHistory: [auditHistorySchema],
  },
  { timestamps: true }
);

appointmentSchema.pre("validate", function syncCompatibilityFields(next) {
  if (!this.title) this.title = this.type ? `${this.type.replace(/_/g, " ")} appointment` : "Appointment";
  if (this.linkedUser && !this.clientId) this.clientId = this.linkedUser;
  if (this.clientId && !this.linkedUser) this.linkedUser = this.clientId;
  if (this.startAt && !this.endAt && this.durationMinutes) {
    this.endAt = new Date(this.startAt.getTime() + this.durationMinutes * 60 * 1000);
  }
  if (this.startAt && this.endAt) {
    this.durationMinutes = Math.max(1, Math.round((this.endAt.getTime() - this.startAt.getTime()) / 60000));
  }
  next();
});

appointmentSchema.index({ assignedTo: 1, startAt: 1, endAt: 1 });
appointmentSchema.index({ caseManagerId: 1, startAt: 1 });
appointmentSchema.index({ linkedUser: 1, createdAt: -1 });
appointmentSchema.index({ caseId: 1, startAt: 1 });
appointmentSchema.index({ status: 1, startAt: 1 });
appointmentSchema.index({ "reminders.remindAt": 1, "reminders.sent": 1 });
appointmentSchema.index({ resourceIds: 1, startAt: 1, endAt: 1 });
appointmentSchema.index({ "calendar.provider": 1, "calendar.syncStatus": 1 });

appointmentSchema.statics.statuses = STATUS_VALUES;
appointmentSchema.statics.types = TYPE_VALUES;

module.exports = mongoose.model("Appointment", appointmentSchema);
