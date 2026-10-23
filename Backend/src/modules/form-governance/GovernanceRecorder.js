// Phase 5 governance: the only WRITES of this module, and they are bookkeeping only (run summaries, migration reports). Everything here is fail-safe: a failure to record is
// logged and swallowed - it can never fail, slow down or change the job or migration that is being recorded. No case answers and no form content are stored.
const logger = require("../../utils/logger");

const RUN_TTL_DAYS = 90;
const OUTCOME_TTL_DAYS = 180;
const RESOLVED_TTL_DAYS = 90;
const KEEP_RUNS_PER_KIND = 200;
const MAX_LOST_EDGES = 200;
const DAY = 86400000;

const asObjectId = (value) => (/^[0-9a-f]{24}$/i.test(String(value || "")) ? String(value) : undefined); // mongoose casts the 24-hex string

function defaultStore() {
  const Run = require("../../models/FormPipelineRunSummary");
  const Report = require("../../models/FormMigrationReport");
  return {
    async insertRun(row) { await Run.create(row); },
    async pruneRuns(kind, keep) {
      const old = await Run.find({ kind }).sort({ startedAt: -1 }).skip(keep).select("_id").lean();
      if (old.length) await Run.deleteMany({ _id: { $in: old.map((item) => item._id) } });
    },
    async upsertFrozen(row) {
      await Report.updateOne({ kind: "frozen", caseFormId: row.caseFormId, resolved: false }, { $set: row, $unset: { expireAt: "" } }, { upsert: true });
    },
    async resolveFrozenNotIn(formCode, caseFormIds, at) {
      await Report.updateMany(
        { kind: "frozen", formCode, resolved: false, ...(caseFormIds.length ? { caseFormId: { $nin: caseFormIds } } : {}) },
        { $set: { resolved: true, resolvedAt: at, expireAt: new Date(at.getTime() + RESOLVED_TTL_DAYS * DAY) } }
      );
    },
    async insertOutcome(row) { await Report.create(row); },
  };
}

/** Records one scheduled run. Never throws. `row` = { startedAt, finishedAt?, checked?, changed?, promoted?, held?, failed?, error? } */
async function recordRun(kind, row = {}, { store, now = () => new Date() } = {}) {
  try {
    const finishedAt = row.finishedAt || now();
    const startedAt = row.startedAt || finishedAt;
    const doc = {
      kind, startedAt, finishedAt, durationMs: Math.max(finishedAt.getTime() - startedAt.getTime(), 0),
      checked: row.checked || 0, changed: row.changed || 0, promoted: row.promoted || 0, held: row.held || 0, failed: row.failed || 0,
      ...(row.error ? { error: String(row.error).slice(0, 500) } : {}),
      expireAt: new Date(finishedAt.getTime() + RUN_TTL_DAYS * DAY),
    };
    const target = store || defaultStore();
    await target.insertRun(doc);
    await target.pruneRuns(kind, KEEP_RUNS_PER_KIND);
    return doc;
  } catch (error) {
    logger.warn("form_governance_run_record_failed", { kind, error: error.message });
    return null;
  }
}

/**
 * Runs `task`, then records its summary. The task's result (or error) is passed through untouched; recording happens after it and can never change either.
 * summarize(result) -> counts. A summarize that throws is recorded as an empty summary.
 */
async function timedRun(kind, task, summarize, deps = {}) {
  const now = deps.now || (() => new Date());
  const startedAt = now();
  let result;
  try {
    result = await task();
  } catch (error) {
    await recordRun(kind, { startedAt, failed: 1, error: error?.message || "failed" }, deps);
    throw error;
  }
  let counts = {};
  try { counts = summarize ? summarize(result) || {} : {}; } catch { counts = {}; }
  await recordRun(kind, { startedAt, ...counts }, deps);
  return result;
}

/**
 * Records what a case-form edition migration left behind: the frozen case forms (open until a later migration stops reporting them) and one outcome row with the counts and the
 * edges the new edition lost. Never throws; nothing here reads or stores an answer.
 */
async function recordMigrationOutcome({ template, caseMigration, lostEdges } = {}, { store, now = () => new Date() } = {}) {
  try {
    if (!template || (!caseMigration && !(lostEdges && lostEdges.length))) return null;
    const formCode = String(template.formCode || "").toUpperCase();
    if (!formCode) return null;
    const at = now();
    const target = store || defaultStore();
    const frozen = (caseMigration?.frozenReport || []).filter((item) => asObjectId(item.caseFormId));
    for (const item of frozen) {
      await target.upsertFrozen({
        kind: "frozen", formCode, templateId: asObjectId(template._id), caseFormId: asObjectId(item.caseFormId), caseId: asObjectId(item.caseId), caseNumber: item.caseNumber || undefined,
        status: item.status, fromEdition: item.fromEdition || undefined, toEdition: item.toEdition || template.version, priority: Boolean(item.priority), resolved: false, reportedAt: at,
      });
    }
    if (caseMigration) await target.resolveFrozenNotIn(formCode, frozen.map((item) => asObjectId(item.caseFormId)), at);
    const lost = (lostEdges || []).slice(0, MAX_LOST_EDGES).map((edge) => ({
      targetFieldId: edge.targetFieldId || edge.mappingId || edge.targetPdfField || null,
      sourcePath: edge.sourcePath || null,
      reason: edge.reason || "field_removed_in_new_edition",
      ...(edge.targetLabel ? { label: String(edge.targetLabel).slice(0, 120) } : {}),
    }));
    await target.insertOutcome({
      kind: "outcome", formCode, templateId: asObjectId(template._id), toEdition: template.version, reportedAt: at, expireAt: new Date(at.getTime() + OUTCOME_TTL_DAYS * DAY),
      counts: caseMigration ? {
        considered: caseMigration.considered || 0, migrated: caseMigration.migrated || 0, verified: caseMigration.verified || 0, skippedFrozen: caseMigration.skippedFrozen || 0,
        unresolved: (caseMigration.unresolved || []).length, reconciliationRequired: (caseMigration.reconciliationRequired || []).length, failed: (caseMigration.failed || []).length,
      } : undefined,
      lostEdges: lost.length ? lost : undefined,
    });
    return { frozen: frozen.length, lostEdges: lost.length };
  } catch (error) {
    logger.warn("form_governance_migration_record_failed", { formCode: template?.formCode, error: error.message });
    return null;
  }
}

module.exports = { recordRun, timedRun, recordMigrationOutcome, defaultStore, KEEP_RUNS_PER_KIND, RUN_TTL_DAYS };
