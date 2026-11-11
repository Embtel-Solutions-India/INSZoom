const env = require("../../config/env");
const logger = require("../../utils/logger");
const Case = require("../../models/Case");
const GHLIntegration = require("../../models/GHLIntegration");
const pipelineService = require("./ghlPipelineService");
const { fetchAllOpportunities } = require("./ghlOpportunityService");
const { resolveContact } = require("./ghlContactService");
const { createCaseFromOpportunity, findCaseByOpportunity, isOrphanedLink } = require("./ghlCaseFactory");
const visaService = require("./ghlVisaService");

const isEnabled = () => env.ghl.enabled && Boolean(env.ghl.token) && Boolean(env.ghl.locationId);

// Loads the stored configuration, or builds it from GHL on first use. Never
// overwrites a confirmed mapping: a changed GHL config is reported as drift
// instead, so nothing is silently re-mapped.
async function loadOrBuildConfig({ client } = {}) {
  const locationId = env.ghl.locationId;
  const pipelines = await pipelineService.listPipelines(locationId, client);
  let config = await GHLIntegration.findOne({ locationId });

  // A config confirmed before pipelines carried their own stage lists has to be rebuilt (and re-confirmed once).
  const hasPipelineStages = config?.pipelines?.length > 0 && config.pipelines.every((p) => p.stages?.length);
  if (config?.mappingsConfirmedAt && config.stageMappings.length && hasPipelineStages) {
    let drift = pipelineService.detectDrift(config.stageMappings, pipelines);
    // The board follows GoHighLevel's own stages: a stage ADDED or RENAMED there is adopted here, in the same pass, so the sync is never held up by a stage change
    // (it used to stop every import, every stage update and every move until an admin confirmed it). A stage/pipeline REMOVED still blocks (needs a human).
    // GHL_AUTO_ADOPT_STAGES=off restores the old behaviour exactly.
    if (drift.length && autoAdoptStages()) {
      try {
        const adopted = await adoptStageChanges(config, pipelines, drift, { source: "auto" });
        if (adopted.adopted) drift = pipelineService.detectDrift(config.stageMappings, pipelines);
      } catch (error) {
        logger.warn("ghl_stage_auto_adopt_failed", { error: error.message }); // never fatal: the old "needs review" path below still applies
      }
    }
    if (drift.length) {
      config.status = "config_mismatch";
      config.statusDetail = JSON.stringify(drift).slice(0, 2000);
      await config.save();
      return { ok: false, config, drift, problems: ["GHL stage configuration changed since the mapping was confirmed"] };
    }
    return { ok: true, config, drift: [] };
  }

  const { selected, errors } = pipelineService.selectPipelines(pipelines);
  if (errors.length) return { ok: false, config, drift: [], problems: errors };
  const plan = pipelineService.buildPipelinePlans(selected);
  if (!plan.ok) return { ok: false, config, drift: [], problems: plan.problems };

  if (!config) config = new GHLIntegration({ locationId });
  config.pipelines = plan.pipelines.map((p) => ({ ...p, enabled: true }));
  config.stageMappings = plan.stageMappings;
  config.mappingsConfirmedAt = undefined;
  config.status = "unconfigured";
  config.statusDetail = "Mappings built; awaiting admin confirmation";
  await config.save();
  return { ok: true, config, drift: [], needsConfirmation: true };
}

// Read-only preview of what a sync would use. Writes nothing except the
// (unconfirmed) config document.
async function previewSetup(options) {
  const result = await loadOrBuildConfig(options);
  return {
    ok: result.ok,
    problems: result.problems || [],
    drift: result.drift || [],
    confirmed: Boolean(result.config?.mappingsConfirmedAt),
    pipelines: (result.config?.pipelines || []).map((p) => ({
      id: p.ghlPipelineId,
      name: p.ghlPipelineName,
      category: p.category,
      stages: (p.stages || []).map((s) => ({ key: s.key, name: s.name })),
    })),
  };
}

// A stage added in GoHighLevel (for example "On Hold") joins the confirmed mapping as a new board column. Only additions: every existing stage, its
// column key and the confirmation stay exactly as they are. Refuses (and changes nothing) when anything was renamed or removed.
async function adoptAddedStages({ client, user } = {}) {
  const locationId = env.ghl.locationId;
  const config = await GHLIntegration.findOne({ locationId });
  if (!config?.mappingsConfirmedAt) throw Object.assign(new Error("The stage mapping has not been confirmed yet: run setup first."), { status: 409 });
  const pipelines = await pipelineService.listPipelines(locationId, client);
  const plan = pipelineService.planAddedStages(config, pipelines);
  if (!plan.ok) throw Object.assign(new Error(plan.reason), { status: 409 });
  for (const { ghlPipelineId, stage, mapping } of plan.additions) {
    const stored = config.pipelines.find((p) => p.ghlPipelineId === ghlPipelineId);
    stored.stages.push({ ...stage, order: 0 });
    config.stageMappings.push(mapping);
  }
  // refresh the column order from GoHighLevel's own order
  const stageIdOf = (pipelineId, key) => config.stageMappings.find((m) => m.ghlPipelineId === pipelineId && m.unifiedStageKey === key)?.ghlStageId;
  for (const stored of config.pipelines) {
    for (const stage of stored.stages) {
      const order = plan.orders.get(`${stored.ghlPipelineId}:${stageIdOf(stored.ghlPipelineId, stage.key)}`);
      if (order !== undefined) stage.order = order;
    }
    stored.stages.sort((a, b) => a.order - b.order);
  }
  config.status = "healthy";
  config.statusDetail = undefined;
  await config.save();
  logger.info("ghl_stages_added", { added: plan.additions.map((a) => `${a.ghlPipelineId}:${a.stage.key}`), by: user?._id ? String(user._id) : undefined });
  return { added: plan.additions.map((a) => ({ pipelineId: a.ghlPipelineId, key: a.stage.key, name: a.stage.name })) };
}

const autoAdoptStages = () => String(process.env.GHL_AUTO_ADOPT_STAGES || "on").toLowerCase() !== "off";

// Applies a stage-only change from GoHighLevel (see pipelineService.planStageSync): new stages become new board columns, renamed stages take their new name
// while KEEPING their column key, the column order follows GoHighLevel. The confirmation stays; nothing else is touched. Returns { adopted, renamed, added }.
// `config` is the stored integration document (mutated and saved); nothing is changed when the plan is not ok.
async function adoptStageChanges(config, pipelines, drift, { user, source = "admin" } = {}) {
  const plan = pipelineService.planStageSync(config, pipelines, drift);
  if (!plan.ok) return { adopted: false, reason: plan.reason, blockers: plan.blockers || [], renamed: [], added: [] };
  for (const rename of plan.renames) {
    const mapping = config.stageMappings.find((m) => m.ghlPipelineId === rename.ghlPipelineId && m.ghlStageId === rename.ghlStageId);
    const stored = config.pipelines.find((p) => p.ghlPipelineId === rename.ghlPipelineId);
    const column = stored?.stages.find((s) => s.key === rename.unifiedStageKey);
    mapping.ghlStageName = rename.to;
    mapping.unifiedStageName = rename.to;
    if (column) column.name = rename.to;
  }
  for (const { ghlPipelineId, stage, mapping } of plan.additions) {
    config.pipelines.find((p) => p.ghlPipelineId === ghlPipelineId).stages.push({ ...stage, order: 0 });
    config.stageMappings.push(mapping);
  }
  const stageIdOf = (pipelineId, key) => config.stageMappings.find((m) => m.ghlPipelineId === pipelineId && m.unifiedStageKey === key)?.ghlStageId;
  for (const stored of config.pipelines) {
    for (const stage of stored.stages) {
      const order = plan.orders.get(`${stored.ghlPipelineId}:${stageIdOf(stored.ghlPipelineId, stage.key)}`);
      if (order !== undefined) stage.order = order;
    }
    stored.stages.sort((a, b) => a.order - b.order);
  }
  config.status = "healthy";
  config.statusDetail = undefined;
  await config.save();
  const summary = {
    renamed: plan.renames.map((r) => ({ pipelineId: r.ghlPipelineId, key: r.unifiedStageKey, from: r.from, to: r.to })),
    added: plan.additions.map((a) => ({ pipelineId: a.ghlPipelineId, key: a.stage.key, name: a.stage.name })),
  };
  logger.info("ghl_stages_synced", { ...summary, source, by: user?._id ? String(user._id) : undefined });
  return { adopted: true, ...summary };
}

// The admin's "Add the new stages" action: adopts every stage added or renamed in GoHighLevel (the same step the sync runs on its own). Refuses (and changes
// nothing) when a stage or pipeline was removed there, or when there is nothing to adopt.
async function adoptStageChangesFromGhl({ client, user } = {}) {
  const locationId = env.ghl.locationId;
  const config = await GHLIntegration.findOne({ locationId });
  if (!config?.mappingsConfirmedAt) throw Object.assign(new Error("The stage mapping has not been confirmed yet: run setup first."), { status: 409 });
  const pipelines = await pipelineService.listPipelines(locationId, client);
  const result = await adoptStageChanges(config, pipelines, pipelineService.detectDrift(config.stageMappings, pipelines), { user, source: "admin" });
  if (!result.adopted) throw Object.assign(new Error(result.reason), { status: 409 });
  return result;
}

async function confirmMappings(user) {
  const config = await GHLIntegration.findOne({ locationId: env.ghl.locationId });
  if (!config || !config.stageMappings.length) throw Object.assign(new Error("No mappings to confirm. Run setup first."), { status: 409 });
  config.mappingsConfirmedAt = new Date();
  config.mappingsConfirmedBy = user?._id;
  config.status = "healthy";
  config.statusDetail = undefined;
  await config.save();
  return config;
}

// Imports every opportunity in each configured pipeline. Pipelines are
// processed independently: one failing never stops the other. Idempotent.
async function initialSync({ client, user } = {}) {
  const setup = await loadOrBuildConfig({ client });
  if (!setup.ok) return { ok: false, problems: setup.problems, drift: setup.drift };
  const { config } = setup;
  if (!config.mappingsConfirmedAt) {
    return { ok: false, problems: ["Stage mapping has not been confirmed by an admin yet"], needsConfirmation: true };
  }

  const summary = { ok: true, pipelines: [] };
  for (const pipeline of config.pipelines.filter((p) => p.enabled)) {
    const result = { pipeline: pipeline.ghlPipelineName, fetched: 0, created: 0, existing: 0, skippedUnmapped: 0, orphaned: 0, needsAttention: 0, failed: 0, errors: [] };
    summary.pipelines.push(result);
    try {
      const opportunities = await fetchAllOpportunities(pipeline.ghlPipelineId, { client });
      result.fetched = opportunities.length;
      pipeline.lastFetchOkAt = new Date();
      pipeline.lastFetchError = undefined;

      for (const opportunity of opportunities) {
        try {
          const mapping = pipelineService.resolveUnifiedStage(config.stageMappings, opportunity.pipelineId, opportunity.pipelineStageId);
          if (!mapping) {
            result.skippedUnmapped += 1;
            continue;
          }
          // Its case was deleted but the card is still in GHL: nothing to import, and no GHL calls to spend on it (ghlCaseFactory.isOrphanedLink).
          if (!(await findCaseByOpportunity(config.locationId, opportunity.id)) && (await isOrphanedLink(config.locationId, opportunity.id))) {
            result.orphaned += 1;
            continue;
          }
          const contact = await resolveContact(opportunity, client);
          // Search results already carry the custom fields, so this costs no extra API call.
          const visaResolution = await visaService.resolveForOpportunity({ opportunity, config, client, pipelineCategory: pipeline.category });
          const outcome = await createCaseFromOpportunity({
            opportunity,
            contact,
            category: pipeline.category,
            mapping,
            origin: "initial_sync",
            sendNotifications: env.ghl.importSendsEmails,
            locationId: config.locationId,
            visaResolution,
          });
          if (outcome.skipped) {
            // no case to update: its case was deleted and the card is still being removed from GHL (or its link is orphaned)
            result.orphaned += 1;
            continue;
          }
          if (outcome.created) {
            result.created += 1;
            if (outcome.needsAttention?.length) result.needsAttention += 1;
          } else {
            result.existing += 1;
            if (outcome.case.visaSelectionStatus === "pending") await visaService.applyToExistingCase(outcome.case, visaResolution);
            await Case.updateOne({ _id: outcome.case._id }, {
              $set: { "integrations.ghl.opportunityStatus": opportunity.status, "integrations.ghl.lastSyncedAt": new Date() },
            });
          }
        } catch (error) {
          result.failed += 1;
          result.errors.push({ opportunityId: opportunity.id, message: error.message });
          logger.error("ghl_initial_sync_opportunity_failed", { opportunityId: opportunity.id, error: error.message });
        }
      }
    } catch (error) {
      pipeline.lastFetchError = error.message;
      result.failed += 1;
      result.errors.push({ message: error.message });
      summary.ok = false;
      logger.error("ghl_initial_sync_pipeline_failed", { pipeline: pipeline.ghlPipelineName, error: error.message });
    }
  }

  config.lastInitialSyncAt = new Date();
  config.lastApiOkAt = summary.pipelines.some((p) => !p.errors.some((e) => !e.opportunityId)) ? new Date() : config.lastApiOkAt;
  config.status = summary.ok ? "healthy" : "degraded";
  await config.save();
  return summary;
}

module.exports = { isEnabled, loadOrBuildConfig, previewSetup, adoptAddedStages, adoptStageChanges, adoptStageChangesFromGhl, confirmMappings, initialSync };
