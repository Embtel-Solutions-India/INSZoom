/**
 * Bootstrap Production Users — IDEMPOTENT
 * Run: node src/scripts/bootstrap_production_users.js  (from Backend/)
 *
 * - Skips any email that already exists in the DB (never overwrites)
 * - isDemoData: false — these are real users, not demo data
 * - Password is passed as plaintext — User model's pre-save bcrypt hook
 *   (env.bcryptRounds) hashes it. Do NOT manually hash — that causes
 *   double-hashing and login will always fail.
 */
const mongoose = require("mongoose");
const User = require("../models/User");
const env = require("../config/env");

const USERS = [
  // ── INSZoom CRM — super_admin ─────────────────────────────
  { name: "Alka", displayName: "Alka", email: "alka@bayareaimmigrationservices.com", password: "Alka@bais786", role: "super_admin", department: "Management", isEmailVerified: true, isActive: true, isDemoData: false },
  // ── INSZoom CRM — admin ───────────────────────────────────
  { name: "Kritagya", displayName: "Kritagya", email: "kritagya@bayareaimmigrationservices.com", password: "Kritagya@675", role: "admin", department: "Operations", isEmailVerified: true, isActive: true, isDemoData: false },
  { name: "Rahul", displayName: "Rahul", email: "rahul@bayareaimmigrationservices.com", password: "Rahul@bais586", role: "admin", department: "Operations", isEmailVerified: true, isActive: true, isDemoData: false },
  // ── INSZoom CRM — team_lead ───────────────────────────────
  { name: "Akash", displayName: "Akash", email: "akash@bayareaimmigrationservices.com", password: "Akash@bais223", role: "team_lead", department: "Case Management", isEmailVerified: true, isActive: true, isDemoData: false },
  // ── INSZoom CRM — case_manager ────────────────────────────
  { name: "Vasu", displayName: "Vasu", email: "vasu@bayareaimmigrationservices.com", password: "Vasu@bais567", role: "case_manager", department: "Case Management", isEmailVerified: true, isActive: true, isDemoData: false },
  { name: "Saksham", displayName: "Saksham", email: "saksham@bayareaimmigrationservices.com", password: "Saksham@bais987", role: "case_manager", department: "Case Management", isEmailVerified: true, isActive: true, isDemoData: false },
  { name: "Bhavya", displayName: "Bhavya", email: "madaan@bayareaimmigrationservices.com", password: "Madaan@bais123", role: "team_lead", department: "Case Management", isEmailVerified: true, isActive: true, isDemoData: false },
];

async function run() {
  await mongoose.connect(env.mongoUri);
  console.log("Connected:", env.mongoUri.replace(/:\/\/([^:]+):[^@]+@/, "://$1:****@"));
  for (const u of USERS) {
    const existing = await User.findOne({ email: u.email.toLowerCase() });
    if (existing) {
      console.log(`  SKIP    — ${u.email} [${existing.role}]`);
      continue;
    }
    const doc = new User(u); // new + save so the pre-save bcrypt hook fires
    await doc.save();
    console.log(`  CREATED — ${u.email} [${u.role}]`);
  }
  console.log("Done.");
}

run()
  .then(() => mongoose.disconnect())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error("Bootstrap failed:", error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
