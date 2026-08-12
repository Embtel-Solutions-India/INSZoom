/**
 * Verify production users that were provisioned in MongoDB.
 *
 * This script deliberately does not contain user names, email addresses, or
 * passwords. It never creates, updates, or resets an account. Existing
 * passwords remain in MongoDB as bcrypt hashes created by User#save().
 *
 * Usage from Backend/:
 *   $env.PRODUCTION_USER_EMAILS = "user@example.com,admin@example.com"
 *   node src/scripts/bootstrap_production_users.js
 */
const mongoose = require("mongoose");
const User = require("../models/User");
const env = require("../config/env");

const emails = String(process.env.PRODUCTION_USER_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

async function run() {
  if (!emails.length) {
    throw new Error("Set PRODUCTION_USER_EMAILS to the existing MongoDB account emails before running this verifier.");
  }

  await mongoose.connect(env.mongoUri);
  const users = await User.find({ email: { $in: emails } }).select("+password email role isActive");
  const found = new Map(users.map((user) => [user.email, user]));
  const missing = emails.filter((email) => !found.has(email));
  const invalidPasswordHashes = users
    .filter((user) => !/^\$2[aby]?\$\d{2}\$/.test(user.password || ""))
    .map((user) => user.email);

  if (missing.length || invalidPasswordHashes.length) {
    const details = [];
    if (missing.length) details.push(`missing accounts: ${missing.join(", ")}`);
    if (invalidPasswordHashes.length) details.push(`accounts without bcrypt password hashes: ${invalidPasswordHashes.join(", ")}`);
    throw new Error(details.join("; "));
  }

  users.forEach((user) => {
    console.log(`Verified ${user.email} [${user.role}] active=${Boolean(user.isActive)} password=bcrypt`);
  });
}

run()
  .then(() => mongoose.disconnect())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error("Production user verification failed:", error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
