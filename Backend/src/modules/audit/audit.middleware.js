const { recordAuditEvent } = require("./audit.service");

function auditAction(action, options = {}) {
  return function auditMiddleware(req, res, next) {
    res.on("finish", () => {
      if (res.statusCode >= 500) return;
      const status = res.statusCode >= 400 ? "failure" : "success";
      recordAuditEvent({
        req,
        action,
        entityType: options.entityType || req.baseUrl?.split("/").filter(Boolean).pop() || "api",
        entityId: options.entityId?.(req) || req.params?.id,
        details: options.details?.(req, res) || `${req.method} ${req.originalUrl}`,
        severity: options.severity || (status === "failure" ? "medium" : "low"),
        status,
        source: "api",
      }).catch(() => {});
    });
    next();
  };
}

module.exports = auditAction;
