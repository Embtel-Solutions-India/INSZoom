const mongoose = require("mongoose");

const calendarIntegrationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    provider: { type: String, enum: ["google", "outlook", "zoom", "teams"], required: true, index: true },
    accountEmail: { type: String, lowercase: true, trim: true },
    externalCalendarId: String,
    accessTokenEncrypted: String,
    refreshTokenEncrypted: String,
    scopes: [String],
    syncEnabled: { type: Boolean, default: false },
    syncDirection: { type: String, enum: ["one_way_push", "one_way_pull", "two_way"], default: "one_way_push" },
    syncStatus: { type: String, enum: ["not_connected", "connected", "syncing", "synced", "failed"], default: "not_connected", index: true },
    lastSyncedAt: Date,
    lastSyncError: String,
    webhookChannelId: String,
    webhookExpiresAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

calendarIntegrationSchema.index({ userId: 1, provider: 1 }, { unique: true });

module.exports = mongoose.model("CalendarIntegration", calendarIntegrationSchema);
