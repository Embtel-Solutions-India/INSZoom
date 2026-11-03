const mongoose = require("mongoose");

// The editable part of the rules a petition is checked against (Petition AI Review). One record (key "default").
// The fixed company rules (not a law firm, Immiglance-only branding, no promised outcome) live in code (petition-ai-review/rules.js) and are
// always applied; this record only ADDS: the correct FedEx / filing addresses and any extra rules the team writes.
const addressSchema = new mongoose.Schema(
  {
    label: { type: String, default: "", trim: true, maxlength: 200 }, // e.g. "USCIS Dallas Lockbox (FedEx)"
    address: { type: String, required: true, trim: true, maxlength: 1000 }, // the full address as it must appear
  },
  { _id: false }
);

const petitionAiRulesSchema = new mongoose.Schema(
  {
    key: { type: String, default: "default", unique: true },
    expectedAddresses: { type: [addressSchema], default: [] },
    extraRules: { type: [{ type: String, trim: true, maxlength: 1000 }], default: [] },
    version: { type: Number, default: 1, min: 1 }, // bumped on every edit; stored on each scan (rulesVersion)
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.models.PetitionAiRules || mongoose.model("PetitionAiRules", petitionAiRulesSchema);
