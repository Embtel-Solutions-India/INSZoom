// node src/scripts/runCatalogSync.js [--apply] [--only I-589,I-912] [--max 15]
// Runs the same catalog sync the 12-hour job runs. Without --apply it is a read-only dry run that lists what would be imported.
require("dotenv").config();
const mongoose = require("mongoose");
const env = require("../config/env");
const User = require("../models/User");
const { runCatalogSync } = require("../modules/uscis-form-import/services/FormCatalogSyncService");

const args = process.argv.slice(2);
const value = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };

(async () => {
  await mongoose.connect(env.mongoUri);
  const user = (await User.findOne({ role: { $in: ["super_admin", "admin"] } }).sort({ createdAt: 1 })) || { role: "super_admin" };
  const result = await runCatalogSync({ user, dryRun: !args.includes("--apply"), only: value("--only")?.split(",").map((code) => code.trim().toUpperCase()), maxFormsPerRun: value("--max") });
  console.log(JSON.stringify(result, null, 1));
  await mongoose.disconnect();
})().catch((error) => { console.error("Failed:", error.stack || error.message); process.exit(1); });
