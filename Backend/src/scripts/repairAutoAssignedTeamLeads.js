#!/usr/bin/env node
// One-off repair: a team lead who was given cases by the old round robin (cases nobody named a team lead for) keeps being emailed about them.
// Rule (owner, repeatedly stated): a case belongs to the team lead who CREATED it; a case with no team lead creator belongs to the default team lead
// (DEFAULT_TEAM_LEAD_EMAIL = teamlead@immiglance.com). Nobody else is its team lead or hears about it.
//
//   node src/scripts/repairAutoAssignedTeamLeads.js --from madaan@bayareaimmigrationservices.com            dry run (default): lists every case and where it would go
//   node src/scripts/repairAutoAssignedTeamLeads.js --from madaan@bayareaimmigrationservices.com --apply    writes a backup file first, then moves the cases
//
// Per case whose assignedTeamLead is --from and that --from did NOT create:
//   created by an active team lead -> that creator; otherwise -> the default team lead. Only `assignedTeamLead` (and `teamId`, when the new team lead has one) change,
//   through the raw collection (no model hooks, no GoHighLevel sync, no notification). Idempotent: a second run finds nothing. Backup: Backend/backups/team-lead-repair-<time>.json
const fs = require("fs");
const path = require("path");

const idOf = (value) => String(value?._id || value || "");

/** Pure. Where does this case's team lead belong? { target: userDoc|null, why } */
function decideTarget({ caseDoc, fromId, usersById, defaultLead }) {
  const creator = caseDoc.createdBy ? usersById.get(idOf(caseDoc.createdBy)) : null;
  if (creator && idOf(creator) !== fromId && String(creator.role) === "team_lead" && creator.isActive !== false) return { target: creator, why: "created by this team lead" };
  if (defaultLead) return { target: defaultLead, why: "no team lead created it: the default team lead" };
  return { target: null, why: "no default team lead exists: left unchanged" };
}

async function main(argv) {
  const get = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const fromEmail = String(get("--from") || "").trim().toLowerCase();
  if (!fromEmail) { console.error("usage: --from <team lead email> [--apply]"); return 2; }
  const apply = argv.includes("--apply");
  const mongoose = require("mongoose");
  await require("../config/database")();
  const env = require("../config/env");
  const db = mongoose.connection.db;
  const users = db.collection("users");
  const cases = db.collection("cases");
  const from = await users.findOne({ email: fromEmail }, { projection: { email: 1, role: 1 } });
  if (!from) { console.error(`no user ${fromEmail}`); await mongoose.disconnect(); return 2; }
  const defaultLead = await users.findOne({ email: String(env.defaultTeamLeadEmail || "").toLowerCase(), role: "team_lead", isActive: { $ne: false } }, { projection: { email: 1, role: 1, isActive: 1, teamId: 1 } });
  const list = await cases.find({ assignedTeamLead: from._id }, { projection: { caseNumber: 1, createdBy: 1, assignedTeamLead: 1, teamId: 1, creationSource: 1 } }).toArray();
  const creatorIds = [...new Set(list.map((item) => idOf(item.createdBy)).filter(Boolean))].map((id) => new mongoose.Types.ObjectId(id));
  const creators = creatorIds.length ? await users.find({ _id: { $in: creatorIds } }, { projection: { email: 1, role: 1, isActive: 1, teamId: 1 } }).toArray() : [];
  const usersById = new Map(creators.map((user) => [idOf(user), user]));
  const plan = [];
  for (const caseDoc of list) {
    if (idOf(caseDoc.createdBy) === idOf(from)) continue; // he created it: it stays his
    const { target, why } = decideTarget({ caseDoc, fromId: idOf(from), usersById, defaultLead });
    plan.push({ caseId: idOf(caseDoc), caseNumber: caseDoc.caseNumber, source: caseDoc.creationSource || "", before: { assignedTeamLead: idOf(caseDoc.assignedTeamLead), teamId: caseDoc.teamId ? idOf(caseDoc.teamId) : null }, to: target ? { id: idOf(target), email: target.email, teamId: target.teamId ? idOf(target.teamId) : null } : null, why });
  }
  const summary = {};
  plan.forEach((item) => { const key = `${item.to ? item.to.email : "UNCHANGED"} (${item.why})`; summary[key] = (summary[key] || 0) + 1; });
  console.log(`${list.length} case(s) have ${fromEmail} as team lead; ${plan.length} were not created by them.`);
  console.log(JSON.stringify(summary, null, 2));
  if (!apply) { console.log("DRY RUN - nothing written. Re-run with --apply to move them."); await mongoose.disconnect(); return 0; }
  const movable = plan.filter((item) => item.to);
  const dir = path.resolve(__dirname, "..", "..", "backups");
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `team-lead-repair-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify({ at: new Date().toISOString(), from: fromEmail, cases: movable }, null, 1));
  let moved = 0;
  for (const item of movable) {
    const set = { assignedTeamLead: new mongoose.Types.ObjectId(item.to.id) };
    if (item.to.teamId) set.teamId = new mongoose.Types.ObjectId(item.to.teamId);
    const result = await cases.updateOne({ _id: new mongoose.Types.ObjectId(item.caseId), assignedTeamLead: from._id }, { $set: set });
    moved += result.modifiedCount;
  }
  console.log(`APPLIED: ${moved} case(s) moved. Backup: ${backup}`);
  await mongoose.disconnect();
  return 0;
}

module.exports = { decideTarget };

if (require.main === module) main(process.argv.slice(2)).then((code) => process.exit(code)).catch((error) => { console.error("failed:", error.message); process.exit(1); });
