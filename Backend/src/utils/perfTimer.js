const logger = require("./logger");
const env = require("../config/env");

function enabled() {
  return env.nodeEnv !== "production" && process.env.PERF_LOGS !== "false";
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
