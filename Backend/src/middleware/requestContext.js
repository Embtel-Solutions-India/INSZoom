const crypto = require("crypto");
const logger = require("../utils/logger");

function requestContext(req, res, next) {
  const incomingId = req.headers["x-request-id"] || req.headers["x-correlation-id"];
  const requestId = String(incomingId || crypto.randomUUID());
  const startedAt = process.hrtime.bigint();

  req.requestId = requestId;
  req.correlationId = requestId;
  res.setHeader("X-Request-Id", requestId);

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logger.info("http_request", {
      requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs),
      userId: req.user?._id,
      role: req.user?.role,
    });
  });

  next();
}

module.exports = requestContext;
