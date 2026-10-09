const mongoose = require("mongoose");

// GHL contact -> employer matter (the principal case). One employer has MANY
// GHL opportunities (one per employee) that all share the same GHL contact, so
// this link is how a new opportunity finds its existing employer, independent of
// the employer's email (which can change). Unique per (location, contact).
//
// Lives in its own collection because the cases collection is at MongoDB's
// 64-index limit (see GHLCaseLink.js).
const ghlEmployerLinkSchema = new mongoose.Schema(
  {
    locationId: { type: String, required: true },
    contactId: { type: String, required: true },
    principalCaseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", required: true },
  },
  { timestamps: true }
);

ghlEmployerLinkSchema.index({ locationId: 1, contactId: 1 }, { unique: true });
ghlEmployerLinkSchema.index({ principalCaseId: 1 });

module.exports = mongoose.model("GHLEmployerLink", ghlEmployerLinkSchema);
