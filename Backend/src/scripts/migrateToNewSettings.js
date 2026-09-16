// "Settings Overhaul" migration: moves values that were written under the
// now-deleted organization.registry.js/branding.registry.js keys (from the
// first migration pass, migrateSettingsToEngine.js) into their new firm.*
// homes. Snapshots first, per the "no destructive migration without a
// backup" rule. security.session.idleTimeoutMinutes / security.password.*
// / data.retention.* / roles.permissionOverrides / notifications.events.*
// / ai.budget.* / modules.*.enabled / workflow.sla.* are ALL left exactly
// as they are — those keys still exist in their original registry files
// (security.registry.js, data.registry.js, users.registry.js, etc.) and
// have live runtime consumers; renaming them for cosmetic consistency with
// no frontend yet consuming the new names would be pure regression risk
// for zero benefit (see the completion report for the full reasoning).
require("dotenv").config();
const mongoose = require("mongoose");
const SettingValue = require("../models/SettingValue");
const settingsEngine = require("../modules/settings/settingsEngine.service");

const KEY_MAP = [
  ["org.timezone", "firm.timezone"],
  ["org.dateFormat", "firm.dateFormat"],
  ["branding.primaryColor", "firm.primaryColor"],
  ["branding.firmAddress", "firm.address.line1"],
  ["branding.firmPhone", "firm.phone"],
  ["branding.companyName", "firm.name"],
  ["branding.logoUrl", "firm.logo"],
];

// Keys that pointed at now-deleted registry files and have no new-structure
// equivalent at all (never had a runtime consumer either — confirmed
// before discarding, same standard as everything else in this pass).
const DISCARDED_NO_EQUIVALENT = ["org.locale", "org.numberFormat", "org.fiscalYearStart", "org.businessHours", "branding.emailFromName", "branding.emailFromAddress", "branding.portalCustomDomain", "integrations.apiKeys.enabled", "integrations.webhooks.enabled"];

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to Mongo.");

  const allValues = await SettingValue.find({}).lean();
  await mongoose.connection.collection("settingsMigrationSnapshot_v2").insertOne({
    takenAt: new Date(),
    preMigrationSettingValues: allValues,
  });
  console.log(`Snapshot of ${allValues.length} SettingValue docs written to settingsMigrationSnapshot_v2.`);

  const systemActor = { _id: null, role: "super_admin" };
  let migrated = 0;
  let discarded = 0;
  let skipped = 0;

  for (const [oldKey, newKey] of KEY_MAP) {
    const oldDoc = allValues.find((v) => v.key === oldKey && v.scope === "system");
    if (!oldDoc) {
      skipped += 1;
      continue;
    }
    try {
      await settingsEngine.set(newKey, "system", null, oldDoc.value, systemActor, null, { reason: `Settings Overhaul migration from ${oldKey}` });
      migrated += 1;
      console.log(`  migrated ${oldKey} -> ${newKey} =`, oldDoc.value);
    } catch (error) {
      console.error(`  FAILED migrating ${oldKey} -> ${newKey}:`, error.message);
    }
  }

  for (const oldKey of DISCARDED_NO_EQUIVALENT) {
    const result = await SettingValue.deleteMany({ key: oldKey });
    if (result.deletedCount) {
      discarded += result.deletedCount;
      console.log(`  discarded ${result.deletedCount} doc(s) for orphaned key ${oldKey} (no new-structure equivalent, no runtime consumer)`);
    }
  }

  console.log(`Migration complete: ${migrated} keys migrated, ${discarded} orphaned docs discarded, ${skipped} old keys had no value to migrate.`);
  console.log("Untouched (still live under their original keys): security.session.idleTimeoutMinutes, security.password.*, security.maxLoginAttempts, security.lockoutDurationMinutes, data.retention.*, roles.permissionOverrides, notifications.events.*, ai.budget.*, modules.*.enabled, workflow.sla.*, workflow.assignmentStrategy.");
  await mongoose.disconnect();
}

run().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
