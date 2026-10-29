const mongoose = require("mongoose");

// One Google Drive account a team member has connected. A user can connect several accounts; exactly one is `active` (the one the
// "Add to Drive" dialog uses) and they can switch between them. The refresh token is only ever stored encrypted (utils/secretBox).
// A connection stays until the user removes it or Google itself revokes it; transient errors never discard it.
const googleDriveConnectionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    active: { type: Boolean, default: false },
    status: { type: String, enum: ["connected", "reconnect_required", "disconnected"], default: "connected" },
    googleAccountId: { type: String, required: true },
    googleEmail: String,
    scopes: [String],
    refreshTokenEnc: { type: String, select: false },
    connectedAt: Date,
    lastSuccessfulSyncAt: Date,
    lastError: { code: String, message: String, at: Date },
  },
  { timestamps: true }
);

googleDriveConnectionSchema.index({ userId: 1, googleAccountId: 1 }, { unique: true });
googleDriveConnectionSchema.index({ userId: 1, active: 1 });

module.exports = mongoose.models.GoogleDriveConnection || mongoose.model("GoogleDriveConnection", googleDriveConnectionSchema);
