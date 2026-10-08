// Pure decision logic for an inbound GHL stage change against a case's stored
// sync state (conflict rule, plan section 6.5). No DB access, so every branch
// is unit-testable.
//
// The most recent accepted stage change wins, unless there is an unresolved
// outbound (CRM -> GHL) operation for the same opportunity: then our pending
// change wins until that operation resolves.

const MAX_DEFERRALS = 6; // ~90s of waiting for our own pending write before the timestamp rule decides.
const DEFER_DELAY_MS = 15000;

function firstValidDate(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const date = new Date(typeof value === "number" && value < 1e12 ? value * 1000 : value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

/**
 * @param ghl       case.integrations.ghl (plain object)
 * @param incoming  { pipelineId, stageId, eventTime: Date|null }
 * @param attempts  how many times this event has already been deferred
 * @returns { action: "noop" | "defer" | "ignore_older" | "apply", delayMs?, reason }
 */
function decideInboundStage({ ghl, incoming, attempts = 0 }) {
  // Already there: either an echo of our own write or a duplicate delivery.
  if (ghl.pipelineId === incoming.pipelineId && ghl.pipelineStageId === incoming.stageId) {
    return { action: "noop", reason: "already_in_stage" };
  }

  const sync = ghl.sync || {};
  const unresolvedOutbound = sync.state === "pending" && sync.source === "immiglance";
  if (unresolvedOutbound && attempts < MAX_DEFERRALS) {
    return { action: "defer", delayMs: DEFER_DELAY_MS, reason: "outbound_pending" };
  }

  const changedAt = sync.changedAt ? new Date(sync.changedAt) : null;
  if (incoming.eventTime && changedAt && incoming.eventTime.getTime() < changedAt.getTime()) {
    return { action: "ignore_older", reason: "older_than_local_change" };
  }
  return { action: "apply", reason: unresolvedOutbound ? "outbound_pending_expired_ghl_newer" : "ghl_newer_or_unknown" };
}

module.exports = { decideInboundStage, firstValidDate, MAX_DEFERRALS, DEFER_DELAY_MS };
