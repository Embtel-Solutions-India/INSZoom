const env = require("../../config/env");
const GHLIntegration = require("../../models/GHLIntegration");

// The Pipeline stage a case sits in, by name, so the Cases list and the case Overview show the SAME stage the Pipeline board and
// GoHighLevel show (and the Update Stage button changes). Cases without a GHL card keep showing their CRM stage.

const CACHE_MS = 60 * 1000;
let cache = { at: 0, names: new Map() };

async function nameMap() {
  if (!env.ghl.enabled || !env.ghl.locationId) return new Map();
  if (Date.now() - cache.at < CACHE_MS) return cache.names;
  const config = await GHLIntegration.findOne({ locationId: env.ghl.locationId }).select("pipelines").lean().catch(() => null);
  const names = new Map();
  (config?.pipelines || []).forEach((pipeline) => (pipeline.stages || []).forEach((stage) => names.set(`${pipeline.ghlPipelineId}:${stage.key}`, stage.name)));
  cache = { at: Date.now(), names };
  return names;
}

/**
 * An employer matter has no card of its own, its employees do. Adds `pipelineStageSummary` ([{ name, count }]) and `pipelineEmployeeCount`
 * from those cards; when every employee is in the same stage it also sets `pipelineStage`, so the matter shows that one stage like any case.
 * Display only, never throws.
 */
async function attachEmployerStageSummary(sources, serialized, names) {
  try {
    const wanted = new Map(); // principal id -> serialized row
    serialized.forEach((out, index) => {
      const source = sources[index];
      if (out && source?.caseStructure === "employer_employee" && source?.caseRole === "principal" && !source?.integrations?.ghl?.opportunityId) wanted.set(String(source._id), out);
    });
    if (!wanted.size) return;
    const Case = require("../../models/Case");
    const rows = await Case.aggregate([
      { $match: { parentCase: { $in: [...wanted.keys()].map((id) => new (require("mongoose").Types.ObjectId)(id)) }, "integrations.ghl.opportunityId": { $exists: true, $ne: null }, status: { $nin: ["removed", "archived"] } } },
      { $group: { _id: { parent: "$parentCase", pipeline: "$integrations.ghl.pipelineId", key: "$integrations.ghl.unifiedStageKey" }, count: { $sum: 1 } } },
    ]);
    const byParent = new Map();
    rows.forEach((row) => {
      const name = names.get(`${row._id.pipeline}:${row._id.key}`);
      if (!name) return;
      const list = byParent.get(String(row._id.parent)) || new Map();
      list.set(name, (list.get(name) || 0) + row.count);
      byParent.set(String(row._id.parent), list);
    });
    byParent.forEach((stages, parentId) => {
      const out = wanted.get(parentId);
      if (!out) return;
      const summary = [...stages.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      out.pipelineStageSummary = summary;
      out.pipelineEmployeeCount = summary.reduce((sum, item) => sum + item.count, 0);
      if (summary.length === 1) out.pipelineStage = summary[0].name;
    });
  } catch {
    /* display only */
  }
}

/** Adds `pipelineStage` (name) and `pipelineCategory` to each serialized case, from the matching source documents. Never throws. */
async function attachStageNames(sources, serialized) {
  try {
    const names = await nameMap();
    serialized.forEach((out, index) => {
      const source = sources[index];
      const ghl = source?.integrations?.ghl;
      const category = ghl?.category || source?.pipelineCategory;
      if (out && category) out.pipelineCategory = category;
      if (!out || !ghl?.opportunityId || !ghl.unifiedStageKey) return;
      const name = names.get(`${ghl.pipelineId}:${ghl.unifiedStageKey}`);
      if (name) out.pipelineStage = name;
    });
    await attachEmployerStageSummary(sources, serialized, names);
  } catch {
    /* display only */
  }
  return serialized;
}

/**
 * Dashboard "Pipeline by stage": how many cases sit in each GoHighLevel stage, immigrant and non-immigrant pipelines combined (same-named stages
 * add up). Only stages that hold at least one case are returned, in pipeline order. Cases without a GHL card are not counted. Returns
 * [{ key: <stage name>, count, value: 0 }] to match the other dashboard groupings. Never throws.
 */
async function ghlStageCounts(Case, match) {
  try {
    const rows = await Case.aggregate([
      { $match: { $and: [match, { "integrations.ghl.opportunityId": { $exists: true, $ne: null } }] } },
      { $group: { _id: { pipeline: "$integrations.ghl.pipelineId", key: "$integrations.ghl.unifiedStageKey" }, count: { $sum: 1 } } },
    ]);
    const config = env.ghl.enabled && env.ghl.locationId
      ? await GHLIntegration.findOne({ locationId: env.ghl.locationId }).select("pipelines").lean().catch(() => null)
      : null;
    const info = new Map(); // "pipelineId:key" -> { name, order }
    (config?.pipelines || []).forEach((pipeline) => (pipeline.stages || []).forEach((stage, index) => info.set(`${pipeline.ghlPipelineId}:${stage.key}`, { name: stage.name, order: Number.isFinite(stage.order) ? stage.order : index })));
    const merged = new Map(); // stage name -> { count, order }
    rows.forEach((row) => {
      const found = info.get(`${row._id.pipeline}:${row._id.key}`);
      if (!found || !row.count) return;
      const current = merged.get(found.name) || { count: 0, order: found.order };
      current.count += row.count;
      current.order = Math.min(current.order, found.order);
      merged.set(found.name, current);
    });
    return [...merged.entries()]
      .sort((a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0]))
      .map(([key, { count }]) => ({ key, count, value: 0 }));
  } catch {
    return [];
  }
}

module.exports = { attachStageNames, ghlStageCounts };
