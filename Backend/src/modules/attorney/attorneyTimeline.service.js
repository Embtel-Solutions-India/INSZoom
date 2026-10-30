// An attorney's personal timeline on a case: assigned -> opened -> worked (petition read, feedback given) -> review completed.
//
//   stored events   AttorneyCaseEvent rows written as the attorney works (record()).
//   derived events  dates the attorney's access grant already carries: assigned (assignedAt), first opened (engagedAt) and review completed (reviewedAt). They make the
//                   timeline complete for work done before events were recorded, and are left out when a stored event already says the same thing.
//
// record() never throws and is meant to be called without awaiting; compose() is pure so it can be tested without a database.

const DERIVED = { assigned: "assigned", opened: "first_opened", reviewed: "review_completed" };

const toTime = (value) => (value ? new Date(value).getTime() : NaN);

/** Pure: the timeline (newest first) from the attorney's grant and their stored events. */
function compose({ grant, events = [] }) {
  const stored = (events || []).map((event) => ({
    id: String(event._id),
    type: event.type,
    title: event.title,
    description: event.description || "",
    at: event.createdAt,
  }));
  const hasStored = (type) => stored.some((event) => event.type === type);
  const derived = [];
  if (grant?.assignedAt) derived.push({ id: "derived-assigned", type: DERIVED.assigned, title: "Case assigned to you", description: "", at: grant.assignedAt });
  if (grant?.engagedAt && !hasStored("case_opened")) derived.push({ id: "derived-opened", type: DERIVED.opened, title: "You opened the case", description: "", at: grant.engagedAt });
  if (grant?.reviewStatus === "reviewed" && grant.reviewedAt && !hasStored("review_completed")) {
    derived.push({ id: "derived-reviewed", type: DERIVED.reviewed, title: "Review completed", description: "You marked your review of this case complete.", at: grant.reviewedAt });
  }
  return [...stored, ...derived].filter((event) => !Number.isNaN(toTime(event.at))).sort((a, b) => toTime(b.at) - toTime(a.at));
}

/** Writes one event. `dedupeMinutes` skips it when the same attorney already has the same event for the same case/petition that recently. Never throws. */
async function record({ caseId, attorneyId, type, title, description = "", meta, dedupeMinutes = 0 }, deps = {}) {
  try {
    const Model = deps.Model || require("../../models/AttorneyCaseEvent");
    if (dedupeMinutes > 0) {
      const since = new Date((deps.now ? deps.now() : new Date()).getTime() - dedupeMinutes * 60 * 1000);
      const filter = { caseId, attorneyId, type, createdAt: { $gte: since } };
      if (meta?.documentId) filter["meta.documentId"] = meta.documentId;
      if (await Model.exists(filter)) return null;
    }
    return await Model.create({ caseId, attorneyId, type, title, description: String(description || "").slice(0, 500), ...(meta ? { meta } : {}) });
  } catch (error) {
    try { require("../../utils/logger").warn("attorney_timeline_record_failed", { type, error: error.message }); } catch (_error) { /* logging only */ }
    return null;
  }
}

/** The attorney's own events on one case (newest first, capped). */
async function list({ caseId, attorneyId }, deps = {}) {
  const Model = deps.Model || require("../../models/AttorneyCaseEvent");
  return Model.find({ caseId, attorneyId }).sort({ createdAt: -1 }).limit(300).lean();
}

module.exports = { compose, record, list };
