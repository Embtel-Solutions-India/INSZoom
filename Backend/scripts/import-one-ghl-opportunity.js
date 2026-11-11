#!/usr/bin/env node
// Imports ONE GoHighLevel opportunity as an Immiglance case, exactly the way the sync does (same factory, same visa resolution, same stage mapping),
// without running the whole sync and without touching any other card. Useful when the sync is paused (config_mismatch) and one card must come in now.
//
//   node scripts/import-one-ghl-opportunity.js --id=<GHL opportunity id>            dry run: prints what would be created, writes nothing
//   node scripts/import-one-ghl-opportunity.js --id=<GHL opportunity id> --apply    creates the case (no e-mails are sent)
//
// Safe to repeat: an opportunity that already has a case is reported and left alone (the factory is idempotent through the GHLCaseLink unique index).
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || "").slice(name.length + 3);
const apply = process.argv.includes("--apply");
const opportunityId = arg("id");

async function main() {
  if (!opportunityId) throw new Error("pass --id=<GHL opportunity id>");
  await mongoose.connect(process.env.MONGODB_URI);
  const env = require("../src/config/env");
  const Integration = require("../src/models/GHLIntegration");
  const pipelineService = require("../src/integrations/ghl/ghlPipelineService");
  const opportunityService = require("../src/integrations/ghl/ghlOpportunityService");
  const { resolveContact } = require("../src/integrations/ghl/ghlContactService");
  const { createCaseFromOpportunity, findCaseByOpportunity, isOrphanedLink } = require("../src/integrations/ghl/ghlCaseFactory");
  const visaService = require("../src/integrations/ghl/ghlVisaService");

  const config = await Integration.findOne({ locationId: env.ghl.locationId });
  if (!config) throw new Error("no GHL integration configured for this location");

  // find the opportunity inside the pipelines the sync reads (same call the sync makes)
  let opportunity = null;
  let pipeline = null;
  for (const candidate of config.pipelines.filter((p) => p.enabled)) {
    const all = await opportunityService.fetchAllOpportunities(candidate.ghlPipelineId, {});
    opportunity = all.find((o) => o.id === opportunityId) || null;
    if (opportunity) { pipeline = candidate; break; }
  }
  if (!opportunity) throw new Error(`opportunity ${opportunityId} was not found in any enabled pipeline`);

  const mapping = pipelineService.resolveUnifiedStage(config.stageMappings, opportunity.pipelineId, opportunity.pipelineStageId);
  if (!mapping) throw new Error(`the opportunity's stage ${opportunity.pipelineStageId} is not mapped; it cannot be placed on the board`);

  const existing = await findCaseByOpportunity(config.locationId, opportunity.id);
  if (existing) { console.log(`already has a case: ${existing.caseNumber} (${existing.clientName}) - nothing to do`); return; }
  if (await isOrphanedLink(config.locationId, opportunity.id)) throw new Error("this opportunity's case was deleted on purpose (orphaned link); it will not be re-imported");

  const contact = await resolveContact(opportunity, undefined);
  const visaResolution = await visaService.resolveForOpportunity({ opportunity, config, client: undefined, pipelineCategory: pipeline.category });
  console.log(`opportunity : "${opportunity.name}" (${opportunity.id}) | status ${opportunity.status}`);
  console.log(`pipeline    : ${pipeline.ghlPipelineName} (${pipeline.category})`);
  console.log(`stage       : -> "${mapping.unifiedStageName}" (${mapping.unifiedStageKey})`);
  console.log(`contact     : ${contact && (contact.name || contact.firstName)} | ${(contact && contact.email) || "no email"}`);
  console.log(`visa (GHL)  : ${visaResolution && visaResolution.status}${visaResolution && visaResolution.visaType ? ` -> ${visaResolution.visaType}` : ""}${visaResolution && visaResolution.value ? ` (GHL value "${visaResolution.value}")` : ""}`);
  if (!apply) { console.log("\nDRY RUN - nothing written. Add --apply to create the case (no e-mails are sent)."); return; }

  const outcome = await createCaseFromOpportunity({
    opportunity, contact, category: pipeline.category, mapping, origin: "reconciliation",
    sendNotifications: false, locationId: config.locationId, visaResolution,
  });
  console.log("\nRESULT:", JSON.stringify({ created: Boolean(outcome.created), skipped: outcome.skipped || null, caseNumber: outcome.case && outcome.case.caseNumber, caseId: outcome.case && String(outcome.case._id) }));
}

main().then(() => mongoose.disconnect().then(() => process.exit(0))).catch((error) => { console.error("FAILED:", error.message); process.exit(1); });
