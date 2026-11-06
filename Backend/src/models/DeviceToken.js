const mongoose = require("mongoose");

const deviceTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    token: { type: String, required: true, unique: true, trim: true },
    browser: String,
    platform: String,
    // Browser origin the token was registered from (admin./attorney./client. portal) - routes a push to the right app.
    origin: String,
    active: { type: Boolean, default: true },
    lastUsedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("DeviceToken", deviceTokenSchema);
