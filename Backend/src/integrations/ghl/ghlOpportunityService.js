const env = require("../../config/env");
const { getClient } = require("./ghlClient");

const PAGE_SIZE = 100; // GHL's maximum for opportunity search.
const MAX_PAGES = 500; // hard stop against a runaway cursor loop.

// Every opportunity in a pipeline, following GHL's startAfter/startAfterId
// cursor until a short or empty page. Never stops at the first page.
async function fetchAllOpportunities(pipelineId, { locationId = env.ghl.locationId, client = getClient(), status } = {}) {
  const all = [];
  const seen = new Set();
  let cursor = {};
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await client.get("/opportunities/search", {
      location_id: locationId,
      pipeline_id: pipelineId,
      limit: PAGE_SIZE,
      ...(status ? { status } : {}),
      ...cursor,
    });
    const batch = data?.opportunities || [];
    let added = 0;
    for (const opportunity of batch) {
      if (seen.has(opportunity.id)) continue;
      seen.add(opportunity.id);
      all.push(opportunity);
      added += 1;
    }
    const meta = data?.meta || {};
    // Stop on a short page, an empty page, a page that gave us nothing new, or no cursor.
    if (batch.length < PAGE_SIZE || added === 0 || !meta.startAfterId || meta.startAfter === undefined) break;
    cursor = { startAfter: meta.startAfter, startAfterId: meta.startAfterId };
  }
  return all;
}

async function getOpportunity(opportunityId, client = getClient()) {
  const data = await client.get(`/opportunities/${opportunityId}`);
  return data?.opportunity || data || null;
}

// Used by the outbound worker (Phase 4). Declared here so the GHL write surface
// lives in exactly one place.
async function updateOpportunityStage(opportunityId, { pipelineId, pipelineStageId }, client = getClient()) {
  return client.put(`/opportunities/${opportunityId}`, { pipelineId, pipelineStageId });
}

module.exports = { fetchAllOpportunities, getOpportunity, updateOpportunityStage, PAGE_SIZE };
