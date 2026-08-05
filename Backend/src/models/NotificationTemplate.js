const mongoose = require("mongoose");
const { CATEGORIES, CHANNELS, NOTIFICATION_TYPES, PRIORITIES } = require("../modules/notifications/notification.constants");

const notificationTemplateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: String,
    type: { type: String, enum: NOTIFICATION_TYPES, default: "general", index: true },
    category: { type: String, enum: CATEGORIES, default: "general", index: true },
    priority: { type: String, enum: PRIORITIES, default: "medium" },
    channels: { type: [String], enum: CHANNELS, default: ["in_app", "socket"] },
    titleTemplate: { type: String, required: true },
    messageTemplate: { type: String, required: true },
    linkTemplate: String,
    visibility: {
      roles: [{ type: String }],
      clientVisible: { type: Boolean, default: true },
      internalOnly: { type: Boolean, default: false },
    },
    variables: [{ type: String }],
    active: { type: Boolean, default: true, index: true },
    usageCount: { type: Number, default: 0 },
    lastUsedAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    archivedAt: Date,
  },
  { timestamps: true }
);

notificationTemplateSchema.index({ category: 1, type: 1, active: 1 });

module.exports = mongoose.model("NotificationTemplate", notificationTemplateSchema);
