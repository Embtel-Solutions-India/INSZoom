// Event-loop delay + heap meter (Rule F: "event-loop delay during a pipeline run"). Wraps perf_hooks.monitorEventLoopDelay; reports milliseconds. In-process only - it measures
// the process it is started in, so the intended use is: start it inside the API process (or a test harness) while a pipeline job runs, then stop it and compare to the baseline.
const { monitorEventLoopDelay } = require("node:perf_hooks");

const NS_PER_MS = 1e6;

function createLagMeter({ resolutionMs = 10, monitor = monitorEventLoopDelay, memory = () => process.memoryUsage() } = {}) {
  const histogram = monitor({ resolution: resolutionMs });
  let startedHeap = null;
  let running = false;
  return {
    start() {
      if (running) return;
      histogram.reset();
      startedHeap = memory().heapUsed;
      histogram.enable();
      running = true;
    },
    /** Stops and returns { p50, p99, max (ms), heapGrowthBytes }. Safe to call twice. */
    stop() {
      if (running) histogram.disable();
      running = false;
      const snapshot = {
        p50: histogram.percentile(50) / NS_PER_MS,
        p99: histogram.percentile(99) / NS_PER_MS,
        max: histogram.max / NS_PER_MS,
        heapGrowthBytes: startedHeap === null ? null : memory().heapUsed - startedHeap,
      };
      return snapshot;
    },
  };
}

/** Runs `work` (async) while metering, returns { result, lag }. The meter is always stopped, even when work throws. */
async function measureLag(work, options) {
  const meter = createLagMeter(options);
  meter.start();
  try {
    const result = await work();
    return { result, lag: meter.stop() };
  } catch (error) {
    meter.stop();
    throw error;
  }
}

module.exports = { createLagMeter, measureLag };
