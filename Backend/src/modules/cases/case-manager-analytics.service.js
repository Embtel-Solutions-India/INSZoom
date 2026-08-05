const mongoose = require("mongoose");
const Case = require("../../models/Case");
const Payment = require("../../models/Payment");
const PaymentLedgerEntry = require("../../models/PaymentLedgerEntry");

// A case stays "Active" until it's actually CLOSED (an APPROVED case is still
// active work until closed out) - confirmed product decision, see the
// case-manager-analytics-panel plan. "rejected" is this schema's stand-in for
// "denied" in Case.status (the dedicated denied value lives on
// uscisDecision instead - see OUTCOME_FIELD note below).
const ACTIVE_EXCLUDED_STATUSES = ["closed", "archived", "cancelled", "rejected"];

const DEFAULT_STALE_DAYS = 14;
const RFE_LOOKAHEAD_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function objectId(value) {
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
}

function periodRange(period) {
  const now = new Date();
  if (period === "ytd") return { $gte: new Date(now.getFullYear(), 0, 1) };
  if (period === "all") return null;
  return { $gte: new Date(now.getTime() - 90 * DAY_MS) }; // "90d" default
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

// Outcome (approved/denied) is read from case.uscisDecision - the field
// purpose-built for the government's decision - not case.status/case.stage,
// which reuse "approved"/"closed" for the internal pipeline and have no
// "denied" value at all (only "rejected"). Confirmed product decision.
async function closeSection(caseManagerFilter, period) {
  const range = periodRange(period);
  const decisionFilter = range ? { uscisDecisionDate: range } : {};
  const closedFilter = range ? { updatedAt: range } : {}; // no dedicated closedAt field - documented proxy

  const [approved, denied, closed] = await Promise.all([
    Case.countDocuments({ ...caseManagerFilter, uscisDecision: "approved", ...decisionFilter }),
    Case.countDocuments({ ...caseManagerFilter, uscisDecision: "denied", ...decisionFilter }),
    Case.countDocuments({ ...caseManagerFilter, status: "closed", ...closedFilter }),
  ]);

  const decided = approved + denied;
  return { approved, denied, approvalRatio: decided ? Math.round((approved / decided) * 100) : null, closed };
}

// "Collected" is sourced from PaymentLedgerEntry - immutable rows written
// only after gateway settlement is validated (see payment.service.js's
// markTransactionSucceeded / writeLedgerEntry) - not from Payment.reconciliation.status,
// which no job in this codebase ever advances past "unreconciled". Confirmed
// product decision; see plan for the reasoning.
async function paymentsSection(caseIds, period) {
  const range = periodRange(period);
  const ledgerMatch = { "payment.resolvedCase": { $in: caseIds } };
  if (range) ledgerMatch.createdAt = range;

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

async function byVisaTypeBreakdown(caseManagerFilter) {
  const rows = await Case.aggregate([
    { $match: { ...caseManagerFilter, status: { $nin: ACTIVE_EXCLUDED_STATUSES } } },
    { $group: { _id: "$visaType", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  return rows.map((row) => ({ visaType: row._id || "Unspecified", count: row.count }));
}

async function buildPanel(caseManagerId, { period = "90d", staleDays = DEFAULT_STALE_DAYS } = {}) {
  const caseManagerFilter = { assignedCaseManager: objectId(caseManagerId) };

  const [totalCasesInScope, activeTotal, caseIds] = await Promise.all([
    Case.countDocuments(caseManagerFilter),
    Case.countDocuments({ ...caseManagerFilter, status: { $nin: ACTIVE_EXCLUDED_STATUSES } }),
    Case.find(caseManagerFilter).distinct("_id"),
  ]);

  const [attention, close, payments, activity, byVisaType] = await Promise.all([
    attentionSection(caseManagerFilter),
    closeSection(caseManagerFilter, period),
    paymentsSection(caseIds, period),
    activitySection(caseManagerFilter, staleDays),
    byVisaTypeBreakdown(caseManagerFilter),
  ]);

  return {
    totalCasesInScope,
    active: { total: activeTotal },
    attention,
    close,
    payments,
    activity,
    byVisaType,
  };
}

module.exports = {
  DEFAULT_STALE_DAYS,
  ACTIVE_EXCLUDED_STATUSES,
  openRfeDeadlineFilter,
  buildPanel,
};
