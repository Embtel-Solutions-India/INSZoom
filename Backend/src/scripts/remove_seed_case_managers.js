/**
 * One-time script: removes the two seeded demo case manager accounts.
 * Safe to run multiple times (if already deleted, logs SKIP).
 *
 * Run: node src/scripts/remove_seed_case_managers.js  (from Backend/)
 */
const mongoose = require("mongoose");
const User = require("../models/User");
const env = require("../config/env");

const SEED_EMAILS = ["casemanager@inszoom.com", "casemanager2@inszoom.com"];

async function run() {
  await mongoose.connect(env.mongoUri);
  console.log("Connected:", env.mongoUri.replace(/:\/\/([^:]+):[^@]+@/, "://$1:****@"));

  for (const email of SEED_EMAILS) {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      console.log(`  SKIP    — not found: ${email}`);
      continue;
    }
    if (!user.isDemoData) {
      // Safety guard: never delete real production users from this script.
      console.log(`  SKIP    — isDemoData=false, leaving in place: ${email}`);
      continue;
    }
    await User.deleteOne({ _id: user._id });
    console.log(`  DELETED — ${email}`);
  }

  console.log("Done.");
}

run()
  .then(() => mongoose.disconnect())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error("Failed:", error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
