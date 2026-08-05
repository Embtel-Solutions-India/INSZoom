const mongoose = require("mongoose");

// Records every acceptance of the non-attorney disclaimer, anonymous or
// authenticated. Append-only, like AuditLog — an acceptance record is never
// edited or deleted once written; it exists to prove what was shown and when.
const disclaimerAcceptanceSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    sessionId: { type: String, default: "", index: true },
    disclaimerVersion: { type: Number, required: true },
    context: { type: String, required: true, index: true }, // "public_quiz" | "client_portal" | "ad_template" | ...
    ipAddress: String,
    userAgent: String,
    acceptedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

disclaimerAcceptanceSchema.index({ context: 1, acceptedAt: -1 });

module.exports = mongoose.model("DisclaimerAcceptance", disclaimerAcceptanceSchema);
