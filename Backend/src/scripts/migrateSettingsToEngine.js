// One-time migration: copies the existing Settings singleton's live values
// into the new settings-engine (SettingValue, system scope) so the new
// enterprise settings UI reflects real current values instead of registry
// defaults. Does NOT touch or remove the old Settings document — every
// existing consumer of it (entityConfigService, lead.service, quiz.service,
// consultation.service, etc.) keeps working exactly as before; this is a
// read-and-copy, additive only.
//
// Safety: snapshots the current Settings document (and any pre-existing
// SettingValue docs this would overwrite) into a `settingsMigrationSnapshot`
// collection before writing anything, per the "no destructive migration
// without a backup step" rule.
//
// Run: node src/scripts/migrateSettingsToEngine.js
require("dotenv").config();
const mongoose = require("mongoose");
const Settings = require("../models/Settings");
const SettingValue = require("../models/SettingValue");
const settingsEngine = require("../modules/settings/settingsEngine.service");

// [oldField, newKey, transform?] — transform receives the old value and
// returns the new value, or `undefined` to skip that field (e.g. no
// semantically-equivalent new key exists yet).
const FIELD_MAP = [
  ["companyName", "branding.companyName"],
  ["companyLogo", "branding.logoUrl"],
  ["firmAddress", "branding.firmAddress"],
  ["firmPhone", "branding.firmPhone"],
  ["primaryColor", "branding.primaryColor"],
  ["timezone", "org.timezone"],
  ["dateFormat", "org.dateFormat"],
  ["assignmentStrategy", "workflow.assignmentStrategy", (v) => (v === "least_loaded" ? "load_balanced" : v)],
  ["autoAssignAttorneys", "workflow.autoAssign.enabled"],
  ["slaIntakeMaxDays", "workflow.sla.intakeMaxDays"],
  ["requireTwoFactor", "security.mfa.required"],
  ["passwordMinLength", "security.password.minLength"],
  ["passwordRequireUppercase", "security.password.requireUpper"],
  ["passwordRequireNumbers", "security.password.requireNumber"],
  ["passwordRequireSpecialChars", "security.password.requireSymbol"],
  ["auditLogRetentionDays", "data.retention.auditLogDays"],
  ["sessionTimeout", "security.session.idleTimeoutMinutes", (v) => Math.min(1440, Math.max(1, Math.round((v || 1800) / 60)))],
  ["notifyOnNewCase", "notifications.events.new_client_submission.channels", (v) => (v ? ["in_app", "email"] : [])],
  ["notifyOnPayment", "notifications.events.payment_received.channels", (v) => (v ? ["in_app", "email"] : [])],
  ["notifyOnPaymentOverdue", "notifications.events.payment_overdue.channels", (v) => (v ? ["in_app", "email"] : [])],
  ["notifyOnRfeReceived", "notifications.events.rfe_received.channels", (v) => (v ? ["in_app", "email"] : [])],
  ["notifyOnDocumentUpload", "notifications.events.document_uploaded.channels", (v) => (v ? ["in_app", "email"] : [])],
  ["notifyOnEODReport", "notifications.events.eod_report.channels", (v) => (v ? ["in_app", "email"] : [])],
];

// Fields intentionally NOT migrated (documented, not silently dropped —
// the old Settings document keeps them regardless): maxLoginAttempts and
// jwtExpiry have no semantically-equivalent new key yet (jwtExpiry is a
// long-lived legacy value; the new security.jwt.accessTtlMinutes is a
// short-lived access-token TTL with different intent, not a unit
// conversion); slaAttorneyReviewMaxDays has no new equivalent key.

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to Mongo.");

  const oldSettings = await Settings.findOne({ key: "global" }).lean();
  if (!oldSettings) {
    console.log("No existing Settings document found — nothing to migrate.");
    await mongoose.disconnect();
    return;
  }

  // Snapshot step (backup before any write).
  const existingEngineValues = await SettingValue.find({ scope: "system" }).lean();
  await mongoose.connection.collection("settingsMigrationSnapshot").insertOne({
    takenAt: new Date(),
    oldSettingsDocument: oldSettings,
    preMigrationSettingValues: existingEngineValues,
  });
  console.log("Snapshot written to settingsMigrationSnapshot collection.");

  const systemActor = { _id: null, role: "super_admin" };
  let migrated = 0;
  let skipped = 0;

  for (const [oldField, newKey, transform] of FIELD_MAP) {
    if (!(oldField in oldSettings) || oldSettings[oldField] === undefined) {
      skipped += 1;
      continue;
    }
    const rawValue = oldSettings[oldField];
    const value = transform ? transform(rawValue) : rawValue;
    try {
      await settingsEngine.set(newKey, "system", null, value, systemActor, null, {
        reason: `Migrated from Settings.${oldField}`,
        action: "set",
      });
      migrated += 1;
      console.log(`  migrated ${oldField} -> ${newKey} =`, value);
    } catch (error) {
      console.error(`  FAILED migrating ${oldField} -> ${newKey}:`, error.message);
    }
  }

  console.log(`Migration complete: ${migrated} keys migrated, ${skipped} fields absent/skipped.`);
  await mongoose.disconnect();
}

run().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
