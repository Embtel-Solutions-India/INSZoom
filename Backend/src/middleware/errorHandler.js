const logger = require("../utils/logger");

function errorHandler(error, req, res, next) {
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
