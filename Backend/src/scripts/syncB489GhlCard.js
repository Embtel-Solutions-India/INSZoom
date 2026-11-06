// One-off: bring the GoHighLevel card of B489-A in step with the case type change PERM -> L-1A (the case itself was converted in place; its card was deliberately left where it was).
// The card is MOVED, not deleted and recreated: the same GoHighLevel opportunity goes from the Immigrant pipeline to the Non-Immigrant one at the stage with the same key, and its service
// type becomes L-1A's - the same PUT /opportunities/:id the app already uses for stage and payment updates. Hard-wired to B489-A; refuses anything else.
//
//   node src/scripts/syncB489GhlCard.js            DRY RUN: reads the live card, prints exactly what would change
//   node src/scripts/syncB489GhlCard.js --apply    moves the card, verifies it in GoHighLevel, then updates the case's own record
require("dotenv").config();
const mongoose = require("mongoose");

const CASE_NUMBER = "B489-A";
const APPLY = process.argv.includes("--apply");
const say = (...args) => console.log(...args);
const stop = (message) => { throw new Error(message); };

async function main() {
  const env = require("../config/env");
  const Case = require("../models/Case");
  const GHLIntegration = require("../models/GHLIntegration");
  const opportunityService = require("../integrations/ghl/ghlOpportunityService");
  const visaService = require("../integrations/ghl/ghlVisaService");
  const aux = require("../integrations/ghl/ghlAuxOutbound");
  const { ensureFieldIds } = require("../integrations/ghl/ghlCustomFieldService");
  const { getClient } = require("../integrations/ghl/ghlClient");

  if (!env.ghl.enabled || !env.ghl.token || !env.ghl.locationId) stop("GoHighLevel is not configured in this environment");
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });

  const child = await Case.findOne({ caseNumber: CASE_NUMBER, caseRole: "employee" });
  if (!child) stop(`${CASE_NUMBER} not found`);
  const ghl = child.integrations?.ghl || {};
  if (!ghl.opportunityId) stop(`${CASE_NUMBER} has no GoHighLevel card`);
  if (child.visaType !== "L-1A") stop(`${CASE_NUMBER} is ${child.visaType}, not L-1A`);

  const config = await GHLIntegration.findOne({ locationId: env.ghl.locationId });
  if (!config?.mappingsConfirmedAt) stop("GHL stage mapping is not confirmed");
  const entries = await visaService.ensureEntries(config);
  const category = child.pipelineCategory || aux.categoryForVisa(child.visaType, child.petitionSubType, entries);
  const target = config.pipelines.find((p) => p.enabled && p.category === category && p.stages?.length);
  if (!target) stop(`No ${category} pipeline is configured`);
  const mapping = config.stageMappings.find((m) => m.ghlPipelineId === target.ghlPipelineId && m.unifiedStageKey === ghl.unifiedStageKey);
  if (!mapping) stop(`The ${category} pipeline has no stage "${ghl.unifiedStageKey}"`);

  const client = getClient();
  const live = await opportunityService.getOpportunity(ghl.opportunityId, client);
  if (!live || String(live.id) !== String(ghl.opportunityId)) stop("GoHighLevel did not return this card");
  say(`Case ${CASE_NUMBER} (${child.visaType}), card ${ghl.opportunityId} "${live.name || ""}"`);
  say(`  now in GoHighLevel: pipeline ${live.pipelineId}, stage ${live.pipelineStageId}   |  recorded on the case: category ${ghl.category}, stage "${ghl.unifiedStageKey}"`);
  say(`  target:             pipeline ${target.ghlPipelineId} (${category}), stage ${mapping.ghlStageId} ("${mapping.unifiedStageKey}")`);
  if (String(live.pipelineId) === String(target.ghlPipelineId) && ghl.category === category) { say("\nAlready in the right pipeline - nothing to do."); return; }
  if (String(live.pipelineId) !== String(ghl.pipelineId)) stop("The card was moved in GoHighLevel meanwhile (its pipeline differs from the case's record) - not touching it");

  const fieldIds = await ensureFieldIds(config, { client });
  const svc = aux.serviceTypeFor(child.visaType, child.petitionSubType, entries);
  const customFields = [];
  if (svc.serviceType && fieldIds?.service_type) customFields.push({ id: fieldIds.service_type, field_value: svc.serviceType });
  if (svc.detailField && fieldIds?.[svc.detailField]) customFields.push({ id: fieldIds[svc.detailField], field_value: svc.detailValue });
  say(`  service type:       ${svc.serviceType || "(none mapped)"}${svc.detailField ? ` / ${svc.detailField} = ${svc.detailValue}` : ""}`);

  if (!APPLY) { say("\nDRY RUN - nothing was changed (add --apply to move the card)."); return; }

  await opportunityService.updateOpportunity(ghl.opportunityId, { pipelineId: target.ghlPipelineId, pipelineStageId: mapping.ghlStageId, ...(customFields.length ? { customFields } : {}) }, client);
  const after = await opportunityService.getOpportunity(ghl.opportunityId, client);
  if (String(after?.pipelineId) !== String(target.ghlPipelineId)) stop(`GoHighLevel still reports pipeline ${after?.pipelineId}: the case record was NOT changed`);
  const now = new Date();
  await Case.updateOne({ _id: child._id }, {
    $set: {
      "integrations.ghl.pipelineId": target.ghlPipelineId,
      "integrations.ghl.pipelineStageId": mapping.ghlStageId,
      "integrations.ghl.sourcePipelineId": target.ghlPipelineId,
      "integrations.ghl.sourceStageId": mapping.ghlStageId,
      "integrations.ghl.category": category,
      "integrations.ghl.lastSyncedAt": now,
      "integrations.ghl.sync.state": "synced",
      "integrations.ghl.sync.changedAt": now,
      "integrations.ghl.sync.lastSyncedStageId": mapping.ghlStageId,
      "integrations.ghl.sync.attempts": 0,
    },
    $inc: { "integrations.ghl.sync.version": 1 },
  });
  say(`\nDONE - GoHighLevel now has the card in pipeline ${after.pipelineId} (${category}); the case record matches.`);
}

main().then(() => mongoose.disconnect().then(() => process.exit(0))).catch(async (error) => { console.error("STOPPED:", error.message); await mongoose.disconnect().catch(() => {}); process.exit(1); });
