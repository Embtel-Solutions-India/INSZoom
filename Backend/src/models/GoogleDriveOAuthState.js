const mongoose = require("mongoose");

// One row per "Connect Google Drive" attempt. Only a hash of the state value is stored; the PKCE verifier is stored encrypted.
// Single use, expires after 10 minutes.
const googleDriveOAuthStateSchema = new mongoose.Schema({
  stateHash: { type: String, required: true, unique: true },
  orgId: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  codeVerifierEnc: String,
  returnPath: String,
  usedAt: Date,
  createdAt: { type: Date, default: Date.now, expires: 600 },
});

module.exports = mongoose.models.GoogleDriveOAuthState || mongoose.model("GoogleDriveOAuthState", googleDriveOAuthStateSchema);
