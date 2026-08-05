const mongoose = require("mongoose");

const attachmentSchema = new mongoose.Schema(
  {
    originalName: String,
    storedName: String,
    fileName: String,
    fileUrl: String,
    fileSize: Number,
    size: Number,
    mimeType: String,
    storageProvider: { type: String, default: "local" },
    storageKey: String,
    checksum: String,
  },
  { _id: true }
);

const readReceiptSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    readAt: { type: Date, default: Date.now },
    deliveredAt: Date,
  },
  { _id: false }
);

const reactionSchema = new mongoose.Schema(
  {
    emoji: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const mentionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    role: String,
    text: String,
  },
  { _id: false }
);

const messageAuditSchema = new mongoose.Schema(
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

const messageSchema = new mongoose.Schema(
  {
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", index: true },
    threadId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", index: true },
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", index: true },
    clientPortalId: { type: String, index: true },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sender: { type: String, enum: ["client", "employer", "employee", "case_manager", "team_lead", "admin", "super_admin", "finance", "system"], default: "system" },
    senderRole: { type: String },
    senderName: String,
    senderEmail: String,
    message: String,
    messageBody: String,
    normalizedBody: String,
    attachments: [attachmentSchema],
    attachmentPreviews: [
      {
        attachmentId: mongoose.Schema.Types.ObjectId,
        previewUrl: String,
        thumbnailUrl: String,
        textPreview: String,
        generatedAt: Date,
      },
    ],
    isInternal: { type: Boolean, default: false, index: true },
    isInternalNote: { type: Boolean, default: false, index: true },
    noteType: { type: String, enum: ["none", "internal", "client"], default: "none", index: true },
    isRead: { type: Boolean, default: false, index: true },
    deliveryStatus: { type: String, enum: ["draft", "queued", "sent", "delivered", "read", "failed"], default: "sent", index: true },
    deliveredAt: Date,
    failedAt: Date,
    failureReason: String,
    readBy: [readReceiptSchema],
    readByUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
    mentions: [mentionSchema],
    reactions: [reactionSchema],
    labels: [{ type: String, index: true }],
    category: { type: String, default: "general", index: true },
    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium", index: true },
    channel: { type: String, enum: ["in_app", "email", "gmail", "outlook", "sms", "whatsapp", "api"], default: "in_app", index: true },
    direction: { type: String, enum: ["inbound", "outbound", "internal"], default: "outbound", index: true },
    email: {
      provider: { type: String, enum: ["none", "gmail", "outlook", "imap", "smtp"], default: "none" },
      messageId: String,
      threadId: String,
      from: String,
      to: [String],
      cc: [String],
      bcc: [String],
      subject: String,
      syncStatus: { type: String, enum: ["not_synced", "pending", "synced", "failed"], default: "not_synced" },
      lastSyncedAt: Date,
    },
    translation: {
      sourceLanguage: String,
      targetLanguage: String,
      translatedBody: String,
      provider: String,
      translatedAt: Date,
    },
    ai: {
      suggestedReplies: [String],
      summary: String,
      sentiment: String,
      generatedAt: Date,
      provider: String,
    },
    spam: {
      score: { type: Number, default: 0 },
      flagged: { type: Boolean, default: false, index: true },
      reason: String,
    },
    secureShare: {
      enabled: { type: Boolean, default: false },
      expiresAt: Date,
      accessTokenHash: String,
      downloadCount: { type: Number, default: 0 },
    },
    editedAt: Date,
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    pinnedAt: Date,
    pinnedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    deletedAt: Date,
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    legacySource: { type: String, enum: ["BAIS", "INSZoom", "shared", ""], default: "shared" },
    auditHistory: [messageAuditSchema],
  },
  { timestamps: true }
);

messageSchema.pre("validate", function syncCompatibilityFields(next) {
  if (this.conversationId && !this.threadId) this.threadId = this.conversationId;
  if (this.threadId && !this.conversationId) this.conversationId = this.threadId;
  if (this.messageBody && !this.message) this.message = this.messageBody;
  if (this.message && !this.messageBody) this.messageBody = this.message;
  if (this.isInternal !== undefined && this.isInternalNote !== this.isInternal) this.isInternalNote = this.isInternal;
  if (this.isInternalNote !== undefined && this.isInternal !== this.isInternalNote) this.isInternal = this.isInternalNote;
  if (!this.senderRole && this.sender) this.senderRole = this.sender;
  if (!this.sender && this.senderRole) this.sender = this.senderRole === "admin" ? "case_manager" : this.senderRole;
  if (this.messageBody && !this.normalizedBody) this.normalizedBody = this.messageBody.toLowerCase();
  if (this.isInternal || this.isInternalNote) {
    this.direction = "internal";
    if (this.noteType === "none") this.noteType = "internal";
  }
  next();
});

messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index({ threadId: 1, createdAt: 1 });
messageSchema.index({ caseId: 1, createdAt: -1 });
messageSchema.index({ receiverId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1, createdAt: -1 });
messageSchema.index({ clientPortalId: 1, createdAt: -1 });
messageSchema.index({ normalizedBody: "text", senderName: "text", senderEmail: "text", labels: "text" });
messageSchema.index({ conversationId: 1, deliveryStatus: 1, createdAt: -1 });
messageSchema.index({ "mentions.userId": 1, createdAt: -1 });
messageSchema.index({ channel: 1, direction: 1, createdAt: -1 });

module.exports = mongoose.model("Message", messageSchema);
