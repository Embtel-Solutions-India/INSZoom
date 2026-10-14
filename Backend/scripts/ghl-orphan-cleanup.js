// Cleans up GoHighLevel leftovers of cases that were deleted WITHOUT the normal "delete case" path (e.g. a direct database cleanup), which never
// removes the case's GHL opportunity or its link rows:
//   - employer links (GHLEmployerLink) whose employer matter no longer exists - they also block a NEW matter for the same employer contact
//     from being linked (unique per contact), so its employees would silently never reach GHL;
//   - failed sync jobs (GHLSyncJob) for cases that no longer exist - they can never be retried;
//   - case links (GHLCaseLink) whose case no longer exists, and the GHL opportunity each still points at.
//
//   node scripts/ghl-orphan-cleanup.js                                  DRY RUN: counts and lists what would change, writes nothing
//   node scripts/ghl-orphan-cleanup.js --apply                          removes the local leftovers only: orphan employer links + orphan failed jobs
//                                                                        + orphan case links whose GHL opportunity is already gone (delete job done)
//   node scripts/ghl-orphan-cleanup.js --apply --delete-ghl-opportunities
//                                                                        ALSO queues a durable "delete_opportunity" job for the GHL opportunity of every
//                                                                        orphan case link - this REMOVES those cards FROM GOHIGHLEVEL (the app's own
//                                                                        worker performs and retries it). Run --apply again later to drop the links.
// Orphan case links that still have a live opportunity in GHL are deliberately KEPT until it is deleted: reconcile skips them, whereas without the
// link a deleted case would be imported back from GHL as a new case.
require("dotenv").config({ path: __dirname + "/../.env" });
const mongoose = require("mongoose");
const crypto = require("crypto");

const APPLY = process.argv.includes("--apply");
const DELETE_IN_GHL = process.argv.includes("--delete-ghl-opportunities");

(async () => {
  const env = require("../src/config/env");
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 15000 });
  const Case = require("../src/models/Case");
  const GHLCaseLink = require("../src/models/GHLCaseLink");
  const GHLEmployerLink = require("../src/models/GHLEmployerLink");
  const GHLSyncJob = require("../src/models/GHLSyncJob");

  console.log(APPLY ? "APPLY" : "DRY RUN", "| db:", mongoose.connection.name, DELETE_IN_GHL ? "| will queue GHL opportunity deletions" : "");
  const aliveSet = async (ids) => new Set((await Case.find({ _id: { $in: ids } }).select("_id").lean()).map((c) => String(c._id)));

  const employerLinks = await GHLEmployerLink.find({}).select("principalCaseId").lean();
  const aliveEmployers = await aliveSet(employerLinks.map((l) => l.principalCaseId));
  const orphanEmployerLinks = employerLinks.filter((l) => !aliveEmployers.has(String(l.principalCaseId)));

  const failed = await GHLSyncJob.find({ status: "failed", type: { $ne: "delete_opportunity" } }).select("caseId type").lean();
  const aliveForJobs = await aliveSet(failed.map((j) => j.caseId));
  const orphanFailedJobs = failed.filter((j) => !aliveForJobs.has(String(j.caseId)));

  const caseLinks = await GHLCaseLink.find({}).select("caseId opportunityId").lean();
  const aliveCases = await aliveSet(caseLinks.map((l) => l.caseId));
  const orphanCaseLinks = caseLinks.filter((l) => !aliveCases.has(String(l.caseId)));
  const deleteJobs = await GHLSyncJob.find({ type: "delete_opportunity", opportunityId: { $in: orphanCaseLinks.map((l) => l.opportunityId) } }).select("opportunityId status").lean();
  const jobStates = new Map();
  for (const j of deleteJobs) jobStates.set(j.opportunityId, [...(jobStates.get(j.opportunityId) || []), j.status]);
  const goneInGhl = orphanCaseLinks.filter((l) => (jobStates.get(l.opportunityId) || []).includes("done"));
  const stillInGhl = orphanCaseLinks.filter((l) => !(jobStates.get(l.opportunityId) || []).includes("done"));
  const needDeleteJob = stillInGhl.filter((l) => !(jobStates.get(l.opportunityId) || []).some((s) => ["pending", "processing"].includes(s)));

  console.log(`orphan employer links (employer matter deleted): ${orphanEmployerLinks.length} of ${employerLinks.length}`);
  console.log(`orphan failed jobs (case deleted):               ${orphanFailedJobs.length}`);
  console.log(`orphan case links (case deleted):                ${orphanCaseLinks.length}  -> opportunity already deleted in GHL: ${goneInGhl.length} | still in GHL: ${stillInGhl.length} (${needDeleteJob.length} without a delete job)`);

  if (!APPLY) { console.log("\nnothing written. Re-run with --apply (local leftovers only) or --apply --delete-ghl-opportunities (also removes the cards from GHL)."); await mongoose.disconnect(); return; }

  const a = await GHLEmployerLink.deleteMany({ _id: { $in: orphanEmployerLinks.map((l) => l._id) } });
  const b = await GHLSyncJob.deleteMany({ _id: { $in: orphanFailedJobs.map((j) => j._id) } });
  const c = await GHLCaseLink.deleteMany({ _id: { $in: goneInGhl.map((l) => l._id) } });
  console.log(`removed: ${a.deletedCount} employer links, ${b.deletedCount} failed jobs, ${c.deletedCount} case links`);

  if (DELETE_IN_GHL) {
    for (const link of needDeleteJob) {
      await GHLSyncJob.create({ type: "delete_opportunity", caseId: link.caseId, opportunityId: link.opportunityId, operationId: crypto.randomUUID(), status: "pending", nextAttemptAt: new Date() });
    }
    console.log(`queued ${needDeleteJob.length} GHL opportunity deletions (the running backend's GHL worker performs them; run --apply again afterwards to drop their links)`);
  } else if (stillInGhl.length) {
    console.log(`${stillInGhl.length} orphan case links were kept: their opportunities are still in GHL (use --delete-ghl-opportunities to remove them from GHL).`);
  }
  await mongoose.disconnect();
})().catch((error) => { console.error("ERR", error.message); process.exit(1); });
