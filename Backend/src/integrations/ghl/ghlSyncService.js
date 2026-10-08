const env = require("../../config/env");
const logger = require("../../utils/logger");
const Case = require("../../models/Case");
const GHLIntegration = require("../../models/GHLIntegration");
const pipelineService = require("./ghlPipelineService");
const { fetchAllOpportunities } = require("./ghlOpportunityService");
const { resolveContact } = require("./ghlContactService");
const { createCaseFromOpportunity } = require("./ghlCaseFactory");
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
    const drift = pipelineService.detectDrift(config.stageMappings, pipelines);
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
    const result = { pipeline: pipeline.ghlPipelineName, fetched: 0, created: 0, existing: 0, skippedUnmapped: 0, needsAttention: 0, failed: 0, errors: [] };
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

module.exports = { isEnabled, loadOrBuildConfig, previewSetup, confirmMappings, initialSync };
