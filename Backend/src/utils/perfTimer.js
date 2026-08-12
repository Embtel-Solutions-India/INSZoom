const logger = require("./logger");

// Previously this returned false outright whenever NODE_ENV === "production"
// (same bug already fixed in config/database.js's query profiler) — meaning
// request_performance, and every createPerfTimer() stage breakdown, was
// silently never logged in production at all. That's the opposite of what's
// needed to diagnose a production 504: it's now always on, opt-out only via
// PERF_LOGS=false, matching the query profiler's contract.
function enabled() {
  return process.env.PERF_LOGS !== "false";
}

function createPerfTimer(name, base = {}) {
  const startedAt = Date.now();
  let lastAt = startedAt;
  const stages = [];
  return {
    mark(stage, meta = {}) {
      if (!enabled()) return;
      const now = Date.now();
      stages.push({ stage, durationMs: now - lastAt, ...meta });
      lastAt = now;
    },
    done(meta = {}) {
      if (!enabled()) return { durationMs: Date.now() - startedAt, stages };
      const payload = { ...base, ...meta, durationMs: Date.now() - startedAt, stages };
      logger.info(name, payload);
      return payload;
    },
  };
}

function perfMiddleware(req, res, next) {
  if (!enabled()) return next();
  const startedAt = Date.now();
  res.on("finish", () => {
    logger.info("request_performance", {
      requestId: req.requestId,
      method: req.method,
      route: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      userId: req.user?._id,
    });
  });
  next();
}

module.exports = { createPerfTimer, perfMiddleware };
