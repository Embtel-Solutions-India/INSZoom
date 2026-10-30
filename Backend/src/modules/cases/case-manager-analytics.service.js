const mongoose = require("mongoose");
const Case = require("../../models/Case");
const { caseManagerMatch } = require("./caseManagerAccess");
const { COUNTABLE_CASE } = require("./countableCase");
const env = require("../../config/env");
const GHLIntegration = require("../../models/GHLIntegration");
const Payment = require("../../models/Payment");
const PaymentLedgerEntry = require("../../models/PaymentLedgerEntry");

// A case stays "Active" until it's actually CLOSED (an APPROVED case is still
// active work until closed out) - confirmed product decision, see the
// case-manager-analytics-panel plan. "rejected" is this schema's stand-in for
// "denied" in Case.status (the dedicated denied value lives on
// uscisDecision instead - see OUTCOME_FIELD note below).
// Active = assigned to this case manager and still being worked: not closed out and no final decision yet. Assignment
// itself moves a case from pending_assignment to "assigned", which counts as active automatically.
const CLOSED_STATUSES = ["closed", "completed", "archived", "cancelled"];
const APPROVED_STATUSES = ["approved"];
const REJECTED_STATUSES = ["rejected", "denied"];
const ACTIVE_EXCLUDED_STATUSES = [...CLOSED_STATUSES, ...APPROVED_STATUSES, ...REJECTED_STATUSES];

const DEFAULT_STALE_DAYS = 14;
const RFE_LOOKAHEAD_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function objectId(value) {
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
}

const PERIOD_DAYS = { "30d": 30, "90d": 90, "1y": 365 };

// Cases that came in during the selected window (by createdAt). Applied to every figure on the panel.
function periodRange(period) {
  const days = PERIOD_DAYS[period] || PERIOD_DAYS["30d"];
  return { $gte: new Date(Date.now() - days * DAY_MS) };
}

// Shared by the analytics panel's overdueRfe bucket and the /cases deep-link
// filter (case.service.js's rfeOverdue flag) so both agree on what "an open
// RFE due soon or already passed" means: rfeDeadline set, no response
// recorded yet, due within the next RFE_LOOKAHEAD_DAYS days (or already past).
function openRfeDeadlineFilter({ dueSoonOnly = false } = {}) {
  const filter = {
    rfeDeadline: { $exists: true, $ne: null },
    $or: [{ rfeResponseDate: { $exists: false } }, { rfeResponseDate: null }],
  };
  if (dueSoonOnly) filter.rfeDeadline = { ...filter.rfeDeadline, $lte: new Date(Date.now() + RFE_LOOKAHEAD_DAYS * DAY_MS) };
  return filter;
}

async function caseIdsWithBalanceDue(caseIds) {
  const rows = await Payment.aggregate([
    { $match: { $or: [{ caseId: { $in: caseIds } }, { case: { $in: caseIds } }] } },
    { $addFields: { resolvedCase: { $ifNull: ["$caseId", "$case"] } } },
    { $match: { remainingAmount: { $gt: 0 } } },
    { $group: { _id: "$resolvedCase" } },
  ]);
  return new Set(rows.map((row) => String(row._id)));
}

async function attentionSection(caseManagerFilter) {
  const [onHoldCases, overdueRfeCases] = await Promise.all([
    Case.find({ ...caseManagerFilter, status: "on_hold" }).select("_id").lean(),
    Case.find({ ...caseManagerFilter, ...openRfeDeadlineFilter({ dueSoonOnly: true }) })
      .select("_id caseNumber clientName rfeDeadline")
      .sort({ rfeDeadline: 1 })
      .lean(),
  ]);

  const onHoldIds = onHoldCases.map((c) => c._id);
  const balanceDueIds = onHoldIds.length ? await caseIdsWithBalanceDue(onHoldIds) : new Set();
  const nonPaymentHoldCount = onHoldIds.filter((id) => balanceDueIds.has(String(id))).length;

  const now = Date.now();
  const overdueRfeItems = overdueRfeCases.map((c) => ({
    caseId: c._id,
    caseNumber: c.caseNumber,
    clientName: c.clientName,
    rfeDeadline: c.rfeDeadline,
    daysRemaining: Math.ceil((new Date(c.rfeDeadline).getTime() - now) / DAY_MS),
  }));

  const needsAttentionIds = new Set([
    ...onHoldIds.map(String),
    ...overdueRfeCases.map((c) => String(c._id)),
  ]);

  return {
    onHold: {
      total: onHoldIds.length,
      byReason: { nonPayment: nonPaymentHoldCount, other: onHoldIds.length - nonPaymentHoldCount },
    },
    overdueRfe: { total: overdueRfeItems.length, items: overdueRfeItems },
    needsAttentionTotal: needsAttentionIds.size,
  };
}

// Outcomes are counted from the case itself: the government decision (uscisDecision) or the matching case status.
async function closeSection(caseManagerFilter) {
  const decided = (decision, statuses) => ({ $or: [{ uscisDecision: decision }, { status: { $in: statuses } }] });
  const [approved, denied, closed] = await Promise.all([
    Case.countDocuments({ $and: [caseManagerFilter, decided("approved", APPROVED_STATUSES)] }),
    Case.countDocuments({ $and: [caseManagerFilter, decided("denied", REJECTED_STATUSES)] }),
    Case.countDocuments({ ...caseManagerFilter, status: { $in: CLOSED_STATUSES } }),
  ]);
  const total = approved + denied;
  return { approved, denied, rejected: denied, approvalRatio: total ? Math.round((approved / total) * 100) : null, closed };
}

// Stage names and order come from the GoHighLevel pipelines the Pipeline board uses. Same stage in both pipelines is merged by name.
async function byStageBreakdown(caseManagerFilter) {
  const [config, rows] = await Promise.all([
    GHLIntegration.findOne({ locationId: env.ghl.locationId }).select("pipelines").lean().catch(() => null),
    Case.aggregate([
      { $match: caseManagerFilter },
      { $group: { _id: { pipeline: "$integrations.ghl.pipelineId", stage: "$integrations.ghl.unifiedStageKey" }, count: { $sum: 1 } } },
    ]),
  ]);
  const counts = new Map(rows.map((r) => [`${r._id.pipeline}:${r._id.stage}`, r.count]));
  const seen = new Set();
  const out = [];
  (config?.pipelines || []).filter((p) => p.enabled !== false).forEach((pipeline) => {
    [...(pipeline.stages || [])].sort((a, b) => (a.order || 0) - (b.order || 0)).forEach((stage) => {
      const count = counts.get(`${pipeline.ghlPipelineId}:${stage.key}`) || 0;
      seen.add(`${pipeline.ghlPipelineId}:${stage.key}`);
      const existing = out.find((o) => o.stage === stage.name);
      if (existing) existing.count += count;
      else out.push({ stage: stage.name, count });
    });
  });
  const unplaced = rows.filter((r) => !seen.has(`${r._id.pipeline}:${r._id.stage}`)).reduce((sum, r) => sum + r.count, 0);
  if (unplaced) out.push({ stage: "Not in pipeline", count: unplaced });
  return out;
}

// "Collected" is sourced from PaymentLedgerEntry - immutable rows written
// only after gateway settlement is validated (see payment.service.js's
// markTransactionSucceeded / writeLedgerEntry) - not from Payment.reconciliation.status,
// which no job in this codebase ever advances past "unreconciled". Confirmed
// product decision; see plan for the reasoning.
async function paymentsSection(caseIds) {
  const ledgerMatch = { "payment.resolvedCase": { $in: caseIds } };

  const [ledgerRows, balanceRows] = await Promise.all([
    PaymentLedgerEntry.aggregate([
      { $lookup: { from: "payments", localField: "paymentId", foreignField: "_id", as: "payment" } },
      { $unwind: "$payment" },
      { $addFields: { "payment.resolvedCase": { $ifNull: ["$payment.caseId", "$payment.case"] } } },
      { $match: ledgerMatch },
      {
        $group: {
          _id: null,
          collected: {
            $sum: {
              $cond: [
                { $in: ["$entryType", ["charge", "reconciliation"]] },
                "$amount",
                { $cond: [{ $in: ["$entryType", ["refund", "write_off"]] }, { $multiply: ["$amount", -1] }, 0] },
              ],
            },
          },
        },
      },
    ]),
    Payment.aggregate([
      { $match: { $or: [{ caseId: { $in: caseIds } }, { case: { $in: caseIds } }] } },
      { $addFields: { resolvedCase: { $ifNull: ["$caseId", "$case"] } } },
      { $match: { remainingAmount: { $gt: 0 } } },
      { $group: { _id: "$resolvedCase", remaining: { $sum: "$remainingAmount" } } },
    ]),
  ]);

  return {
    collected: ledgerRows[0]?.collected || 0,
    outstanding: balanceRows.reduce((sum, row) => sum + row.remaining, 0),
    casesWithBalance: balanceRows.length,
    currency: "USD",
    _note: "collected is summed from the immutable PaymentLedgerEntry ledger (charge/reconciliation minus refund/write_off), not Payment.reconciliation.status - no reconciliation job in this codebase ever advances that field, so gating on it would always read 0. outstanding/casesWithBalance are point-in-time balances, not period-filtered.",
  };
}

async function activitySection(caseManagerFilter, staleDays) {
  const now = Date.now();
  const d7 = new Date(now - 7 * DAY_MS);
  const d30 = new Date(now - 30 * DAY_MS);
  const staleThreshold = new Date(now - staleDays * DAY_MS);

  const activeFilter = { ...caseManagerFilter, status: { $nin: ACTIVE_EXCLUDED_STATUSES } };
  const [d7Count, d30Count, d30PlusCount, staleCount] = await Promise.all([
    Case.countDocuments({ ...activeFilter, updatedAt: { $gte: d7 } }),
    Case.countDocuments({ ...activeFilter, updatedAt: { $lt: d7, $gte: d30 } }),
    Case.countDocuments({ ...activeFilter, updatedAt: { $lt: d30 } }),
    Case.countDocuments({ ...activeFilter, updatedAt: { $lt: staleThreshold } }),
  ]);

  return {
    stale: staleCount,
    distribution: { d7: d7Count, d30: d30Count, d30plus: d30PlusCount },
    _note: "lastActivityAt has no dedicated field in this schema - updatedAt is used as the proxy.",
  };
}

// Cases assigned to this case manager over time, zero-filled so the line is continuous. There is no case-level "assigned on" date,
// so createdAt (the same date the period filter uses) places each case: per day for 30d, per week for 90d, per month for 1y.
async function assignedTrend(caseManagerFilter, period) {
  const rows = await Case.find(caseManagerFilter).select("createdAt").lean();
  const now = new Date();
  const buckets = [];
  let keyOf;
  if (period === "1y") {
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleString("en-US", { month: "short" }), count: 0 });
    }
    keyOf = (d) => `${d.getFullYear()}-${d.getMonth()}`;
  } else if (period === "90d") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 90);
    for (let i = 0; i < 13; i += 1) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i * 7);
      buckets.push({ key: i, start: d, label: d.toLocaleString("en-US", { month: "short", day: "numeric" }), count: 0 });
    }
    keyOf = (d) => { const i = buckets.findLastIndex((b) => b.start <= d); return i < 0 ? null : i; };
  } else {
    for (let i = 29; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      buckets.push({ key: d.toDateString(), label: d.toLocaleString("en-US", { month: "short", day: "numeric" }), count: 0 });
    }
    keyOf = (d) => d.toDateString();
  }
  const index = new Map(buckets.map((b) => [b.key, b]));
  rows.forEach((row) => { const b = index.get(keyOf(new Date(row.createdAt))); if (b) b.count += 1; });
  return { granularity: period === "1y" ? "month" : period === "90d" ? "week" : "day", points: buckets.map(({ label, count }) => ({ label, count })) };
}

async function byVisaTypeBreakdown(caseManagerFilter) {
  const rows = await Case.aggregate([
    { $match: caseManagerFilter },
    { $group: { _id: "$visaType", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  return rows.map((row) => ({ visaType: row._id || "Unspecified", count: row.count }));
}

const PRIORITY_RANK = { urgent: 5, high: 4, "Premium Processing": 3, medium: 2, "Standard Processing": 1, low: 0 };

// The case manager's currently assigned, still-active cases (not period-filtered): highest priority first, then newest.
async function assignedCasesList(caseManagerId, limit = 8) {
  const rows = await Case.find({ $and: [caseManagerMatch(objectId(caseManagerId)), COUNTABLE_CASE, { status: { $nin: ACTIVE_EXCLUDED_STATUSES } }] })
    .select("caseNumber clientName visaType priority status createdAt")
    .lean();
  return rows
    .sort((a, b) => (PRIORITY_RANK[b.priority] ?? 2) - (PRIORITY_RANK[a.priority] ?? 2) || new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit)
    .map((c) => ({ _id: c._id, caseNumber: c.caseNumber, clientName: c.clientName, visaType: c.visaType, priority: c.priority, status: c.status, createdAt: c.createdAt }));
}

// GHL stages that mean the case is finished: Approved / Disapproved (rejected). Matched by stage name so renamed keys still work.
const FINAL_STAGE_NAME = /approv|reject|denied/i;

async function finalStageMatch() {
  const config = await GHLIntegration.findOne({ locationId: env.ghl.locationId }).select("pipelines").lean().catch(() => null);
  const clauses = [];
  (config?.pipelines || []).forEach((pipeline) => {
    const keys = (pipeline.stages || []).filter((stage) => FINAL_STAGE_NAME.test(stage.name || "")).map((stage) => stage.key);
    if (keys.length) clauses.push({ "integrations.ghl.pipelineId": pipeline.ghlPipelineId, "integrations.ghl.unifiedStageKey": { $in: keys } });
  });
  return clauses;
}

// Cases sitting in a GHL stage whose name matches `include` (and not `exclude`), as $or clauses. Matched by name so renamed keys still work.
async function stageClauses(include, exclude) {
  const config = await GHLIntegration.findOne({ locationId: env.ghl.locationId }).select("pipelines").lean().catch(() => null);
  const clauses = [];
  (config?.pipelines || []).forEach((pipeline) => {
    const keys = (pipeline.stages || []).filter((stage) => include.test(stage.name || "") && !(exclude && exclude.test(stage.name || ""))).map((stage) => stage.key);
    if (keys.length) clauses.push({ "integrations.ghl.pipelineId": pipeline.ghlPipelineId, "integrations.ghl.unifiedStageKey": { $in: keys } });
  });
  return clauses;
}

// The four outcome tiles, driven by the GHL pipeline stage the case has been moved to (status is only a fallback for cases without a card).
async function outcomesSection(caseManagerFilter) {
  const [approvedStages, rejectedStages, rfeStages] = await Promise.all([
    stageClauses(/approv/i, /disapprov|unapprov/i),
    stageClauses(/disapprov|unapprov|reject|denied/i),
    stageClauses(/rfe/i),
  ]);
  const count = (clauses) => (clauses.length ? Case.countDocuments({ $and: [caseManagerFilter, { $or: clauses }] }) : 0);
  const rfeOr = [...rfeStages, { status: "rfe" }];
  const [approved, rejected, rfe, needsAttention] = await Promise.all([
    count([...approvedStages, { status: "approved" }]),
    count([...rejectedStages, { status: { $in: ["rejected", "denied"] } }]),
    count(rfeOr),
    // needs attention = any case that has gotten an RFE: in the RFE stage, or with an open RFE deadline on it
    count([...rfeOr, openRfeDeadlineFilter()]),
  ]);
  return { approved, rejected, rfe, needsAttention };
}

const trendOf = (current, previous) => {
  if (!previous) return { direction: current > 0 ? "up" : "flat", percent: null, isNew: current > 0 };
  const percent = Math.round(((current - previous) / previous) * 100);
  return { direction: percent > 0 ? "up" : percent < 0 ? "down" : "flat", percent: Math.abs(percent), isNew: false };
};

// The three headline cards. Counts follow the selected period like the rest of the panel; the trend is always "last 30 days vs the
// 30 days before": new cases for total/active (by createdAt), finished cases for closed (updatedAt is the proxy for when it closed).
async function summarySection(caseManagerId, caseManagerFilter) {
  const finals = await finalStageMatch();
  const isClosed = { $or: [{ status: { $in: ["closed", "completed", "approved", "rejected", "denied"] } }, ...finals] };
  const notClosed = { $nor: isClosed.$or };
  const mine = { $and: [caseManagerMatch(objectId(caseManagerId)), COUNTABLE_CASE] };
  const now = Date.now();
  const d30 = new Date(now - 30 * DAY_MS);
  const d60 = new Date(now - 60 * DAY_MS);
  const window = (field, from, to) => ({ [field]: to ? { $gte: from, $lt: to } : { $gte: from } });

  const [total, active, closed, totalNow, totalPrev, activeNow, activePrev, closedNow, closedPrev] = await Promise.all([
    Case.countDocuments(caseManagerFilter),
    Case.countDocuments({ $and: [caseManagerFilter, notClosed] }),
    Case.countDocuments({ $and: [caseManagerFilter, isClosed] }),
    Case.countDocuments({ $and: [mine, window("createdAt", d30)] }),
    Case.countDocuments({ $and: [mine, window("createdAt", d60, d30)] }),
    Case.countDocuments({ $and: [mine, notClosed, window("createdAt", d30)] }),
    Case.countDocuments({ $and: [mine, notClosed, window("createdAt", d60, d30)] }),
    Case.countDocuments({ $and: [mine, isClosed, window("updatedAt", d30)] }),
    Case.countDocuments({ $and: [mine, isClosed, window("updatedAt", d60, d30)] }),
  ]);
  return {
    total: { value: total, trend: trendOf(totalNow, totalPrev) },
    active: { value: active, trend: trendOf(activeNow, activePrev) },
    closed: { value: closed, trend: trendOf(closedNow, closedPrev) },
  };
}

async function buildPanel(caseManagerId, { period = "30d", staleDays = DEFAULT_STALE_DAYS } = {}) {
  // $and (not $or): sections spread this next to filters that carry their own $or. Primary + additional case manager,
  // limited to cases created in the selected period.
  const periodFilter = { $and: [caseManagerMatch(objectId(caseManagerId)), { createdAt: periodRange(period) }] };
  const caseManagerFilter = { $and: [...periodFilter.$and, COUNTABLE_CASE] };

  const [totalCasesInScope, activeTotal, caseIds] = await Promise.all([
    Case.countDocuments(caseManagerFilter),
    Case.countDocuments({ ...caseManagerFilter, status: { $nin: ACTIVE_EXCLUDED_STATUSES } }),
    // payments belong to whichever case holds them, including an employer matter, so they are not narrowed to countable cases
    Case.find(periodFilter).distinct("_id"),
  ]);

  const [attention, close, payments, activity, byVisaType, byStage, assignedCases, trend, summary, outcomes] = await Promise.all([
    attentionSection(caseManagerFilter),
    closeSection(caseManagerFilter),
    paymentsSection(caseIds),
    activitySection(caseManagerFilter, staleDays),
    byVisaTypeBreakdown(caseManagerFilter),
    byStageBreakdown(caseManagerFilter),
    assignedCasesList(caseManagerId),
    assignedTrend(caseManagerFilter, period),
    summarySection(caseManagerId, caseManagerFilter),
    outcomesSection(caseManagerFilter),
  ]);

  return {
    totalCasesInScope,
    active: { total: activeTotal },
    attention,
    close,
    payments,
    activity,
    byVisaType,
    byStage,
    assignedCases,
    trend,
    summary,
    outcomes,
  };
}

module.exports = {
  DEFAULT_STALE_DAYS,
  ACTIVE_EXCLUDED_STATUSES,
  openRfeDeadlineFilter,
  buildPanel,
};
