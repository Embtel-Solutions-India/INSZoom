const mongoose = require("mongoose");

const referralSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true, index: true },
    referrer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    referredUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    discountPercent: { type: Number, default: 10 },
    status: { type: String, enum: ["pending", "rewarded"], default: "pending", index: true },
    rewardedAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model("Referral", referralSchema);
