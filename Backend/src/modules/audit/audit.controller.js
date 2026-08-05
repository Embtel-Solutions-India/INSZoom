const auditService = require("./audit.service");

async function list(req, res, next) {
  try {
    const result = await auditService.listAuditLogs(req.query);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

async function summary(req, res, next) {
  try {
    const data = await auditService.getAuditSummary(req.query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function getById(req, res, next) {
  try {
    const item = await auditService.getAuditLog(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: "Audit log not found" });
    res.json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
}

async function byEntity(req, res, next) {
  try {
    const result = await auditService.listAuditLogs({ ...req.query, entityType: req.params.entityType, entityId: req.params.entityId });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

async function byUser(req, res, next) {
  try {
    const result = await auditService.listAuditLogs({ ...req.query, userId: req.params.userId });
    res.json({ success: true, logs: result.items, items: result.items, pagination: result.pagination });
  } catch (error) {
    next(error);
  }
}

async function exportCsv(req, res, next) {
  try {
    const csv = await auditService.exportAuditLogs(req.query);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=audit-log.csv");
    res.send(csv);
  } catch (error) {
    next(error);
  }
}

module.exports = { byEntity, byUser, exportCsv, getById, list, summary };
