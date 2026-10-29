const mongoose = require("mongoose");

// One team member's own Google Drive connection (each user connects their own account). The refresh token is only ever stored
// encrypted (utils/secretBox).
const googleDriveConnectionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    status: { type: String, enum: ["connected", "reconnect_required", "disconnected"], default: "connected" },
    googleAccountId: String,
    googleEmail: String,
    scopes: [String],
    refreshTokenEnc: { type: String, select: false },
    connectedAt: Date,
    lastSuccessfulSyncAt: Date,
    lastError: { code: String, message: String, at: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.models.GoogleDriveConnection || mongoose.model("GoogleDriveConnection", googleDriveConnectionSchema);
