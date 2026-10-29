const mongoose = require("mongoose");

// The organisation's Google Drive connection. orgId is "default" today (one shared firm account); it exists so a per-organisation
// connection later needs no schema change. The refresh token is only ever stored encrypted (utils/secretBox).
const googleDriveConnectionSchema = new mongoose.Schema(
  {
    orgId: { type: String, required: true, unique: true },
    status: { type: String, enum: ["connected", "reconnect_required", "disconnected"], default: "connected" },
    googleAccountId: String,
    googleEmail: String,
    scopes: [String],
    refreshTokenEnc: { type: String, select: false },
    connectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    connectedAt: Date,
    lastSuccessfulSyncAt: Date,
    lastError: { code: String, message: String, at: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.models.GoogleDriveConnection || mongoose.model("GoogleDriveConnection", googleDriveConnectionSchema);
