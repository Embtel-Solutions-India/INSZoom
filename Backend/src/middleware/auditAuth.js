const AuditLog = require("../models/AuditLog");

function auditAuth(action) {
  return async (req, res, next) => {
    res.on("finish", async () => {
      try {
        await AuditLog.create({
          userId: req.user?._id || res.locals.authUserId,
          userRole: req.user?.role || res.locals.authUserRole,
          action,
          entityType: "auth",
          entityId: req.user?._id?.toString() || res.locals.authUserId?.toString(),
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
          browser: req.get("sec-ch-ua") || req.get("user-agent"),
          status: res.statusCode >= 400 ? "failure" : "success",
          severity: res.statusCode >= 400 ? "medium" : "low",
          source: "auth",
          details: `${action} completed with status ${res.statusCode}`,
        });
      } catch (error) {
        console.error("Failed to write auth audit log:", error.message);
      }
    });
    next();
  };
}

module.exports = auditAuth;
