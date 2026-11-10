/**
 * backfill-filed-by-stage.js
 *
 * A case at Submitted (FedEx) or any later pipeline stage (Receipt Tracking, RFE, Status - Approved / Disapproved, FeedBack) has been filed, so its recorded USCIS tracking status
 * must read "Filed". Cases that reached those stages before the server started doing this itself still say Draft / Ready to file; this sets them to Filed.
 *
 * Only a PRE-filing status (draft / ready_to_file / none) is changed. Any later status (receipt issued, approved ...) is left as it is. Quiet: no e-mails, no notifications, no timeline
 * entries, and `updatedAt` is not touched. Idempotent: running it again finds nothing.
 *
 * DRY RUN by default (counts and lists, writes nothing). Add --apply to write.
 *   node Backend/scripts/backfill-filed-by-stage.js           # dry run
 *   node Backend/scripts/backfill-filed-by-stage.js --apply   # write
 */
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const mongoose = require("mongoose");

async function main() {
  const apply = process.argv.includes("--apply");
  await mongoose.connect(process.env.MONGODB_URI);
  const Case = require("../src/models/Case");
  const { filedByStageFilter, STATUS_TO_LIFECYCLE } = require("../src/modules/immigration-lifecycle/services/TrackingService");

  const filter = filedByStageFilter();
  const rows = await Case.find(filter).select("caseNumber integrations.ghl.unifiedStageKey immigrationLifecycle.tracking.status").lean();
  const byStage = {};
  rows.forEach((row) => { const key = row.integrations?.ghl?.unifiedStageKey; byStage[key] = (byStage[key] || 0) + 1; });
  console.log(`${apply ? "APPLY" : "DRY RUN"}: ${rows.length} case(s) at a filed stage whose status is not Filed yet`);
  console.log("by stage:", byStage);
  console.log("sample:", rows.slice(0, 15).map((row) => `${row.caseNumber}(${row.immigrationLifecycle?.tracking?.status || "none"})`).join(", "));

  // employer matters (principal cases, no card of their own): Filed when every employee card under them is at a filed stage
  const { markMatterFiledIfAllEmployeesFiled } = require("../src/modules/immigration-lifecycle/services/TrackingService");
  const parentIds = await Case.distinct("parentCase", { "integrations.ghl.unifiedStageKey": { $in: require("../src/modules/immigration-lifecycle/services/TrackingService").FILED_STAGE_KEYS }, parentCase: { $ne: null } });
  const matters = [];
  for (const parentId of parentIds) {
    if (await markMatterFiledIfAllEmployeesFiled(parentId, { dryRun: true })) matters.push(parentId);
  }
  const matterRows = matters.length ? await Case.find({ _id: { $in: matters } }).select("caseNumber").lean() : [];
  console.log(`employer matters to mark Filed (all their employee cards are at a filed stage): ${matterRows.length}`, matterRows.map((row) => row.caseNumber).join(", "));
  if (apply) for (const parentId of matters) await markMatterFiledIfAllEmployeesFiled(parentId);

  if (apply && rows.length) {
    const result = await Case.updateMany(
      { ...filter, _id: { $in: rows.map((row) => row._id) } },
      { $set: { "immigrationLifecycle.tracking.status": "filed", "immigrationLifecycle.filingStatus": STATUS_TO_LIFECYCLE.filed } },
      { timestamps: false }
    );
    console.log(`updated: ${result.modifiedCount}`);
  } else if (!apply) {
    console.log("nothing written. Run again with --apply to update these cases.");
  }
  await mongoose.disconnect();
}

main().catch((error) => { console.error(error); process.exit(1); });
