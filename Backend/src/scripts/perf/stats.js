// Small statistics helpers for the performance tooling (Rule F). Pure functions, no I/O.

/** Nearest-rank percentile of a numeric array (p in 0..100). Empty input -> null. */
function percentile(values, p) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

/** { count, min, p50, p95, p99, max, mean } of a list of latencies (ms). */
function summarize(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (!numbers.length) return { count: 0, min: null, p50: null, p95: null, p99: null, max: null, mean: null };
  return {
    count: numbers.length,
    min: Math.min(...numbers),
    p50: percentile(numbers, 50),
    p95: percentile(numbers, 95),
    p99: percentile(numbers, 99),
    max: Math.max(...numbers),
    mean: numbers.reduce((sum, value) => sum + value, 0) / numbers.length,
  };
}

module.exports = { percentile, summarize };
