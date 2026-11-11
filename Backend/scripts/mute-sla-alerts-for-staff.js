#!/usr/bin/env node
// Mutes the SLA-breach alert type (workflow_sla_breached) for every active internal staff member through the per-user notification preference - the mechanism EVERY server
// already obeys (notification.service.js: a muted type removes the browser push and the e-mail for that person). It is stored in the shared database, so a production server
// that is still running older code stops sending them at once, no deploy. Nothing else about a person's notifications changes (a preference record created here mutes only this type).
//
// Limits (until this branch is deployed): an alert addressed to a ROLE (not a person) still shows in the bell / live pop-up, and a staff account created later has no mute yet - run this
// script again for it. The code pause in notification.service.js (NOTIFICATIONS_PAUSED_TYPES) removes both once deployed.
//
//   node scripts/mute-sla-alerts-for-staff.js                  dry run
//   node scripts/mute-sla-alerts-for-staff.js --apply          mute
//   node scripts/mute-sla-alerts-for-staff.js --resume --apply remove the mute again
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

const TYPE = "workflow_sla_breached";
const ROLES = ["super_admin", "admin", "team_lead", "case_manager"];

async function main() {
  const apply = process.argv.includes("--apply");
  const resume = process.argv.includes("--resume");
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require("../src/models/User");
  const Preference = require("../src/models/NotificationPreference");
  const staff = await User.find({ role: { $in: ROLES }, isActive: { $ne: false } }).select("_id role email").lean();
  let created = 0, changed = 0, already = 0;
  for (const user of staff) {
    const preference = await Preference.findOne({ userId: user._id });
    const entry = preference?.types?.find((item) => item.type === TYPE);
    if (resume) {
      if (!entry) { already += 1; continue; }
      changed += 1;
      if (apply) { preference.types = preference.types.filter((item) => item.type !== TYPE); await preference.save(); }
      continue;
    }
    if (!preference) {
      created += 1;
      if (apply) await Preference.create({ userId: user._id, types: [{ type: TYPE, enabled: false }] });
    } else if (entry && entry.enabled === false) {
      already += 1;
    } else {
      changed += 1;
      if (apply) { if (entry) entry.enabled = false; else preference.types.push({ type: TYPE, enabled: false }); await preference.save(); }
    }
  }
  console.log(`${resume ? "unmute" : "mute"} ${TYPE} for ${staff.length} active staff (${ROLES.join(", ")}): new records ${created}, updated ${changed}, already as wanted ${already}`);
  if (!apply) { console.log("DRY RUN - nothing written. Add --apply."); return; }
  const muted = await Preference.countDocuments({ userId: { $in: staff.map((u) => u._id) }, types: { $elemMatch: { type: TYPE, enabled: false } } });
  console.log(`check: ${muted} of ${staff.length} staff now mute ${TYPE}`);
}

main().then(() => mongoose.disconnect().then(() => process.exit(0))).catch((error) => { console.error("FAILED:", error.message); process.exit(1); });
