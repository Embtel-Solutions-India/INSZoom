const AuditLog = require("../../models/AuditLog");

function buildDateFilter(query) {
  const createdAt = {};
  if (query.from) createdAt.$gte = new Date(query.from);
  if (query.to) createdAt.$lte = new Date(query.to);
  return Object.keys(createdAt).length ? { createdAt } : {};
}

function buildAuditFilter(query = {}) {
  const filter = { ...buildDateFilter(query) };
  if (query.action) filter.action = query.action;
  if (query.entityType) filter.entityType = query.entityType;
  if (query.entityId) filter.entityId = query.entityId;
  if (query.userId) filter.userId = query.userId;
  if (query.role) filter.userRole = query.role;
  if (query.status) filter.status = query.status;
  if (query.severity) filter.severity = query.severity;
  if (query.source) filter.source = query.source;
  if (query.search) {
    filter.$or = [
      { action: { $regex: query.search, $options: "i" } },
      { entityType: { $regex: query.search, $options: "i" } },
      { details: { $regex: query.search, $options: "i" } },
    ];
  }
  return filter;
}

function getPagination(query = {}) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 25, 1), 200);
  return { page, limit, skip: (page - 1) * limit };
}

async function listAuditLogs(query = {}) {
  const filter = buildAuditFilter(query);
  const { page, limit, skip } = getPagination(query);
  const [items, total] = await Promise.all([
    AuditLog.find(filter)
      .populate("userId", "name displayName email role")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AuditLog.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 } };
}

async function getAuditLog(id) {
  return AuditLog.findById(id).populate("userId", "name displayName email role").lean();
}

async function getAuditSummary(query = {}) {
  const filter = buildAuditFilter(query);
  const [byAction, byEntity, bySeverity, byStatus, total] = await Promise.all([
    AuditLog.aggregate([{ $match: filter }, { $group: { _id: "$action", count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 25 }]),
    AuditLog.aggregate([{ $match: filter }, { $group: { _id: "$entityType", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    AuditLog.aggregate([{ $match: filter }, { $group: { _id: "$severity", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    AuditLog.aggregate([{ $match: filter }, { $group: { _id: "$status", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    AuditLog.countDocuments(filter),
  ]);
  return { total, byAction, byEntity, bySeverity, byStatus };
}

function toCsv(rows) {
  const columns = ["createdAt", "action", "entityType", "entityId", "user", "userRole", "status", "severity", "source", "ipAddress", "details"];
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = [columns.join(",")];
  rows.forEach((row) => {
    lines.push(columns.map((column) => {
      if (column === "user") return escape(row.userId?.email || row.userId?._id || row.userId || "");
      return escape(row[column]);
    }).join(","));
  });
  return lines.join("\n");
}

async function exportAuditLogs(query = {}) {
  const result = await listAuditLogs({ ...query, page: 1, limit: query.limit || 1000 });
  return toCsv(result.items);
}

async function recordAuditEvent({ req, action, entityType = "system", entityId, details, previousValue, newValue, severity = "low", status = "success", source = "api", metadata = {} }) {
  return AuditLog.create({
    action,
    entityType,
    entityId,
    details,
    previousValue,
    newValue,
    severity,
    status,
    source,
    metadata,
    userId: req?.user?._id,
    userRole: req?.user?.role,
    ipAddress: req?.ip,
    userAgent: req?.get?.("user-agent"),
    browser: req?.get?.("sec-ch-ua") || req?.get?.("user-agent"),
  });
}

module.exports = {
  buildAuditFilter,
  exportAuditLogs,
  getAuditLog,
  getAuditSummary,
  listAuditLogs,
  recordAuditEvent,
};
