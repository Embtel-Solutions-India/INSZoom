const mongoose = require("mongoose");

const participantSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: String,
    joinedAt: { type: Date, default: Date.now },
    lastReadAt: Date,
    unreadCount: { type: Number, default: 0 },
    mutedUntil: Date,
    archivedAt: Date,
    typingAt: Date,
  },
  { _id: false }
);

const conversationAuditSchema = new mongoose.Schema(
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

const conversationSchema = new mongoose.Schema(
  {
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", index: true },
    clientPortalId: { type: String, index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    caseManagerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", index: true },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: "Team", index: true },
    participants: [participantSchema],
    subject: { type: String, default: "Conversation" },
    type: { type: String, enum: ["case", "direct", "internal", "support", "shared_inbox", "email"], default: "case", index: true },
    status: { type: String, enum: ["open", "pending", "snoozed", "closed", "archived"], default: "open", index: true },
    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium", index: true },
    category: { type: String, default: "general", index: true },
    labels: [{ type: String, index: true }],
    inbox: { type: String, enum: ["client", "internal", "shared", "support"], default: "shared", index: true },
    assignedOwnerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    assignedTeam: { type: mongoose.Schema.Types.ObjectId, ref: "Team", index: true },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    lastMessagePreview: String,
    unreadClient: { type: Number, default: 0 },
    unreadManager: { type: Number, default: 0 },
    isClosed: { type: Boolean, default: false, index: true },
    closedAt: Date,
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    snoozedUntil: Date,
    archivedAt: Date,
    externalThreadId: String,
    channel: { type: String, enum: ["in_app", "email", "gmail", "outlook", "sms", "whatsapp", "api"], default: "in_app", index: true },
    emailIntegration: {
      provider: { type: String, enum: ["none", "gmail", "outlook", "imap", "smtp"], default: "none" },
      mailbox: String,
      threadId: String,
      syncStatus: { type: String, enum: ["not_synced", "pending", "synced", "failed"], default: "not_synced" },
      lastSyncedAt: Date,
      error: String,
    },
    sharedInbox: {
      enabled: { type: Boolean, default: false },
      queue: String,
      firstResponseDueAt: Date,
      resolutionDueAt: Date,
      firstRespondedAt: Date,
      resolvedAt: Date,
    },
    analytics: {
      messageCount: { type: Number, default: 0 },
      internalNoteCount: { type: Number, default: 0 },
      attachmentCount: { type: Number, default: 0 },
      firstResponseSeconds: Number,
      resolutionSeconds: Number,
      lastInboundAt: Date,
      lastOutboundAt: Date,
    },
    spam: {
      score: { type: Number, default: 0 },
      flagged: { type: Boolean, default: false, index: true },
      reason: String,
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      reviewedAt: Date,
    },
    deletedAt: Date,
    legacySource: { type: String, enum: ["BAIS", "INSZoom", "shared", ""], default: "shared" },
    auditHistory: [conversationAuditSchema],
  },
  { timestamps: true }
);

conversationSchema.index({ caseId: 1, type: 1 });
conversationSchema.index({ "participants.user": 1, lastMessageAt: -1 });
conversationSchema.index({ clientId: 1, lastMessageAt: -1 });
conversationSchema.index({ receiverId: 1, lastMessageAt: -1 });
conversationSchema.index({ assignedTo: 1, status: 1, priority: 1 });
conversationSchema.index({ inbox: 1, status: 1, lastMessageAt: -1 });
conversationSchema.index({ labels: 1, lastMessageAt: -1 });

module.exports = mongoose.model("Conversation", conversationSchema);
