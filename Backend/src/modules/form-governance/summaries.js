// Phase 5 governance: pure helpers (no database). Turn the results of the scheduled jobs into the small run summaries the overview shows, and compute timings.
const count = (list, predicate) => (Array.isArray(list) ? list.filter(predicate).length : 0);

/** FormCatalogSyncService.runCatalogSync result -> run summary counts. */
function summarizeCatalogSync(result) {
  const results = result?.results || [];
  return {
    checked: Number(result?.published) || 0,
    changed: (Number(result?.upgradesFound) || 0) + (Number(result?.newFormsFound) || 0),
    promoted: count(results, (item) => item.outcome === "live"),
    held: count(results, (item) => item.outcome === "kept_in_review"),
    failed: count(results, (item) => item.outcome === "error" || item.outcome === "uscis_unreachable") + (Array.isArray(result?.errors) ? result.errors.length : 0),
  };
}

/** FormPipelineAutopilot.run summary -> run summary counts. */
function summarizeAutopilot(summary) {
  const forms = summary?.forms || [];
  const steps = ["registry", "editions", "fileNames", "components"].filter((name) => summary?.[name]?.error).length;
  return {
    checked: forms.length,
    changed: count(forms, (item) => item.mappingSaved || item.activated),
    promoted: count(forms, (item) => item.activated),
    held: count(forms, (item) => item.certified === false),
    failed: count(forms, (item) => item.error) + steps,
  };
}

/** FormEditionUpgradeService.upgradeTrackedForms result -> run summary counts. */
function summarizeUpgrade(result) {
  const results = result?.results || [];
  const upgraded = Array.isArray(result?.upgraded) ? result.upgraded.length : count(results, (item) => item.status === "upgraded");
  return {
    checked: Number(result?.checked) || results.length,
    changed: upgraded,
    promoted: upgraded,
    held: count(results, (item) => item.status === "queued" || item.status === "new_edition_not_ready"),
    failed: count(results, (item) => item.status === "error" || item.status === "uscis_unreachable"),
  };
}

const percentile = (sorted, fraction) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] : 0);

/** jobs: [{ stages: { [stage]: { startedAt, finishedAt } } }] (lean) -> [{ stage, count, avgMs, p95Ms }] for the stages that finished. */
function stageTimings(jobs = []) {
  const byStage = new Map();
  for (const job of jobs) {
    const stages = job?.stages instanceof Map ? Object.fromEntries(job.stages) : job?.stages || {};
    for (const [stage, info] of Object.entries(stages)) {
      const start = info?.startedAt ? new Date(info.startedAt).getTime() : NaN;
      const end = info?.finishedAt ? new Date(info.finishedAt).getTime() : NaN;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
      if (!byStage.has(stage)) byStage.set(stage, []);
      byStage.get(stage).push(end - start);
    }
  }
  return [...byStage.entries()].map(([stage, durations]) => {
    const sorted = durations.sort((a, b) => a - b);
    return { stage, count: sorted.length, avgMs: Math.round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length), p95Ms: percentile(sorted, 0.95) };
  }).sort((a, b) => a.stage.localeCompare(b.stage));
}

/** A pipeline job as the governance API shows it (no lease, no history). */
function jobSummary(job, now = new Date()) {
  const created = job?.createdAt ? new Date(job.createdAt).getTime() : now.getTime();
  const error = job?.lastError;
  return {
    jobId: String(job?._id),
    formCode: job?.formCode,
    state: job?.state,
    currentStage: job?.currentStage || error?.stage || null,
    attempts: Number(job?.attempts) || 0,
    lastError: error ? { class: error.class, code: error.code, stage: error.stage, message: error.message } : null,
    nextAttemptAt: job?.nextAttemptAt || null,
    ageMs: Math.max(now.getTime() - created, 0),
  };
}

module.exports = { summarizeCatalogSync, summarizeAutopilot, summarizeUpgrade, stageTimings, jobSummary, percentile };
