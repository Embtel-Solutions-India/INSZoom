#!/usr/bin/env node
// Switches OFF the three "case escalated" (SLA breach) e-mails the way an admin does in Settings > Email & Templates: a managed, active customization with
// sendEmail:false. Every server reads that switch from the database on every send (emailCustomization.service.findActive), so it takes effect at once on a server that is
// still running older code - no deploy. Each row carries the normal wording, so switching it back on later sends the standard e-mail, not a placeholder.
//
//   node scripts/pause-escalation-emails.js              dry run: shows what would be created / changed, writes nothing
//   node scripts/pause-escalation-emails.js --apply      switches the e-mails off
//   node scripts/pause-escalation-emails.js --resume --apply      switches them back on (sendEmail:true)
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

const KEYS = ["case.escalated:team_lead", "case.escalated:admin", "case.escalated:super_admin"];

async function main() {
  const apply = process.argv.includes("--apply");
  const resume = process.argv.includes("--resume");
  await mongoose.connect(process.env.MONGODB_URI);
  const EmailTemplate = require("../src/models/EmailTemplate");
  const customization = require("../src/modules/email/emailCustomization.service");
  const registry = require("../src/modules/email/emailVariables.registry");
  const triggers = require("../src/modules/email/emailTriggers.registry");
  const sendEmail = resume;

  for (const triggerKey of KEYS) {
    const existing = await EmailTemplate.findOne({ managed: true, status: "active", triggerKey }).sort({ updatedAt: -1 });
    if (existing) {
      console.log(`${triggerKey}: an active customization exists (sendEmail=${existing.sendEmail}) -> ${existing.sendEmail === sendEmail ? "already as wanted" : `set sendEmail=${sendEmail}`}`);
      if (apply && existing.sendEmail !== sendEmail) { existing.sendEmail = sendEmail; existing.version = (existing.version || 1) + 1; await existing.save(); console.log("   done"); }
      continue;
    }
    const defaults = customization.defaultContentFor(triggerKey, {});
    if (!defaults) throw new Error(`no default wording found for ${triggerKey}`);
    const trigger = triggers.getTrigger(triggerKey) || {};
    const row = {
      name: trigger.name || trigger.title || triggerKey, subject: defaults.subject, heading: defaults.heading || defaults.subject, body: defaults.body,
      description: "Switched off by the owner on 2026-11-11 (SLA-breach alerts were repeating). Switch it back on here when the alerts should resume.",
      category: "case", managed: true, status: "active", triggerKey, sendEmail,
      variables: registry.extractTokens([defaults.subject, defaults.heading, defaults.body].join("\n")), version: 1,
    };
    console.log(`${triggerKey}: no customization yet -> would create one (sendEmail=${sendEmail}) with the standard wording, subject "${row.subject}"`);
    if (apply) { await EmailTemplate.create(row); console.log("   created"); }
  }
  if (!apply) console.log("\nDRY RUN - nothing written. Add --apply.");
  else for (const triggerKey of KEYS) { const a = await customization.findActive(triggerKey); console.log(`check ${triggerKey}: active=${Boolean(a)} sendEmail=${a && a.sendEmail}`); }
}

main().then(() => mongoose.disconnect().then(() => process.exit(0))).catch((error) => { console.error("FAILED:", error.message); process.exit(1); });
