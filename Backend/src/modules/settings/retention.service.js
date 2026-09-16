// §4.4 Data & Compliance retention. Reads data.retention.* live on every
// run (see settings/registry/data.registry.js) — no restart is needed for
// a changed retention window to take effect on the next tick, and the
// mongo-atomic withJobLock() in server.js already keeps this safe if the
// backend is ever run as more than one instance.
const AuditLog = require("../../models/AuditLog");
const settingsEngine = require("./settingsEngine.service");

async function purgeExpiredAuditLogs() {
  const days = await settingsEngine.getEffective("data.retention.auditLogDays", {});
  if (!days || days <= 0) return { purged: 0, skipped: true, reason: "retention disabled (0 days)" };
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const result = await AuditLog.deleteMany({ createdAt: { $lt: cutoff } });
  return { purged: result.deletedCount, cutoff, days };
}

async function runRetentionSweep() {
  const auditLogs = await purgeExpiredAuditLogs();
  return { auditLogs };
}

module.exports = { purgeExpiredAuditLogs, runRetentionSweep };
