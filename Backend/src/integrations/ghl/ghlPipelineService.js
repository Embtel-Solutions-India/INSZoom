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

// Pure. Compares the selected pipelines' stages and, only if they are
// identical (same count, same names in the same order), builds the unified
// columns + per-pipeline mappings. Any difference => ok:false with a report;
// we never build a union and never guess.
function buildStagePlan(selected) {
  const problems = [];
  if (selected.length < 2) return { ok: false, problems: ["Two pipelines are required"], unifiedStages: [], stageMappings: [] };

  const [first, ...rest] = selected;
  const baseStages = sortStages(first.pipeline.stages);
  const normalise = (name) => String(name).trim().toLowerCase();

  for (const other of rest) {
    const stages = sortStages(other.pipeline.stages);
    if (stages.length !== baseStages.length) {
      problems.push(
        `Stage count differs: "${first.pipeline.name}" has ${baseStages.length}, "${other.pipeline.name}" has ${stages.length}`
      );
    }
    const max = Math.max(stages.length, baseStages.length);
    for (let i = 0; i < max; i += 1) {
      const a = baseStages[i];
      const b = stages[i];
      if (!a || !b || normalise(a.name) !== normalise(b.name)) {
        problems.push(
          `Stage ${i + 1} differs: "${first.pipeline.name}" = ${a ? `"${a.name}"` : "(none)"}, "${other.pipeline.name}" = ${b ? `"${b.name}"` : "(none)"}`
        );
      }
    }
  }
  if (problems.length) return { ok: false, problems, unifiedStages: [], stageMappings: [] };

  const unifiedStages = baseStages.map((stage, index) => ({ key: slug(stage.name), name: stage.name, order: index }));
  const keys = new Set(unifiedStages.map((s) => s.key));
  if (keys.size !== unifiedStages.length) {
    return { ok: false, problems: ["Stage names are not unique within a pipeline"], unifiedStages: [], stageMappings: [] };
  }

  const stageMappings = [];
  for (const { pipeline } of selected) {
    sortStages(pipeline.stages).forEach((stage, index) => {
      stageMappings.push({
        ghlPipelineId: pipeline.id,
        ghlStageId: stage.id,
        ghlStageName: stage.name,
        unifiedStageKey: unifiedStages[index].key,
        unifiedStageName: unifiedStages[index].name,
      });
    });
  }
  return { ok: true, problems: [], unifiedStages, stageMappings };
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

// (pipelineId, stageId) -> unified column, and unified column + pipeline -> GHL stage.
function resolveUnifiedStage(stageMappings, ghlPipelineId, ghlStageId) {
  return stageMappings.find((m) => m.ghlPipelineId === ghlPipelineId && m.ghlStageId === ghlStageId) || null;
}
function resolveGhlStage(stageMappings, ghlPipelineId, unifiedStageKey) {
  return stageMappings.find((m) => m.ghlPipelineId === ghlPipelineId && m.unifiedStageKey === unifiedStageKey) || null;
}

module.exports = { listPipelines, selectPipelines, buildStagePlan, detectDrift, resolveUnifiedStage, resolveGhlStage, slug };
