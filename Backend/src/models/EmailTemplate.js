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
    category: { type: String, default: "general", trim: true },
    isSystem: { type: Boolean, default: false },
    systemKey: { type: String, default: null, index: true, sparse: true },
    tags: { type: [String], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // ── Email Template Customization (admin page) ────────────────────────
    // `managed` rows are the ones created/edited through that page; the
    // older catalog rows above (managed:false) are untouched by it.
    managed: { type: Boolean, default: false, index: true },
    description: { type: String, default: "" },
    heading: { type: String, default: "" },
    // draft = never sent; active = overrides the built-in email for
    // `triggerKey`; inactive/archived = ignored (built-in email is sent).
    status: { type: String, enum: ["draft", "active", "inactive", "archived"], default: "draft", index: true },
    // The existing sendTemplateEmail() key this template replaces/extends
    // (see modules/email/emailTriggers.registry.js). Null for a draft that
    // is not attached to anything yet.
    triggerKey: { type: String, default: null, index: true },
    // Role-based rules, resolved from the live case at send time - never
    // resolved addresses. type: client|case_manager|team_lead|attorney|admin|
    // super_admin|company_contact|custom (custom carries `value`).
    recipients: {
      to: { type: [{ _id: false, type: { type: String }, value: String }], default: [] },
      cc: { type: [{ _id: false, type: { type: String }, value: String }], default: [] },
      bcc: { type: [{ _id: false, type: { type: String }, value: String }], default: [] },
    },
    variables: { type: [String], default: [] },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    version: { type: Number, default: 1 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("EmailTemplate", emailTemplateSchema);
