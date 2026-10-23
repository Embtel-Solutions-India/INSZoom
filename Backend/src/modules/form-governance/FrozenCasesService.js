// Phase 5 governance: the case forms that stayed on an old edition because they are finalized / filed / locked (plan Rule G), read from the FormMigrationReport rows the
// migration recorder wrote. Read-only. The newest row per case form wins; a resolved row (a later migration no longer reports it) is not listed.
const MAX_ROWS = 500;

const defaultModel = () => require("../../models/FormMigrationReport");

const presentFrozen = (row) => ({
  formCode: row.formCode,
  caseFormId: String(row.caseFormId),
  caseId: row.caseId ? String(row.caseId) : null,
  caseNumber: row.caseNumber || null,
  status: row.status,
  fromEdition: row.fromEdition || null,
  toEdition: row.toEdition || null,
  priority: Boolean(row.priority),
  reportedAt: row.reportedAt,
});

/** Pure. Newest row per caseFormId, resolved ones dropped, priority first then newest. */
function currentFrozen(rows = []) {
  const newest = new Map();
  for (const row of rows) {
    if (!row.caseFormId) continue;
    const key = String(row.caseFormId);
    const seen = newest.get(key);
    if (!seen || new Date(row.reportedAt) > new Date(seen.reportedAt)) newest.set(key, row);
  }
  return [...newest.values()].filter((row) => !row.resolved).map(presentFrozen)
    .sort((a, b) => Number(b.priority) - Number(a.priority) || new Date(b.reportedAt) - new Date(a.reportedAt));
}

/** Pure. Newest outcome row per form -> summed unresolved / reconciliation counts (they describe the latest migration of each form). */
function outcomeTotals(rows = []) {
  const newest = new Map();
  for (const row of rows) {
    const seen = newest.get(row.formCode);
    if (!seen || new Date(row.reportedAt) > new Date(seen.reportedAt)) newest.set(row.formCode, row);
  }
  let unresolved = 0;
  let reconciliationRequired = 0;
  for (const row of newest.values()) {
    unresolved += row.counts?.unresolved || 0;
    reconciliationRequired += row.counts?.reconciliationRequired || 0;
  }
  return { unresolved, reconciliationRequired };
}

async function frozenCases({ model = defaultModel() } = {}) {
  const frozenRows = await model.find({ kind: "frozen" }).sort({ reportedAt: -1 }).limit(MAX_ROWS * 4).lean();
  const outcomeRows = await model.aggregate([
    { $match: { kind: "outcome" } },
    { $sort: { reportedAt: -1 } },
    { $group: { _id: "$formCode", formCode: { $first: "$formCode" }, counts: { $first: "$counts" }, reportedAt: { $first: "$reportedAt" } } },
  ]);
  const items = currentFrozen(frozenRows).slice(0, MAX_ROWS);
  return { total: items.length, items, ...outcomeTotals(outcomeRows) };
}

/** Open frozen case forms (distinct, unresolved). */
async function frozenOpenCount({ model = defaultModel() } = {}) {
  const ids = await model.distinct("caseFormId", { kind: "frozen", resolved: false });
  return ids.length;
}

module.exports = { frozenCases, frozenOpenCount, currentFrozen, outcomeTotals };
