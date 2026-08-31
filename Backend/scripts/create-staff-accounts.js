/**
 * One-off: create the requested INSZoom staff accounts. Uses User.create()
 * so the model's own pre-save hook hashes each password with bcrypt - the
 * plaintext password is never written anywhere, only the hash. Idempotent:
 * skips any email that already exists rather than erroring.
 *
 * Run: node Backend/scripts/create-staff-accounts.js
 */
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const mongoose = require("mongoose");
const User = require("../src/models/User");

const STAFF = [
  { name: "Super Admin", email: "superadmin@immigratia.com", password: "SuperAdmin123", role: "super_admin" },
  { name: "Admin User", email: "admin@immigratia.com", password: "Admin123", role: "admin" },
  { name: "David Team Lead", email: "teamlead@immigratia.com", password: "TeamLead123", role: "team_lead" },
  { name: "John Case Manager", email: "casemanager@immigratia.com", password: "CaseManager123", role: "case_manager" },
  { name: "Second Case Manager", email: "casemanager2@immigratia.com", password: "CaseManager123", role: "case_manager" },
];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected\n");

  for (const person of STAFF) {
    const existing = await User.findOne({ email: person.email });
    if (existing) {
      console.log(`SKIP (already exists): ${person.email}`);
      continue;
    }
    const user = await User.create({
      name: person.name,
      displayName: person.name,
      email: person.email,
      password: person.password,
      role: person.role,
      isActive: true,
      isEmailVerified: true,
      mustSetPassword: false,
    });
    console.log(`CREATED: ${person.email} | role: ${user.role} | _id: ${user._id}`);
  }

  await mongoose.disconnect();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
