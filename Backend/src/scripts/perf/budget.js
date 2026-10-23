// The performance budget comparison (plan decision 15). The tolerances below are the PROPOSED numbers; the plan says the user approves the FINAL numbers after the baseline is
// recorded and BEFORE any comparison, so a comparison needs them passed in explicitly with `approved: true` - otherwise the result is marked `provisional` and can never pass.
const PROPOSED_TOLERANCES = Object.freeze({
  p50Pct: 5, // endpoint p50 latency may grow by at most 5%
  p95Pct: 10, // endpoint p95 by at most 10%
  eventLoopP99Ms: 10, // event-loop p99 delay during a pipeline job: at most +10 ms over baseline
  eventLoopMaxMs: 50, // and max: at most +50 ms
});

const pctOver = (baseline, candidate) => (baseline > 0 ? ((candidate - baseline) / baseline) * 100 : candidate > 0 ? Infinity : 0);

/**
 * baseline / candidate: { endpoints: { [name]: { p50, p95 } }, eventLoop: { p99, max }, dbCalls: { [name]: n } } (milliseconds, whole call counts).
 * Returns { provisional, passed, results: [{ metric, baseline, candidate, limit, delta, ok }], hardFailures } - hardFailures are the non-budget checks (added hot-path DB calls).
 */
function compareToBaseline(baseline, candidate, { tolerances = PROPOSED_TOLERANCES, approved = false } = {}) {
  const results = [];
  const check = (metric, base, cand, limit, delta, ok) => results.push({ metric, baseline: base, candidate: cand, limit, delta, ok });
  for (const [name, base] of Object.entries(baseline.endpoints || {})) {
    const cand = candidate.endpoints?.[name];
    if (!cand) { check(`${name} (missing from candidate run)`, base.p50, null, null, null, false); continue; }
    const d50 = pctOver(base.p50, cand.p50);
    const d95 = pctOver(base.p95, cand.p95);
    check(`${name} p50`, base.p50, cand.p50, `+${tolerances.p50Pct}%`, `${d50.toFixed(1)}%`, d50 <= tolerances.p50Pct);
    check(`${name} p95`, base.p95, cand.p95, `+${tolerances.p95Pct}%`, `${d95.toFixed(1)}%`, d95 <= tolerances.p95Pct);
  }
  if (baseline.eventLoop) {
    const cand = candidate.eventLoop;
    const d99 = cand ? cand.p99 - baseline.eventLoop.p99 : null;
    const dMax = cand ? cand.max - baseline.eventLoop.max : null;
    check("event-loop p99", baseline.eventLoop.p99, cand?.p99 ?? null, `+${tolerances.eventLoopP99Ms} ms`, d99 === null ? null : `${d99.toFixed(1)} ms`, d99 !== null && d99 <= tolerances.eventLoopP99Ms);
    check("event-loop max", baseline.eventLoop.max, cand?.max ?? null, `+${tolerances.eventLoopMaxMs} ms`, dMax === null ? null : `${dMax.toFixed(1)} ms`, dMax !== null && dMax <= tolerances.eventLoopMaxMs);
  }
  const hardFailures = [];
  for (const [name, base] of Object.entries(baseline.dbCalls || {})) {
    const cand = candidate.dbCalls?.[name];
    if (cand === undefined || cand > base) hardFailures.push({ metric: `${name} DB calls`, baseline: base, candidate: cand ?? null });
  }
  const provisional = approved !== true;
  return { provisional, passed: !provisional && results.every((row) => row.ok) && hardFailures.length === 0, results, hardFailures };
}

module.exports = { PROPOSED_TOLERANCES, compareToBaseline };
