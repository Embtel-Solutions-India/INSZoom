// node src/scripts/applyPartyFieldMappings.js I-129 I-907 I-539 G-28 [--apply]
// Wires every beneficiary / petitioner field of the named forms to the generic canonical paths (see form-mapping/services/PartyFieldMappingService).
// Dry run by default: prints what would change; --apply saves a new mapping version per form (activated when it validates).
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
      const result = await PartyFieldMappingService.apply(template, actor, { ip: "script", headers: {} }, { dryRun: !apply });
      console.log(JSON.stringify({ ...result, unmatchedCandidates: (result.unmatchedCandidates || []).slice(0, 25) }, null, 1));
    }
  })
  .then(() => mongoose.disconnect())
  .then(() => process.exit(0))
  .catch((error) => { console.error("Failed:", error.stack || error.message); process.exit(1); });
