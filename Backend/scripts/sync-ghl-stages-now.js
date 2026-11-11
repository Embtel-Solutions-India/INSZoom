#!/usr/bin/env node
// Brings the board's stages in line with GoHighLevel right now: stages ADDED in GHL become new columns, stages RENAMED in GHL take their new name (their column key never
// changes). The running sync does the same on its own every pass; this is the same step on demand.
//   node scripts/sync-ghl-stages-now.js            dry run: prints what would change, writes nothing
//   node scripts/sync-ghl-stages-now.js --apply    applies it
// A stage or pipeline REMOVED in GHL is never adopted (it needs a person): the script says so and changes nothing.
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

async function main() {
  const apply = process.argv.includes("--apply");
  await mongoose.connect(process.env.MONGODB_URI);
  const env = require("../src/config/env");
  const Integration = require("../src/models/GHLIntegration");
  const pipelineService = require("../src/integrations/ghl/ghlPipelineService");
  const sync = require("../src/integrations/ghl/ghlSyncService");

  const config = await Integration.findOne({ locationId: env.ghl.locationId });
  if (!config) throw new Error("no GHL integration configured");
  const pipelines = await pipelineService.listPipelines(env.ghl.locationId);
  const drift = pipelineService.detectDrift(config.stageMappings, pipelines);
  console.log(`status now: ${config.status} | differences from GoHighLevel: ${drift.length}`);
  drift.forEach((d) => console.log(`  ${d.type}: ${d.from ? `"${d.from}" -> "${d.to}"` : `"${d.name}"`} (pipeline ${d.ghlPipelineId})`));
  const plan = pipelineService.planStageSync(config, pipelines, drift);
  if (!plan.ok) { console.log(`\nnothing will be changed: ${plan.reason}`); return; }
  console.log("\nwould apply:");
  plan.renames.forEach((r) => console.log(`  rename  [${r.unifiedStageKey}] "${r.from}" -> "${r.to}" (key stays "${r.unifiedStageKey}")`));
  plan.additions.forEach((a) => console.log(`  add     "${a.stage.name}" as column "${a.stage.key}" in pipeline ${a.ghlPipelineId}`));
  if (!apply) { console.log("\nDRY RUN - nothing written. Add --apply to apply."); return; }
  const result = await sync.adoptStageChanges(config, pipelines, drift, { source: "script" });
  console.log("\nAPPLIED:", JSON.stringify({ adopted: result.adopted, renamed: result.renamed.length, added: result.added.length }));
  const after = pipelineService.detectDrift(config.stageMappings, pipelines);
  console.log(`status now: ${config.status} | differences from GoHighLevel: ${after.length}`);
}

main().then(() => mongoose.disconnect().then(() => process.exit(0))).catch((error) => { console.error("FAILED:", error.message); process.exit(1); });
