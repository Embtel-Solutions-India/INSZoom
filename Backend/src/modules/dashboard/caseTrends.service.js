// Analytics: "Cases submitted" per month and the monthly Active / On Hold / Closed flow.
// Both read each case's own pipeline history: every move between GoHighLevel stages (either pipeline) is a timeline event carrying metadata.unifiedStageKey and a
// timestamp (ghlOutboundService / ghlWebhookService), so no new storage is needed. A case is "submitted" in the month it was FIRST sent to a submitted / completed
// stage (Submitted, receipt tracking, Approved, Disapproved, feedback) - counted once, in that month only, even if it has moved on or back since. Pure functions + one loader.
const { COMPLETED_STAGE_KEYS } = require("../cases/caseManagerAccess");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const isCompletedKey = (key) => COMPLETED_STAGE_KEYS.includes(key);
const isOnHoldKey = (key) => /hold/i.test(String(key || ""));
// The Cases list colours a pipeline stage (Admin utils/stageTone.js): red = On Hold, orange = PWD under process, blue = filed / outcome (Submitted, Receipt tracking,
// RFE, Approved, Disapproved, Feedback); every other stage - and a case with no pipeline stage - is WHITE = a case still being worked on = ACTIVE. Same rules here.
const isColouredKey = (key) => /hold/i.test(String(key || "")) || /(^|[^a-z])pwd([^a-z]|$)/i.test(String(key || "")) || /submitted|receipt|(^|[^a-z])rfe([^a-z]|$)|approv|reject|feedback/i.test(String(key || ""));
const time = (value) => { const t = new Date(value).getTime(); return Number.isNaN(t) ? null : t; };
const monthStart = (year, month) => Date.UTC(year, month, 1);

function sortedEvents(row) {
  return (row.events || []).map((event) => ({ key: event.key, at: time(event.at) })).filter((event) => event.key && event.at !== null).sort((a, b) => a.at - b.at);
}

// When the case was first sent to a completed stage; null when it never was. A case with no recorded move that sits in one now is dated by its last sync.
function submittedAt(row) {
  const first = sortedEvents(row).find((event) => isCompletedKey(event.key));
  if (first) return first.at;
  return isCompletedKey(row.currentKey) ? (time(row.fallbackAt) ?? time(row.createdAt)) : null;
}

// Bars for the last `months` calendar months ending with the current one, zero months included.
function submittedByMonth(rows, now = new Date(), months = 12) {
  const buckets = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    buckets.push({ year: d.getUTCFullYear(), month: d.getUTCMonth(), count: 0 });
  }
  const first = monthStart(buckets[0].year, buckets[0].month);
  const last = monthStart(buckets[buckets.length - 1].year, buckets[buckets.length - 1].month + 1);
  for (const row of rows) {
    const at = submittedAt(row);
    if (at === null || at < first || at >= last) continue;
    const d = new Date(at);
    const bucket = buckets.find((item) => item.year === d.getUTCFullYear() && item.month === d.getUTCMonth());
    if (bucket) bucket.count += 1;
  }
  return buckets.map((item) => ({ month: `${item.year}-${String(item.month + 1).padStart(2, "0")}`, label: MONTHS[item.month], year: item.year, count: item.count }));
}

// Monthly FLOW (not a running total) for the last `months` months, per month:
//   active = cases that BECAME active in that month: created in it (a new case starts in a white stage) or moved into a white stage in it
//   onHold = cases that were moved to the On Hold stage in that month
// A case counts once per series per month; one created and put on hold in the same month counts in both Active and On Hold.
function monthlyFlow(rows, now = new Date(), months = 12) {
  const buckets = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    buckets.push({ year: d.getUTCFullYear(), month: d.getUTCMonth(), active: new Set(), onHold: new Set() });
  }
  const bucketOf = (t) => {
    if (t === null || t === undefined) return null;
    const d = new Date(t);
    return buckets.find((item) => item.year === d.getUTCFullYear() && item.month === d.getUTCMonth()) || null;
  };
  rows.forEach((row, index) => {
    const id = row.id !== undefined ? String(row.id) : String(index);
    const events = sortedEvents(row);
    const created = time(row.createdAt);
    // a case with a recorded history started in a white stage; one without history is only counted active at creation when it is white now
    if (events.length || !isColouredKey(row.currentKey)) bucketOf(created)?.active.add(id);
    for (const event of events) {
      const bucket = bucketOf(event.at);
      if (!bucket) continue;
      if (isOnHoldKey(event.key)) bucket.onHold.add(id);
      else if (!isColouredKey(event.key)) bucket.active.add(id);
    }
    if (!events.length && isOnHoldKey(row.currentKey)) bucketOf(time(row.fallbackAt) ?? created)?.onHold.add(id); // no recorded move: dated by the last sync
  });
  return buckets.map((item) => ({ month: `${item.year}-${String(item.month + 1).padStart(2, "0")}`, label: MONTHS[item.month], year: item.year, active: item.active.size, onHold: item.onHold.size }));
}

// One read of the (scoped) cases' stage history; callers pass the same scope filter caseAnalytics uses.
async function loadRows(match) {
  const Case = require("../../models/Case");
  return Case.aggregate([
    { $match: match },
    { $project: {
      createdAt: 1,
      id: "$_id",
      currentKey: "$integrations.ghl.unifiedStageKey",
      fallbackAt: { $ifNull: ["$integrations.ghl.sync.changedAt", "$updatedAt"] },
      events: { $map: {
        input: { $filter: { input: { $ifNull: ["$timeline", []] }, as: "e", cond: { $and: [{ $eq: ["$$e.type", "case"] }, { $ne: [{ $ifNull: ["$$e.metadata.unifiedStageKey", null] }, null] }] } } },
        as: "e",
        in: { key: "$$e.metadata.unifiedStageKey", at: "$$e.createdAt" },
      } },
    } },
  ]);
}

async function caseTrends(match, now = new Date()) {
  const rows = await loadRows(match);
  return { submittedByMonth: submittedByMonth(rows, now), monthlyFlow: monthlyFlow(rows, now) };
}

module.exports = { submittedAt, submittedByMonth, monthlyFlow, loadRows, caseTrends };
