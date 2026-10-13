// node src/scripts/upgradeFormEditions.js [I-129 I-485 ...]   - upgrades the named forms (default: every tracked form), one at a time.
require("dotenv").config();
const mongoose = require("mongoose");
const env = require("../config/env");
const User = require("../models/User");
const { upgradeTrackedForms } = require("../modules/uscis-form-import/services/FormEditionUpgradeService");

mongoose
  .connect(env.mongoUri)
  .then(async () => {
    const actor = await User.findOne({ role: { $in: ["super_admin", "admin"] } }).sort({ createdAt: 1 });
    const summary = await upgradeTrackedForms({ user: actor || { role: "super_admin" }, formCodes: process.argv.slice(2).map((code) => code.toUpperCase()) });
    console.log(JSON.stringify({ checked: summary.checked, upgraded: summary.upgraded, pending: summary.pending }, null, 2));
  })
  .then(() => mongoose.disconnect())
  .then(() => process.exit(0))
  .catch((error) => { console.error("Upgrade failed:", error.message); process.exit(1); });
