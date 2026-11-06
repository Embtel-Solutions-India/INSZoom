const env = require("../../config/env");
const { getClient } = require("./ghlClient");

// Pipelines and stage mapping. Names are used ONCE, here, to line up the two
// pipelines' stages into unified columns. Every runtime lookup afterwards goes
// by (ghlPipelineId, ghlStageId) from the stored mappings.

const slug = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const sortStages = (stages = []) => [...stages].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

async function listPipelines(locationId = env.ghl.locationId, client = getClient()) {
  const data = await client.get("/opportunities/pipelines", { locationId });
  return data?.pipelines || [];
}

// Pure. A configured pipeline ID wins (and must exist). Otherwise the exact
// configured name is used (case-insensitive, no fuzzy matching). Anything
// missing or ambiguous is reported, never guessed.
function selectPipelines(pipelines, config = env.ghl) {
  const wanted = [
    { category: "immigrant", id: config.immigrantPipelineId, name: config.immigrantPipelineName },
    { category: "non_immigrant", id: config.nonImmigrantPipelineId, name: config.nonImmigrantPipelineName },
  ];
  const errors = [];
  const selected = [];
  for (const { category, id, name } of wanted) {
    if (id) {
      const byId = pipelines.find((p) => p.id === id);
      if (byId) selected.push({ category, pipeline: byId });
      else errors.push(`Configured pipeline ID not found in GHL: "${id}" (${category})`);
      continue;
    }
    const hits = pipelines.filter((p) => p.name.trim().toLowerCase() === String(name).trim().toLowerCase());
    if (hits.length === 0) errors.push(`Pipeline not found: "${name}"`);
    else if (hits.length > 1) errors.push(`Pipeline name is ambiguous (${hits.length} matches): "${name}"`);
    else selected.push({ category, pipeline: hits[0] });
  }
  if (selected.length === 2 && selected[0].pipeline.id === selected[1].pipeline.id) {
    errors.push("The immigrant and non-immigrant pipelines resolve to the same GHL pipeline");
  }
  return { selected, errors };
}

// Pure. Builds each pipeline's OWN stage list and its stage mappings. Pipelines
// are independent: they may have different stages, different counts, different
// names. (Immiglance shows one board per pipeline, so there is no merging and
// no requirement that the two pipelines match.) A pipeline whose stage names
// collide after slugging is rejected, because the column key must be unique
// inside its board.
function buildPipelinePlans(selected) {
  const problems = [];
  if (!selected.length) return { ok: false, problems: ["No pipelines selected"], pipelines: [], stageMappings: [] };

  const pipelines = [];
  const stageMappings = [];
  for (const { category, pipeline } of selected) {
    const stages = sortStages(pipeline.stages);
    if (!stages.length) {
      problems.push(`Pipeline "${pipeline.name}" has no stages`);
      continue;
    }
    const planned = stages.map((stage, index) => ({ key: slug(stage.name), name: stage.name, order: index, ghlStageId: stage.id }));
    if (new Set(planned.map((s) => s.key)).size !== planned.length) {
      problems.push(`Pipeline "${pipeline.name}" has stage names that are not unique`);
      continue;
    }
    pipelines.push({
      ghlPipelineId: pipeline.id,
      ghlPipelineName: pipeline.name,
      category,
      stages: planned.map(({ key, name, order }) => ({ key, name, order })),
    });
    planned.forEach((stage) =>
      stageMappings.push({
        ghlPipelineId: pipeline.id,
        ghlStageId: stage.ghlStageId,
        ghlStageName: stage.name,
        unifiedStageKey: stage.key,
        unifiedStageName: stage.name,
      })
    );
  }
  if (problems.length) return { ok: false, problems, pipelines: [], stageMappings: [] };
  return { ok: true, problems: [], pipelines, stageMappings };
}

// Pure. Compares stored mappings with the stages GHL reports now, by stage ID.
function detectDrift(stageMappings, pipelines) {
  const drift = [];
  const byPipeline = new Map(pipelines.map((p) => [p.id, p]));
  const pipelineIds = [...new Set(stageMappings.map((m) => m.ghlPipelineId))];
  for (const pipelineId of pipelineIds) {
    const pipeline = byPipeline.get(pipelineId);
    if (!pipeline) {
      drift.push({ type: "pipeline_missing", ghlPipelineId: pipelineId });
      continue;
    }
    const current = new Map((pipeline.stages || []).map((s) => [s.id, s]));
    const mappedIds = new Set();
    for (const mapping of stageMappings.filter((m) => m.ghlPipelineId === pipelineId)) {
      mappedIds.add(mapping.ghlStageId);
      const stage = current.get(mapping.ghlStageId);
      if (!stage) drift.push({ type: "stage_missing", ghlPipelineId: pipelineId, ghlStageId: mapping.ghlStageId, name: mapping.ghlStageName });
      else if (stage.name !== mapping.ghlStageName) {
        drift.push({ type: "stage_renamed", ghlPipelineId: pipelineId, ghlStageId: mapping.ghlStageId, from: mapping.ghlStageName, to: stage.name });
      }
    }
    for (const stage of pipeline.stages || []) {
      if (!mappedIds.has(stage.id)) drift.push({ type: "stage_added", ghlPipelineId: pipelineId, ghlStageId: stage.id, name: stage.name });
    }
  }
  return drift;
}

// Pure. A stage ADDED in GoHighLevel (a new column such as "On Hold") joins the confirmed mapping without re-mapping anything: only when every difference
// is a new stage (a renamed or removed stage still needs an admin's review). Returns the stages and mappings to append and the refreshed column order
// of every mapped stage; touches nothing itself.
function planAddedStages(config, pipelines, drift = detectDrift(config.stageMappings, pipelines)) {
  const added = drift.filter((item) => item.type === "stage_added");
  if (!added.length) return { ok: false, reason: "No new stages to add" };
  if (added.length !== drift.length) return { ok: false, reason: "Stages were also renamed or removed in GoHighLevel: that needs the full setup review" };
  const byPipeline = new Map(pipelines.map((p) => [p.id, p]));
  const additions = [];
  for (const item of added) {
    const pipeline = byPipeline.get(item.ghlPipelineId);
    const stage = (pipeline?.stages || []).find((s) => s.id === item.ghlStageId);
    const stored = (config.pipelines || []).find((p) => p.ghlPipelineId === item.ghlPipelineId);
    if (!stage || !stored) return { ok: false, reason: `Pipeline or stage not found for "${item.name}"` };
    const key = slug(stage.name);
    if (!key || stored.stages.some((s) => s.key === key)) return { ok: false, reason: `A column "${key}" already exists in ${stored.ghlPipelineName}` };
    additions.push({ ghlPipelineId: item.ghlPipelineId, stage: { key, name: stage.name }, mapping: { ghlPipelineId: item.ghlPipelineId, ghlStageId: stage.id, ghlStageName: stage.name, unifiedStageKey: key, unifiedStageName: stage.name } });
  }
  // the column order follows the order in GoHighLevel, for the stages already mapped and the new ones alike
  const orders = new Map();
  for (const pipeline of pipelines) {
    sortStages(pipeline.stages || []).forEach((stage, index) => orders.set(`${pipeline.id}:${stage.id}`, index));
  }
  return { ok: true, additions, orders };
}

// (pipelineId, stageId) -> unified column, and unified column + pipeline -> GHL stage.
function resolveUnifiedStage(stageMappings, ghlPipelineId, ghlStageId) {
  return stageMappings.find((m) => m.ghlPipelineId === ghlPipelineId && m.ghlStageId === ghlStageId) || null;
}
function resolveGhlStage(stageMappings, ghlPipelineId, unifiedStageKey) {
  return stageMappings.find((m) => m.ghlPipelineId === ghlPipelineId && m.unifiedStageKey === unifiedStageKey) || null;
}

module.exports = { listPipelines, selectPipelines, buildPipelinePlans, detectDrift, planAddedStages, resolveUnifiedStage, resolveGhlStage, slug };
