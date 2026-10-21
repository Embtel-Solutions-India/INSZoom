// node src/scripts/applyUnlockedMirrors.js I-485 I-130 I-129F [--apply]
// Boxes USCIS marks read-only are now fillable. Where such a box is a COPY of a box the form already maps to a canonical path (the A-Number or the name
// repeated on every continuation page), it gets the same edge. Only these copies are added: no other rule of the form is applied, nothing existing is
// changed or removed. Dry run by default; --apply saves a new mapping version per form (activated when it validates).
require("dotenv").config();
const mongoose = require("mongoose");
const env = require("../config/env");
const User = require("../models/User");
const USCISFormTemplate = require("../models/USCISFormTemplate");
const PartyFieldMappingService = require("../modules/form-mapping/services/PartyFieldMappingService");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const codes = args.filter((arg) => !arg.startsWith("--")).map((code) => code.toUpperCase());

mongoose
  .connect(env.mongoUri)
  .then(async () => {
    const actor = (await User.findOne({ role: { $in: ["super_admin", "admin"] } }).sort({ createdAt: 1 })) || { role: "super_admin" };
    for (const code of codes) {
      const template = await USCISFormTemplate.findOne({ formCode: code, status: "active" }).sort({ editionDate: -1 });
      if (!template) { console.log(code, "no active template"); continue; }
      const result = await PartyFieldMappingService.apply(template, actor, { ip: "script", headers: {} }, { dryRun: !apply, mirrorsOnly: true });
      console.log(JSON.stringify({ formCode: code, mirrored: result.mirrored || 0, created: result.created, rewired: result.rewired, removed: result.removed || 0, saved: result.saved, activated: result.activated, skipped: result.skipped, error: result.error, validation: result.validation }));
    }
  })
  .then(() => mongoose.disconnect())
  .then(() => process.exit(0))
  .catch((error) => { console.error("Failed:", error.stack || error.message); process.exit(1); });
