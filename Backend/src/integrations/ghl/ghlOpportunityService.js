const env = require("../../config/env");
const { getClient, GHLApiError } = require("./ghlClient");

const PAGE_SIZE = 100; // GHL's maximum for opportunity search.
const MAX_PAGES = 500; // hard stop against a runaway cursor loop.

// Every opportunity in a pipeline, following GHL's startAfter/startAfterId
// cursor until a short or empty page. Never stops at the first page.
async function fetchAllOpportunities(pipelineId, { locationId = env.ghl.locationId, client = getClient(), status, contactId } = {}) {
  const all = [];
  const seen = new Set();
  let cursor = {};
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await client.get("/opportunities/search", {
      location_id: locationId,
      pipeline_id: pipelineId,
      limit: PAGE_SIZE,
      ...(status ? { status } : {}),
      ...(contactId ? { contact_id: contactId } : {}),
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

// ---- writes used by the employee sync (ghlAuxOutbound.js). Kept here so the whole GHL write surface is in one place. ----

// POST /opportunities/ : a new opportunity for an employee card. Returns the created opportunity.
async function createOpportunity(body, client = getClient()) {
  try {
    const data = await client.post("/opportunities/", body);
    return data?.opportunity || data || null;
  } catch (error) {
    // GHL refuses a second opportunity for the same contact in a pipeline unless the pipeline allows duplicates. An employer with
    // several employees (one contact) and a client with several cases both need that setting on.
    if (error?.body?.code === "OPPORTUNITY_NO_DUPLICATE") {
      throw new GHLApiError('GoHighLevel refused this opportunity because the contact already has one in this pipeline. In GoHighLevel open Opportunities > Pipelines > (this pipeline) > Edit and turn ON "Allow duplicate opportunities", then retry.', { status: 400, body: error.body, retryable: false });
    }
    throw error;
  }
}

// DELETE /opportunities/{id} : removes the opportunity from GHL (used when a case is deleted for good, so the next sync cannot re-import it).
// An opportunity that is already gone (404) counts as deleted.
async function deleteOpportunity(opportunityId, client = getClient()) {
  try {
    await client.request("DELETE", `/opportunities/${opportunityId}`);
  } catch (error) {
    if (!(error instanceof GHLApiError && error.status === 404)) throw error;
  }
}

// PUT /opportunities/{id}/status : open | won | lost | abandoned
async function updateOpportunityStatus(opportunityId, status, client = getClient()) {
  return client.put(`/opportunities/${opportunityId}/status`, { status });
}

// PUT /opportunities/{id} : the display name only (nothing else is touched)
async function updateOpportunityName(opportunityId, name, client = getClient()) {
  return client.put(`/opportunities/${opportunityId}`, { name });
}

module.exports = { fetchAllOpportunities, getOpportunity, updateOpportunityStage, createOpportunity, deleteOpportunity, updateOpportunityStatus, updateOpportunityName, PAGE_SIZE };
