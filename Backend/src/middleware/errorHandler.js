const logger = require("../utils/logger");

// GET /api/uscis-forms/case/:caseId (and any other endpoint hitting a dead/
// slow MongoDB connection) used to surface as a bare 500 after the request
// hung for tens of seconds - the frontend then had nothing to distinguish
// that from "the case genuinely has zero forms", and collapsed both to an
// empty list. These are the MongoDB driver's own error class names for a
// connectivity/timeout failure (as opposed to a query/validation bug in our
// own code) - recognizing them lets a database outage answer honestly and
// quickly instead of looking identical to "nothing to show here."
const DATABASE_UNAVAILABLE_ERROR_NAMES = new Set([
  "MongoNetworkTimeoutError",
  "MongoNetworkError",
  "MongoServerSelectionError",
  "MongooseServerSelectionError",
  "MongoTimeoutError",
  "MongoWriteConcernError",
  "MongoPoolClosedError",
]);

// code 50 / codeName "MaxTimeMSExpired": a query bounded with .maxTimeMS()
// (used by uscis-form.service.js's getAccessibleCase to fail fast against a
// degraded primary instead of hanging for the full socket timeout) ran out
// of its budget server-side - the same "can't get an answer from the
// database right now" condition as the network-level errors above, just
// surfaced as a server error instead of a connection error.
function isDatabaseUnavailableError(error) {
  if (error?.code === 50 || error?.codeName === "MaxTimeMSExpired") return !error.status && !error.statusCode;
  return DATABASE_UNAVAILABLE_ERROR_NAMES.has(error?.name) && !error.status && !error.statusCode;
}

function errorHandler(error, req, res, next) {
  if (isDatabaseUnavailableError(error)) {
    logger.error("request_error", {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: 503,
      userId: req.user?._id,
      role: req.user?.role,
      error,
    });
    return res.status(503).json({
      success: false,
      message: "Unable to complete this request because the database is temporarily unavailable. Please try again shortly.",
      errorCode: "DATABASE_UNAVAILABLE",
      code: "DATABASE_UNAVAILABLE",
      requestId: req.requestId,
    });
  }
  const status = error.status || error.statusCode || 500;

  const exposeMessage = status < 500 || process.env.EXPOSE_INTERNAL_ERRORS === "true";
  const payload = {
    success: false,
    message: exposeMessage ? error.message : "Internal server error",
    requestId: req.requestId,
  };
  if (error.code) payload.code = error.code;
  if (error.code) payload.errorCode = error.code;
  else if (status >= 500) payload.errorCode = "INTERNAL_SERVER_ERROR";
  if (error.details) payload.details = error.details;
  if (error.issues) payload.issues = error.issues;
  if (error.validation) payload.validation = error.validation;

  if (process.env.NODE_ENV === "development" && error.stack) {
    payload.stack = error.stack;
  }

  logger[status >= 500 ? "error" : "warn"]("request_error", {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl || req.url,
    statusCode: status,
    userId: req.user?._id,
    role: req.user?.role,
    error,
  });
  res.status(status).json(payload);
}

module.exports = errorHandler;
module.exports.isDatabaseUnavailableError = isDatabaseUnavailableError;
