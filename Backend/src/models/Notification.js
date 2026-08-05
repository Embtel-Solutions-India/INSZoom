const mongoose = require("mongoose");
const { CATEGORIES, CHANNELS, DELIVERY_STATUSES, NOTIFICATION_TYPES, PRIORITIES } = require("../modules/notifications/notification.constants");

const deliverySchema = new mongoose.Schema(
  {
    channel: { type: String, enum: CHANNELS, default: "in_app" },
    status: { type: String, enum: DELIVERY_STATUSES, default: "pending" },
    sentAt: Date,
    error: String,
    providerMessageId: String,
    attempts: { type: Number, default: 0 },
    nextRetryAt: Date,
  },
  { _id: true }
);

const notificationAuditSchema = new mongoose.Schema(
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

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    recipientRole: { type: String, index: true },
    recipientRoles: [{ type: String, index: true }],
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", index: true },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: "Team", index: true },

    type: { type: String, enum: NOTIFICATION_TYPES, default: "general", index: true },
    category: { type: String, enum: CATEGORIES, default: "general", index: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    priority: { type: String, enum: PRIORITIES, default: "medium", index: true },
    link: String,
    metadata: mongoose.Schema.Types.Mixed,
    eventName: { type: String, index: true },
    eventId: { type: String, index: true },
    dedupeKey: { type: String, index: true },
    templateKey: { type: String, index: true },
    clientVisible: { type: Boolean, default: true, index: true },
    internalOnly: { type: Boolean, default: false, index: true },

    case: { type: mongoose.Schema.Types.ObjectId, ref: "Case", index: true },
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", index: true },
    participantId: { type: mongoose.Schema.Types.ObjectId, index: true },
    participantRole: { type: String, index: true },
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", index: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document", index: true },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", index: true },
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", index: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", index: true },
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message", index: true },

    read: { type: Boolean, default: false, index: true },
    isRead: { type: Boolean, default: false, index: true },
    readAt: Date,
    archived: { type: Boolean, default: false, index: true },
    archivedAt: Date,
    pinned: { type: Boolean, default: false, index: true },
    pinnedAt: Date,
    snoozedUntil: { type: Date, index: true },
    deletedAt: Date,
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    channels: { type: [String], enum: CHANNELS, default: ["in_app"] },
    delivery: [deliverySchema],
    deliveredAt: Date,
    scheduledFor: { type: Date, index: true },
    queuedAt: Date,
    processedAt: Date,
    retryCount: { type: Number, default: 0 },
    maxRetries: { type: Number, default: 3 },
    queueStatus: { type: String, enum: ["none", "scheduled", "queued", "processing", "processed", "failed"], default: "none", index: true },
    expiresAt: Date,

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    source: { type: String, enum: ["BAIS", "INSZoom", "shared", "system", "workflow", ""], default: "shared" },
    auditHistory: [notificationAuditSchema],
  },
  { timestamps: true }
);

notificationSchema.pre("validate", function syncCompatibilityFields(next) {
  if (this.user && !this.userId) this.userId = this.user;
  if (this.userId && !this.user) this.user = this.userId;
  if (this.case && !this.caseId) this.caseId = this.case;
  if (this.caseId && !this.case) this.case = this.caseId;
  if (this.read !== undefined && this.isRead !== this.read) this.isRead = this.read;
  if (this.isRead !== undefined && this.read !== this.isRead) this.read = this.isRead;
  if ((this.read || this.isRead) && !this.readAt) this.readAt = new Date();
  if (!this.delivery?.length && this.channels?.length) {
    this.delivery = this.channels.map((channel) => ({ channel, status: channel === "in_app" ? "sent" : "pending", sentAt: channel === "in_app" ? new Date() : undefined }));
  }
  next();
});

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ user: 1, read: 1, createdAt: -1 });
notificationSchema.index({ recipientRole: 1, createdAt: -1 });
notificationSchema.index({ caseId: 1, createdAt: -1 });
notificationSchema.index({ caseId: 1, participantId: 1, createdAt: -1 });
notificationSchema.index({ participantId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ taskId: 1, createdAt: -1 });
notificationSchema.index({ type: 1, priority: 1, createdAt: -1 });
notificationSchema.index({ category: 1, createdAt: -1 });
notificationSchema.index({ scheduledFor: 1, queueStatus: 1 });
notificationSchema.index({ title: "text", message: "text", "metadata.summary": "text" });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });

notificationSchema.statics.types = NOTIFICATION_TYPES;
notificationSchema.statics.priorities = PRIORITIES;
notificationSchema.statics.channels = CHANNELS;

module.exports = mongoose.model("Notification", notificationSchema);
