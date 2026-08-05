const mongoose = require("mongoose");

const authSessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    refreshTokenHash: { type: String, required: true, unique: true, select: false },
    userAgent: String,
    ipAddress: String,
    expiresAt: { type: Date, required: true, index: true },
    revokedAt: Date,
    replacedBy: { type: mongoose.Schema.Types.ObjectId, ref: "AuthSession" },
  },
  { timestamps: true }
);

authSessionSchema.index({ user: 1, revokedAt: 1 });

module.exports = mongoose.model("AuthSession", authSessionSchema);
