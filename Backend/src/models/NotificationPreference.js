const mongoose = require("mongoose");
const { CATEGORIES, CHANNELS, NOTIFICATION_TYPES } = require("../modules/notifications/notification.constants");

const channelPreferenceSchema = new mongoose.Schema(
  {
    channel: { type: String, enum: CHANNELS, required: true },
    enabled: { type: Boolean, default: true },
  },
  { _id: false }
);

const notificationPreferenceSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
    globalEnabled: { type: Boolean, default: true },
    mutedUntil: Date,
    quietHours: {
      enabled: { type: Boolean, default: false },
      timezone: { type: String, default: "UTC" },
      start: String,
      end: String,
    },
    channels: [channelPreferenceSchema],
    categories: [
      {
        category: { type: String, enum: CATEGORIES },
        enabled: { type: Boolean, default: true },
        channels: [channelPreferenceSchema],
      },
    ],
    types: [
      {
        type: { type: String, enum: NOTIFICATION_TYPES },
        enabled: { type: Boolean, default: true },
        channels: [channelPreferenceSchema],
      },
    ],
    digest: {
      enabled: { type: Boolean, default: false },
      frequency: { type: String, enum: ["daily", "weekly"], default: "daily" },
      nextRunAt: Date,
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("NotificationPreference", notificationPreferenceSchema);
