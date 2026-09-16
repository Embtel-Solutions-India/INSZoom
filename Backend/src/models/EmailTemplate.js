const mongoose = require("mongoose");

// §5.6.2/5.6.3 Settings → Email & Templates. isSystem templates are the
// transactional emails the app sends automatically (seeded once, see
// scripts/seedSystemEmailTemplates.js) — their body is locked; only
// subject/signature may be edited on them (enforced in the controller, not
// here, since a schema-level lock can't distinguish "which field changed").
const emailTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    category: { type: String, enum: ["case", "client", "invoice", "general", "system"], default: "general" },
    isSystem: { type: Boolean, default: false },
    systemKey: { type: String, default: null, index: true, sparse: true },
    tags: { type: [String], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("EmailTemplate", emailTemplateSchema);
