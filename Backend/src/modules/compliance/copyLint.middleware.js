const copyLintService = require("./copyLint.service");
const auditService = require("../audit/audit.service");

// Express guard for write routes that accept client-facing copy. Scans the
// named body fields; on a "block" verdict, rejects the write outright (never
// silently strips the offending text) and audits the block. "warn"-only
// verdicts pass through — the caller can still read req.copyLintWarnings if
// it wants to surface them.
function guardFields(fields) {
  return async function copyLintGuard(req, res, next) {
    try {
      const combined = fields
        .map((field) => req.body?.[field])
        .filter((value) => typeof value === "string" && value.trim())
        .join("\n");
      if (!combined) return next();

      const result = await copyLintService.scan(combined);
      if (result.severity === "block") {
        await auditService.recordAuditEvent({
          req,
          action: "copylint.block",
          entityType: "Copy",
          details: `Blocked write containing prohibited terms: ${result.violations.map((v) => v.term).join(", ")}`,
          severity: "high",
          status: "blocked",
          metadata: { fields, violations: result.violations },
        });
        return res.status(422).json({
          success: false,
          message: "This copy contains prohibited language and cannot be saved.",
          violations: result.violations,
        });
      }

      req.copyLintWarnings = result.violations.filter((v) => v.severity === "warn");
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { guardFields };
