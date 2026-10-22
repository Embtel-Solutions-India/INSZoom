#!/usr/bin/env node
// After the golden set draft is rebuilt from the live mappings, decides which of the reviewer's EXISTING answers still hold.
//
//   node src/scripts/carryOverGoldenReviews.js --old <old draft json>            # DRY RUN (default): lists what would be carried over and what needs the reviewer
//   node src/scripts/carryOverGoldenReviews.js --old <old draft json> --apply    # re-stamps the carried answers with the new entry's hash
//
// An answer is carried over ONLY when the entry still says the same thing apart from where the data is stored: the same box in the same place, the same kind of box, the
// same format, the same condition (an old condition kept as one of two alternatives still counts), and the data source either unchanged or the same question moved from its
// private key (raw.questionnaireAnswers.<key>.value) to its generic path (petitioner.* / beneficiary.*), the old key kept as the fallback. Anything else - another fact in the
// box, a changed format or condition, a box the old draft did not have - is left WITHOUT an answer so the reviewer decides. Nothing is ever answered on the reviewer's behalf:
// a carried answer keeps its verdict, its reason, its reviewer and its date, and records `carriedOver` (what it was carried from, when, why). The sign-off is not touched: it
// stays out of date until the reviewer has answered what is left and signs again.
const fs = require("fs");

const REASON = "Only the place the data is read from changed (the same question moved to its generic petitioner / beneficiary path); the box, the data, the format and the condition are the same.";

/** Pure. Why a changed entry cannot simply keep its answer - an empty list means it can. */
function reasonsToReview(old, next, genericPathFor) {
  const reasons = [];
  if (!old) return ["a box the signed draft did not have"];
  const norm = (value) => JSON.stringify(value, (key, item) => (typeof item === "string" ? (genericPathFor(item) || item) : item));
  if (old.formCode !== next.formCode) reasons.push("another form");
  if (old.boxKind !== next.boxKind) reasons.push("another kind of box");
  if (old.boxLabel !== next.boxLabel) reasons.push("another box label");
  if (old.where !== next.where) reasons.push("another place on the form");
  if (old.writtenAs !== next.writtenAs || norm(old.technical?.transform) !== norm(next.technical?.transform)) reasons.push("another format");
  const oldPath = old.technical?.sourcePath;
  const newPath = next.technical?.sourcePath;
  if (!(oldPath === newPath || (genericPathFor(oldPath) && genericPathFor(oldPath) === newPath))) reasons.push(`another fact: ${oldPath} -> ${newPath}`);
  // the same condition, or the old one kept whole inside the new "either path" condition: every clause of the old condition (split at "and" / "or") is still there
  const clausesKept = (before, after) => before.split(/ (?:and|or) /).every((clause) => after.includes(clause));
  const sameCondition = old.onlyWhen === next.onlyWhen || (Boolean(old.onlyWhen) && clausesKept(old.onlyWhen, next.onlyWhen));
  if (!sameCondition) reasons.push("another condition");
  // what the box falls back to: unchanged, or the old private key kept as the fallback
  const fallbackKept = old.ifEmpty === next.ifEmpty || (!old.ifEmpty && next.technical?.fallback && next.technical.fallback === oldPath);
  if (!fallbackKept) reasons.push("another fallback");
  return reasons;
}

/** Pure. { same, carry, review, added } lists of entry ids/refs for an old and a new draft. */
function classify(oldDraft, newDraft, genericPathFor) {
  const oldById = new Map((oldDraft.entries || []).map((entry) => [entry.id, entry]));
  const out = { same: [], carry: [], review: [], added: [] };
  for (const entry of newDraft.entries || []) {
    const old = oldById.get(entry.id);
    if (!old) { out.added.push({ id: entry.id, ref: entry.ref, reasons: ["a box the signed draft did not have"] }); continue; }
    if (old.contentHash === entry.contentHash) { out.same.push({ id: entry.id, ref: entry.ref }); continue; }
    const reasons = reasonsToReview(old, entry, genericPathFor);
    if (reasons.length) out.review.push({ id: entry.id, ref: entry.ref, formCode: entry.formCode, reasons, was: old.sentence, now: entry.sentence });
    else out.carry.push({ id: entry.id, ref: entry.ref, formCode: entry.formCode, fromHash: old.contentHash, toHash: entry.contentHash });
  }
  return out;
}

async function main(argv = process.argv.slice(2)) {
  const apply = argv.includes("--apply");
  const oldFile = argv[argv.indexOf("--old") + 1];
  if (!oldFile || oldFile.startsWith("--")) { console.error("usage: --old <the signed draft json> [--apply]"); return 2; }
  const oldDraft = JSON.parse(fs.readFileSync(oldFile, "utf8"));
  const newDraft = require("../modules/form-mapping/golden/goldenSet.draft.json");
  const { genericPathFor } = require("../modules/form-mapping/services/ChecklistPartyRewireService");
  const result = classify(oldDraft, newDraft, genericPathFor);
  const byForm = {};
  const bump = (list, key) => list.forEach((item) => { const form = item.formCode || (item.ref || "").split(" #")[0]; (byForm[form] ||= { same: 0, carry: 0, review: 0, added: 0 })[key] += 1; });
  bump(result.same, "same"); bump(result.carry, "carry"); bump(result.review, "review"); bump(result.added, "added");
  console.log(`new draft ${newDraft.entries.length} entries (checksum ${newDraft.entriesChecksum}); signed draft ${oldDraft.entries.length} entries (checksum ${oldDraft.entriesChecksum})`);
  console.log(`unchanged ${result.same.length} | answer carried over (path rename only) ${result.carry.length} | needs the reviewer: changed ${result.review.length} + new ${result.added.length}`);
  console.log(JSON.stringify(byForm));
  const why = {};
  [...result.review, ...result.added].forEach((item) => item.reasons.forEach((reason) => { const key = reason.replace(/: .*/, ""); why[key] = (why[key] || 0) + 1; }));
  console.log("reasons:", JSON.stringify(why));
  result.review.filter((item) => item.reasons.some((reason) => reason.startsWith("another fact"))).slice(0, 40).forEach((item) => console.log(`  - ${item.ref}: ${item.reasons.join("; ")}`));
  if (!apply) { console.log("\nDRY RUN: nothing was written. Re-run with --apply."); return 0; }

  require("dotenv").config();
  const mongoose = require("mongoose");
  const env = require("../config/env");
  const Review = require("../models/GoldenSetReview");
  await mongoose.connect(env.mongoUri || process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  try {
    let carried = 0;
    let missing = 0;
    const at = new Date();
    for (const item of result.carry) {
      // only an answer that was valid for the OLD wording is moved; one that is missing or already stale stays as it is
      const done = await Review.updateOne({ entryId: item.id, contentHash: item.fromHash }, { $set: { contentHash: item.toHash, carriedOver: { fromContentHash: item.fromHash, at, reason: REASON } } });
      if (done.modifiedCount) carried += 1; else missing += 1;
    }
    console.log(`carried over ${carried} answer(s); ${missing} had no valid answer to carry`);
  } finally {
    await mongoose.disconnect();
  }
  return 0;
}

if (require.main === module) main().then((code) => process.exit(code), (error) => { console.error("failed:", error.stack || error.message); process.exit(1); });

module.exports = { classify, reasonsToReview, REASON };
