// Repairs the `link` of notifications ALREADY stored, using the same per-recipient-role mapping new notifications get
// (modules/notifications/pushRouting.js). Only the `link` field of notifications whose link is one of the known dead paths is touched
// (written straight to the collection, so updatedAt and hooks are left alone). Idempotent; run with no flag for a dry run.
//
//   node src/scripts/repairNotificationLinks.js           dry run - prints what would change
//   node src/scripts/repairNotificationLinks.js --apply   writes the changes
require("dotenv").config();
const mongoose = require("mongoose");

const DEAD = /^\/(admin\/portal|appointments|payments\/|cases(\/|$|\?)|messages\/[a-f0-9]{24}|dashboard\/employer|dashboard\/payments$)/i;
const APPLY = process.argv.includes("--apply");

async function main() {
  const Notification = require("../models/Notification");
  const User = require("../models/User");
  const { resolveLinkForRole } = require("../modules/notifications/pushRouting");
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });

  const roles = new Map();
  const roleOf = async (userId) => {
    const key = String(userId || "");
    if (!key) return undefined;
    if (!roles.has(key)) roles.set(key, (await User.findById(key).select("role").lean())?.role);
    return roles.get(key);
  };

  const cursor = Notification.collection.find({ link: { $regex: DEAD.source, $options: "i" } }, { projection: { link: 1, userId: 1, user: 1, caseId: 1, case: 1 } });
  const ops = [];
  const summary = {};
  let scanned = 0;
  for await (const n of cursor) {
    scanned += 1;
    const next = resolveLinkForRole(await roleOf(n.userId || n.user), n.link, { caseId: n.caseId || n.case });
    if (!next || next === n.link) continue;
    const kind = `${n.link.replace(/[a-f0-9]{24}/gi, ":id").split("?")[0]} -> ${next.replace(/[a-f0-9]{24}/gi, ":id")}`;
    summary[kind] = (summary[kind] || 0) + 1;
    ops.push({ updateOne: { filter: { _id: n._id, link: n.link }, update: { $set: { link: next } } } });
  }
  console.log(`${APPLY ? "APPLY" : "DRY RUN"}: scanned ${scanned} candidate notification(s), ${ops.length} to change`);
  Object.entries(summary).sort((a, b) => b[1] - a[1]).forEach(([kind, count]) => console.log(`  ${String(count).padStart(5)}  ${kind}`));
  if (APPLY && ops.length) {
    for (let i = 0; i < ops.length; i += 500) await Notification.collection.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    console.log("done");
  } else if (!APPLY) console.log("nothing written (add --apply to write)");
  await mongoose.disconnect();
}

main().catch(async (error) => { console.error(error.message); await mongoose.disconnect().catch(() => {}); process.exit(1); });
