#!/usr/bin/env node
// Removes the family visa types IR-1, IR-2, IR-3, IR-4, IR-5, CR-1, CR-2, F2A, F2B, F3 and F4 from the DATABASE, matching their removal from the code (owner request 2026-11-12):
//   * their checklist templates (i130 petitioner + beneficiary, green card, i864, gc_nvc per type) with every question, all versions;
//   * their VisaFormMapping rows (which forms / checklists a case of that type gets), all versions;
//   * the I-130 petition package definition (it only served IR-1 / CR-1).
// NOT touched: F1, K-1, K-3, I-824, the student F-1 / F-2 types, and every other checklist / mapping.
//
// Safe by construction:
//   * a dry run by default - nothing is written without --apply;
//   * it REFUSES to apply while any case still uses one of these visa types (a case needs its checklist);
//   * it only deletes checklist templates that no answer and no case refers to.
// The code no longer defines these checklists, so they are not re-created on restart (a server still running the OLD code will re-create them until it is updated).
//   node scripts/remove-family-visas.js            dry run
//   node scripts/remove-family-visas.js --apply    delete
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

const TYPES = ["IR-1", "IR-2", "IR-3", "IR-4", "IR-5", "CR-1", "CR-2", "F2A", "F2B", "F3", "F4"];
const slug = (visaType) => visaType.toLowerCase().replace(/[^a-z0-9]+/g, "");
const CHECKLIST_KEYS = TYPES.flatMap((type) => [
  `i130_${slug(type)}_petitioner_checklist`,
  `i130_${slug(type)}_beneficiary_checklist`,
  `green_card_${slug(type)}_beneficiary_checklist`,
  `i864_${slug(type)}_petitioner_checklist`,
  `gc_nvc_${slug(type)}_beneficiary_checklist`,
]);

async function main() {
  const apply = process.argv.includes("--apply");
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const typeMatch = { $in: [...TYPES, ...TYPES.map((t) => t.toLowerCase()), ...TYPES.map(slug)] };

  const cases = await db.collection("cases").countDocuments({ $or: [{ visaType: typeMatch }, { visaCategory: typeMatch }, { petitionType: typeMatch }] });
  const questionnaires = await db.collection("questionnaires").find({ key: { $in: CHECKLIST_KEYS } }).project({ _id: 1, key: 1, version: 1 }).toArray();
  const ids = questionnaires.map((q) => q._id);
  const questions = await db.collection("questions").countDocuments({ questionnaire: { $in: ids } });
  const answers = ids.length ? await db.collection("answers").countDocuments({ questionnaire: { $in: ids } }) : 0;
  const mappings = await db.collection("visaformmappings").countDocuments({ visaType: typeMatch });
  const packages = await db.collection("packagedefinitions").find({ $or: [{ visaType: typeMatch }, { visaTypes: { $in: TYPES } }] }).project({ key: 1, visaType: 1, visaTypes: 1 }).toArray();
  const distinctKeys = [...new Set(questionnaires.map((q) => q.key))];

  console.log(`family visa types to remove: ${TYPES.join(", ")}`);
  console.log(`cases that still use one of them : ${cases}${cases ? "  <- the script will NOT apply while this is above 0" : ""}`);
  console.log(`checklist templates              : ${distinctKeys.length} checklists (${questionnaires.length} versions), ${questions} questions, answers referring to them: ${answers}`);
  console.log(`form-mapping rows (VisaFormMapping): ${mappings}`);
  console.log(`package definitions              : ${packages.map((p) => `${p.key} (${[p.visaType, ...(p.visaTypes || [])].filter(Boolean).join("/")})`).join(", ") || "none"}`);
  if (!apply) { console.log("\nDRY RUN - nothing written. Add --apply to delete."); return; }
  if (cases) throw new Error(`${cases} case(s) still use one of these visa types; nothing was deleted`);
  if (answers) throw new Error(`${answers} answer(s) refer to these checklists; nothing was deleted`);

  const q = await db.collection("questions").deleteMany({ questionnaire: { $in: ids } });
  const t = await db.collection("questionnaires").deleteMany({ _id: { $in: ids } });
  const m = await db.collection("visaformmappings").deleteMany({ visaType: typeMatch });
  const pk = await db.collection("packagedefinitions").deleteMany({ _id: { $in: packages.map((p) => p._id) } });
  console.log(`\nDELETED: ${t.deletedCount} checklist template versions, ${q.deletedCount} questions, ${m.deletedCount} form-mapping rows, ${pk.deletedCount} package definition(s)`);
  const left = await db.collection("questionnaires").countDocuments({ key: { $in: CHECKLIST_KEYS } });
  console.log(`check: ${left} of the removed checklists remain`);
}

main().then(() => mongoose.disconnect().then(() => process.exit(0))).catch((error) => { console.error("FAILED:", error.message); process.exit(1); });
