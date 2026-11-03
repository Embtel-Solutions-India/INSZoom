// Pure planning of which pages go to the AI together. No I/O, so every property (each page exactly once, resume with no gap or overlap,
// splitting keeps coverage) is proven by plain unit tests.

function wholeAtLeast(value, min, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.max(min, number) : fallback;
}

/**
 * Splits pages [startPage .. min(totalPages, maxPages)] into consecutive batches of at most `batchSize` pages.
 * Returns { batches: [{from, to}], lastPage, skippedFrom } - lastPage is the last page that will be scanned, skippedFrom the first page
 * left out by the page cap (null when nothing is left out).
 */
function planBatches({ totalPages, batchSize = 4, startPage = 1, maxPages = Infinity }) {
  const total = wholeAtLeast(totalPages, 0, 0);
  const size = wholeAtLeast(batchSize, 1, 1);
  const start = wholeAtLeast(startPage, 1, 1);
  const cap = maxPages === Infinity ? total : wholeAtLeast(maxPages, 0, total);
  const lastPage = Math.min(total, cap);
  const batches = [];
  for (let from = start; from <= lastPage; from += size) batches.push({ from, to: Math.min(lastPage, from + size - 1) });
  return { batches, lastPage, skippedFrom: total > lastPage ? lastPage + 1 : null };
}

/** Halves a batch (used when an answer was cut off). A one-page batch cannot be split: returns null. */
function splitBatch(batch) {
  if (!batch || batch.to <= batch.from) return null;
  const middle = Math.floor((batch.from + batch.to) / 2);
  return [{ from: batch.from, to: middle }, { from: middle + 1, to: batch.to }];
}

/** Absolute page of a page index the model reported relative to its slice (1 = first page of the slice). Null when outside the slice. */
function toAbsolutePage(batch, pageInSlice) {
  const index = Number(pageInSlice);
  if (!Number.isInteger(index) || index < 1) return null;
  const page = batch.from + index - 1;
  return page <= batch.to ? page : null;
}

/** Safety helper: every page of firstPage..lastPage appears exactly once across the batches, in order. */
function coversExactlyOnce(batches, firstPage, lastPage) {
  let expected = firstPage;
  for (const batch of batches) {
    if (batch.from !== expected || batch.to < batch.from) return false;
    expected = batch.to + 1;
  }
  return expected === lastPage + 1;
}

module.exports = { planBatches, splitBatch, toAbsolutePage, coversExactlyOnce };
