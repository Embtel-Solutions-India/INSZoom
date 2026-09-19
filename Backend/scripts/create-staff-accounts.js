/**
 * One-off: create the requested INSZoom staff accounts. Uses User.create()
 * so the model's own pre-save hook hashes each password with bcrypt.
 *
 * SECURITY: never hardcode a plaintext password in this file (a prior
 * version did exactly that and its 5 real passwords ended up committed to
 * git and flagged by GitHub secret scanning). Every password below is
 * generated fresh at runtime with crypto.randomBytes and printed to stdout
 * ONCE — it is never written to disk or persisted anywhere except as the
 * bcrypt hash the pre-save hook produces. Relay each printed password to
 * its recipient out-of-band (never email/Slack in plaintext) and have them
 * change it immediately after first login. Idempotent: skips any email
 * that already exists rather than erroring (an existing account's password
 * is never touched).
 *
 * Run: node Backend/scripts/create-staff-accounts.js
 */
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const crypto = require("crypto");
const mongoose = require("mongoose");
const User = require("../src/models/User");

const STAFF = [
  { name: "Super Admin", email: "superadmin@immiglance.com", role: "super_admin" },
  { name: "Admin User", email: "admin@immiglance.com", role: "admin" },
  { name: "David Team Lead", email: "teamlead@immiglance.com", role: "team_lead" },
  { name: "John Case Manager", email: "casemanager@immiglance.com", role: "case_manager" },
  { name: "Second Case Manager", email: "casemanager2@immiglance.com", role: "case_manager" },
];

function generatePassword() {
  return crypto.randomBytes(18).toString("base64url");
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected\n");

  for (const person of STAFF) {
    const existing = await User.findOne({ email: person.email });
    if (existing) {
      console.log(`SKIP (already exists): ${person.email}`);
      continue;
    }
    const password = generatePassword();
    const user = await User.create({
      name: person.name,
      displayName: person.name,
      email: person.email,
      password,
      role: person.role,
      isActive: true,
      isEmailVerified: true,
      mustSetPassword: false,
    });
    console.log(`CREATED: ${person.email} | role: ${user.role} | _id: ${user._id} | temporary password: ${password}`);
  }

  console.log("\nRelay each temporary password above securely (never email/Slack in plaintext) and have the recipient change it immediately after first login.");
  await mongoose.disconnect();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
