const AuditLog = require("../../models/AuditLog");
const Beneficiary = require("../../models/Beneficiary");
const Case = require("../../models/Case");
const Company = require("../../models/Company");
const Document = require("../../models/Document");
const EODReport = require("../../models/EODReport");
const Message = require("../../models/Message");
const Payment = require("../../models/Payment");
const ReportExecution = require("../../models/ReportExecution");
const ReportTemplate = require("../../models/ReportTemplate");
const User = require("../../models/User");
const Workflow = require("../../models/Workflow");
const Task = require("../../models/Task");
const { recordAuditEvent } = require("../audit/audit.service");
const { normalizeRole } = require("../authorization/roleHierarchy");

const IST_OFFSET_MS = 330 * 60 * 1000;
const EOD_STAFF_ROLES = ["team_lead", "sales_manager", "case_manager", "attorney", "professor", "finance", "paralegal", "reviewer", "hr"];
const EOD_MANAGER_ROLES = ["super_admin", "admin", "team_lead"];

function serviceError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function startOfIstDay(value = new Date(), dayOffset = 0) {
  const shifted = new Date(new Date(value).getTime() + IST_OFFSET_MS);
  const utcMidnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + dayOffset
  );
  return new Date(utcMidnight - IST_OFFSET_MS);
}

function istDayRange(value = new Date(), dayOffset = 0) {
  const start = startOfIstDay(value, dayOffset);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

function eodPeriodMatch(query = {}) {
  if (query.from || query.to) return dateMatch(query, "date");
  const now = new Date();
  if (query.period === "today") {
    const { start, end } = istDayRange(now);
    return { date: { $gte: start, $lt: end } };
  }
  if (query.period === "this_week") {
    const shifted = new Date(now.getTime() + IST_OFFSET_MS);
    const weekday = shifted.getUTCDay() || 7;
    const start = startOfIstDay(now, 1 - weekday);
    return { date: { $gte: start, $lt: istDayRange(now).end } };
  }
  if (query.period === "this_month") {
    const shifted = new Date(now.getTime() + IST_OFFSET_MS);
    const start = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - IST_OFFSET_MS);
    return { date: { $gte: start, $lt: istDayRange(now).end } };
  }
  return {};
}

function numericMetric(value, field) {
  const number = value === "" || value === undefined || value === null ? 0 : Number(value);
  if (!Number.isFinite(number) || number < 0) throw serviceError(`${field} must be a non-negative number`);
  return number;
}

function manualReportPayload(payload = {}, user) {
  const role = normalizeRole(user?.role);
  if (!EOD_STAFF_ROLES.includes(role)) throw serviceError("This role does not submit EOD reports", 403);
  return {
    staff: user._id,
    role,
    teamId: user.teamId || undefined,
    department: user.department || undefined,
    date: startOfIstDay(payload.date || new Date()),
    casesWorked: numericMetric(payload.casesWorked, "Cases worked"),
    casesClosed: numericMetric(payload.casesClosed, "Cases closed"),
    documentsReviewed: numericMetric(payload.documentsReviewed, "Documents reviewed"),
    messagesReplied: numericMetric(payload.messagesReplied, "Messages replied"),
    pendingTasks: numericMetric(payload.pendingTasks, "Pending tasks"),
    hoursWorked: numericMetric(payload.hoursWorked, "Hours worked"),
    blockers: String(payload.blockers || "").trim(),
    notes: String(payload.notes || "").trim(),
    source: "manual",
    generatedAt: new Date(),
  };
}

async function eodVisibilityFilter(query = {}, user) {
  const role = normalizeRole(user?.role);
  const filter = { ...eodPeriodMatch(query) };
  if (["super_admin", "admin"].includes(role)) {
    if (query.staff) filter.staff = query.staff;
    if (query.role) filter.role = query.role;
  } else if (role === "team_lead") {
    const staffIds = await User.find({
      isActive: { $ne: false },
      $or: [
        ...(user.teamId ? [{ teamId: user.teamId }] : []),
        { _id: user._id },
      ],
    }).distinct("_id");
    filter.staff = { $in: staffIds };
    if (query.role) filter.role = query.role;
  } else {
    filter.staff = user._id;
  }
  if (query.status === "reviewed") filter.reviewed = true;
  if (query.status === "pending") filter.reviewed = false;
  if (query.source && EOD_MANAGER_ROLES.includes(role)) filter.source = query.source;
  return filter;
}

function dateMatch(query = {}, field = "createdAt") {
  const range = {};
  if (query.from) range.$gte = new Date(query.from);
  if (query.to) range.$lte = new Date(query.to);
  return Object.keys(range).length ? { [field]: range } : {};
}

function pagination(query = {}) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 25, 1), 200);
  return { page, limit, skip: (page - 1) * limit };
}

function moneyExpression() {
  return {
    $ifNull: [
      "$amountPaid",
      {
        $ifNull: [
          "$paidAmount",
          {
            $ifNull: ["$totalAmount", "$totalFee"],
          },
        ],
      },
    ],
  };
}

async function getCaseReport(query = {}) {
  const match = dateMatch(query);
  const [volume, byStatus, byStage, byType, byPriority, aging, approvalRates] = await Promise.all([
    Case.countDocuments(match),
    Case.aggregate([{ $match: match }, { $group: { _id: "$status", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    Case.aggregate([{ $match: match }, { $group: { _id: "$stage", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    Case.aggregate([{ $match: match }, { $group: { _id: "$caseType", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    Case.aggregate([{ $match: match }, { $group: { _id: "$priority", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    Case.aggregate([
      { $match: match },
      { $project: { ageDays: { $dateDiff: { startDate: "$createdAt", endDate: "$$NOW", unit: "day" } }, status: 1 } },
      { $group: { _id: null, averageAgeDays: { $avg: "$ageDays" }, maxAgeDays: { $max: "$ageDays" }, openCases: { $sum: { $cond: [{ $in: ["$status", ["active", "pending", "in_progress"]] }, 1, 0] } } } },
    ]),
    Case.aggregate([
      { $match: match },
      { $group: { _id: null, approved: { $sum: { $cond: [{ $in: ["$status", ["approved", "completed", "closed"]] }, 1, 0] } }, denied: { $sum: { $cond: [{ $in: ["$status", ["rejected", "denied"]] }, 1, 0] } }, total: { $sum: 1 } } },
      { $project: { approved: 1, denied: 1, total: 1, approvalRate: { $cond: [{ $gt: ["$total", 0] }, { $multiply: [{ $divide: ["$approved", "$total"] }, 100] }, 0] } } },
    ]),
  ]);
  return { volume, byStatus, byStage, byType, byPriority, aging: aging[0] || {}, approvalRates: approvalRates[0] || {} };
}

async function getFinancialReport(query = {}) {
  const match = dateMatch(query);
  const paidStatuses = ["paid", "succeeded", "partially_paid", "partial"];
  const [totals, byStatus, trends, refunds, outstanding] = await Promise.all([
    Payment.aggregate([
      { $match: match },
      { $group: { _id: null, revenue: { $sum: moneyExpression() }, invoices: { $sum: 1 }, outstanding: { $sum: { $ifNull: ["$remainingAmount", 0] } }, refunded: { $sum: { $ifNull: ["$refundedAmount", 0] } } } },
    ]),
    Payment.aggregate([{ $match: match }, { $group: { _id: "$status", count: { $sum: 1 }, amount: { $sum: moneyExpression() } } }, { $sort: { count: -1 } }]),
    Payment.aggregate([
      { $match: { ...match, status: { $in: paidStatuses } } },
      { $group: { _id: { year: { $year: "$updatedAt" }, month: { $month: "$updatedAt" } }, revenue: { $sum: moneyExpression() }, count: { $sum: 1 } } },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]),
    Payment.aggregate([{ $match: match }, { $unwind: { path: "$refunds", preserveNullAndEmptyArrays: false } }, { $group: { _id: "$refunds.status", amount: { $sum: "$refunds.amount" }, count: { $sum: 1 } } }]),
    Payment.countDocuments({ ...match, $or: [{ remainingAmount: { $gt: 0 } }, { status: { $in: ["pending", "overdue", "failed"] } }] }),
  ]);
  return { totals: totals[0] || { revenue: 0, invoices: 0, outstanding: 0, refunded: 0 }, byStatus, trends, refunds, outstandingInvoices: outstanding };
}

async function getUserReport(query = {}) {
  const match = dateMatch(query);
  const [total, active, byRole, logins, activity] = await Promise.all([
    User.countDocuments(match),
    User.countDocuments({ ...match, isActive: true }),
    User.aggregate([{ $match: match }, { $group: { _id: "$role", count: { $sum: 1 }, active: { $sum: { $cond: ["$isActive", 1, 0] } } } }, { $sort: { count: -1 } }]),
    User.aggregate([{ $match: { lastLogin: { $exists: true, ...dateMatch(query, "lastLogin").lastLogin } } }, { $group: { _id: "$role", count: { $sum: 1 } } }]),
    AuditLog.aggregate([{ $match: { ...dateMatch(query), user: { $ne: null } } }, { $group: { _id: "$userRole", actions: { $sum: 1 } } }, { $sort: { actions: -1 } }]),
  ]);
  return { total, active, inactive: total - active, byRole, logins, activity };
}

async function getCompanyReport(query = {}) {
  const match = dateMatch(query);
  const [companies, beneficiaries, casesByCompany, programs] = await Promise.all([
    Company.countDocuments(match),
    Beneficiary.countDocuments(dateMatch(query)),
    Case.aggregate([{ $match: match }, { $group: { _id: "$companyId", cases: { $sum: 1 } } }, { $sort: { cases: -1 } }, { $limit: 20 }]),
    Case.aggregate([{ $match: match }, { $group: { _id: "$visaType", cases: { $sum: 1 } } }, { $sort: { cases: -1 } }]),
  ]);
  return { companies, beneficiaries, casesByCompany, immigrationPrograms: programs };
}

async function getOcrReport(query = {}) {
  const match = dateMatch(query, "uploadDate");
  const [processed, byStatus, failures, confidence] = await Promise.all([
    Document.countDocuments({ ...match, $or: [{ aiExtractionStatus: { $exists: true } }, { "ocr.status": { $exists: true } }] }),
    Document.aggregate([{ $match: match }, { $group: { _id: "$ocr.status", count: { $sum: 1 } } }]),
    Document.countDocuments({ ...match, $or: [{ aiExtractionStatus: "failed" }, { "ocr.status": "failed" }] }),
    Document.aggregate([{ $match: match }, { $group: { _id: null, averageConfidence: { $avg: { $ifNull: ["$ocr.confidence", "$extractionConfidence"] } }, lowConfidence: { $sum: { $cond: [{ $lt: [{ $ifNull: ["$ocr.confidence", "$extractionConfidence"] }, 0.75] }, 1, 0] } } } }]),
  ]);
  return { processed, byStatus, failures, accuracy: confidence[0] || { averageConfidence: 0, lowConfidence: 0 } };
}

async function getWorkflowReport(query = {}) {
  const match = dateMatch(query);
  const [byStatus, completion, sla, escalations] = await Promise.all([
    Workflow.aggregate([{ $match: match }, { $group: { _id: "$status", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    Workflow.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } } } }, { $project: { total: 1, completed: 1, completionRate: { $cond: [{ $gt: ["$total", 0] }, { $multiply: [{ $divide: ["$completed", "$total"] }, 100] }, 0] } } }]),
    Workflow.countDocuments({ ...match, slaBreachedAt: { $exists: true } }),
    Workflow.countDocuments({ ...match, escalatedAt: { $exists: true } }),
  ]);
  return { byStatus, completion: completion[0] || {}, slaBreaches: sla, escalations };
}

async function getAuditReport(query = {}) {
  const { getAuditSummary } = require("../audit/audit.service");
  return getAuditSummary(query);
}

const reportHandlers = {
  case: getCaseReport,
  cases: getCaseReport,
  financial: getFinancialReport,
  payments: getFinancialReport,
  user: getUserReport,
  users: getUserReport,
  company: getCompanyReport,
  companies: getCompanyReport,
  ocr: getOcrReport,
  workflow: getWorkflowReport,
  workflows: getWorkflowReport,
  audit: getAuditReport,
};

async function runReport(reportType, query = {}, req) {
  const handler = reportHandlers[reportType];
  if (!handler) {
    const error = new Error(`Unsupported report type: ${reportType}`);
    error.status = 400;
    throw error;
  }
  const execution = await ReportExecution.create({
    reportType,
    name: `${reportType} report`,
    filters: query,
    format: query.format || "json",
    status: "running",
    startedAt: new Date(),
    generatedBy: req?.user?._id,
    ipAddress: req?.ip,
    userAgent: req?.get?.("user-agent"),
  });
  try {
    const data = await handler(query);
    execution.status = "completed";
    execution.completedAt = new Date();
    execution.summary = data;
    execution.rowCount = Array.isArray(data) ? data.length : Object.keys(data || {}).length;
    await execution.save();
    if (req) {
      await recordAuditEvent({ req, action: "report.generated", entityType: "report", entityId: execution._id, details: `${reportType} report generated`, source: "api" });
    }
    return { execution, data };
  } catch (error) {
    execution.status = "failed";
    execution.error = error.message;
    execution.completedAt = new Date();
    await execution.save();
    throw error;
  }
}

async function listExecutions(query = {}) {
  const { page, limit, skip } = pagination(query);
  const filter = {};
  if (query.reportType) filter.reportType = query.reportType;
  if (query.status) filter.status = query.status;
  const [items, total] = await Promise.all([
    ReportExecution.find(filter).populate("generatedBy", "name displayName email role").sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ReportExecution.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 } };
}

async function listTemplates(query = {}) {
  const filter = {};
  if (query.reportType) filter.reportType = query.reportType;
  if (query.active !== undefined) filter.active = query.active !== "false";
  return ReportTemplate.find(filter).sort({ createdAt: -1 }).lean();
}

async function createTemplate(payload, userId) {
  return ReportTemplate.create({ ...payload, createdBy: userId, updatedBy: userId });
}

async function updateTemplate(id, payload, userId) {
  return ReportTemplate.findByIdAndUpdate(id, { ...payload, updatedBy: userId }, { new: true, runValidators: true });
}

async function listEodReports(query = {}, user) {
  const { page, limit, skip } = pagination(query);
  const filter = await eodVisibilityFilter(query, user);
  const [items, total] = await Promise.all([
    EODReport.find(filter).populate("staff", "name displayName email role").populate("reviewedBy", "name displayName email role").sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    EODReport.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 } };
}

async function createEodReport(payload, user, req) {
  const reportPayload = manualReportPayload(payload, user);
  const reportDay = istDayRange(reportPayload.date);
  const existing = await EODReport.findOne({
    staff: reportPayload.staff,
    date: { $gte: reportDay.start, $lt: reportDay.end },
  }).select("_id");
  if (existing) throw serviceError("An EOD report already exists for this staff member and date", 409);
  let report;
  try {
    report = await EODReport.create(reportPayload);
  } catch (error) {
    if (error?.code === 11000) throw serviceError("An EOD report already exists for this staff member and date", 409);
    throw error;
  }
  if (req) await recordAuditEvent({ req, action: "eod_report.created", entityType: "eod_report", entityId: report._id, details: "EOD report created" });
  return report;
}

async function updateEodReport(id, payload, req) {
  const existing = await EODReport.findById(id);
  if (!existing) return null;
  if (existing.staff.toString() !== req.user._id.toString()) throw serviceError("You can only update your own EOD report", 403);
  if (existing.reviewed) throw serviceError("Reviewed EOD reports cannot be changed", 409);
  const changes = manualReportPayload({ ...existing.toObject(), ...payload, date: existing.date }, req.user);
  delete changes.staff;
  delete changes.role;
  delete changes.teamId;
  delete changes.department;
  delete changes.date;
  const report = await EODReport.findByIdAndUpdate(id, changes, { new: true, runValidators: true });
  if (report && req) await recordAuditEvent({ req, action: "eod_report.updated", entityType: "eod_report", entityId: report._id, details: "EOD report updated" });
  return report;
}

async function reviewEodReport(id, payload, req) {
  const existing = await EODReport.findById(id);
  if (!existing) return null;
  const role = normalizeRole(req.user?.role);
  if (!EOD_MANAGER_ROLES.includes(role)) throw serviceError("Only administrators and team leads may review EOD reports", 403);
  if (role === "team_lead") {
    const reportOwner = await User.findById(existing.staff).select("teamId");
    if (!req.user.teamId || reportOwner?.teamId?.toString() !== req.user.teamId.toString()) {
      throw serviceError("Team leads may only review reports from their own team", 403);
    }
  }
  const report = await EODReport.findByIdAndUpdate(
    id,
    { reviewed: payload.status !== "pending", reviewComment: payload.reviewerNotes || payload.reviewComment, reviewedBy: req.user._id, reviewedAt: new Date() },
    { new: true, runValidators: true }
  );
  if (report) await recordAuditEvent({ req, action: "eod_report.reviewed", entityType: "eod_report", entityId: report._id, details: "EOD report reviewed" });
  return report;
}

function caseAssignmentFilter(staff) {
  const role = normalizeRole(staff.role);
  if (role === "team_lead") {
    return staff.teamId ? { teamId: staff.teamId } : { assignedTeamLead: staff._id };
  }
  const assignmentFields = {
    case_manager: "assignedCaseManager",
    attorney: "assignedAttorney",
    professor: "assignedProfessor",
    finance: "assignedFinance",
    paralegal: "assignedDocumentationSpecialist",
    reviewer: "reviewers",
  };
  const field = assignmentFields[role];
  return field ? { [field]: staff._id } : { _id: null };
}

async function automaticMetrics(staff, reportDate) {
  const { start, end } = istDayRange(reportDate);
  const assignment = caseAssignmentFilter(staff);
  const activityRange = { $gte: start, $lt: end };
  const [casesWorked, casesClosed, documentsReviewed, messagesReplied, pendingTasks] = await Promise.all([
    Case.countDocuments({ ...assignment, updatedAt: activityRange }),
    Case.countDocuments({
      ...assignment,
      updatedAt: activityRange,
      status: { $in: ["approved", "denied", "closed", "archived", "completed"] },
    }),
    Document.countDocuments({ reviewedBy: staff._id, reviewedAt: activityRange }),
    Message.countDocuments({ senderId: staff._id, createdAt: activityRange }),
    Task.countDocuments({ assignedTo: staff._id, status: { $nin: ["completed", "cancelled"] } }),
  ]);
  return { casesWorked, casesClosed, documentsReviewed, messagesReplied, pendingTasks };
}

async function generateAutomaticEodReports(options = {}) {
  const reportDate = startOfIstDay(options.reportDate || new Date(), options.reportDate ? 0 : -1);
  const staff = await User.find({
    isActive: { $ne: false },
    role: { $in: EOD_STAFF_ROLES },
  }).select("_id role teamId department");
  let created = 0;
  let skipped = 0;
  for (const member of staff) {
    const reportDay = istDayRange(reportDate);
    const existing = await EODReport.exists({
      staff: member._id,
      date: { $gte: reportDay.start, $lt: reportDay.end },
    });
    if (existing) {
      skipped += 1;
      continue;
    }
    const metrics = await automaticMetrics(member, reportDate);
    try {
      await EODReport.create({
        staff: member._id,
        role: normalizeRole(member.role),
        teamId: member.teamId || undefined,
        department: member.department || undefined,
        date: reportDate,
        ...metrics,
        source: "automatic",
        generatedAt: new Date(),
      });
      created += 1;
    } catch (error) {
      if (error?.code === 11000) skipped += 1;
      else throw error;
    }
  }
  return { created, skipped, reportDate, staffCount: staff.length };
}

function flattenReport(data) {
  if (Array.isArray(data)) return data;
  return Object.entries(data || {}).map(([metric, value]) => ({
    metric,
    value: typeof value === "object" ? JSON.stringify(value) : value,
  }));
}

function toCsv(rows) {
  const normalized = rows.length ? rows : [{ metric: "empty", value: "" }];
  const columns = [...new Set(normalized.flatMap((row) => Object.keys(row)))];
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [columns.join(","), ...normalized.map((row) => columns.map((column) => escape(row[column])).join(","))].join("\n");
}

function toExcelHtml(rows, title = "Report") {
  const normalized = rows.length ? rows : [{ metric: "empty", value: "" }];
  const columns = [...new Set(normalized.flatMap((row) => Object.keys(row)))];
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const header = columns.map((column) => `<th>${escape(column)}</th>`).join("");
  const body = normalized.map((row) => `<tr>${columns.map((column) => `<td>${escape(row[column])}</td>`).join("")}</tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title></head><body><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}

function toSimplePdf(rows, title = "Report") {
  const text = [title, ...rows.slice(0, 200).map((row) => Object.entries(row).map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`).join(" | "))].join("\n");
  const safe = text.replace(/[\\()]/g, "\\$&").split("\n").slice(0, 80);
  const lines = safe.map((line, index) => `BT /F1 10 Tf 40 ${760 - index * 14} Td (${line.slice(0, 120)}) Tj ET`).join("\n");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${Buffer.byteLength(lines)} >> stream\n${lines}\nendstream endobj`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object) => {
    offsets.push(Buffer.byteLength(body));
    body += `${object}\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  body += `trailer << /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body);
}

module.exports = {
  createEodReport,
  createTemplate,
  getAuditReport,
  getCaseReport,
  getCompanyReport,
  getFinancialReport,
  getOcrReport,
  getUserReport,
  getWorkflowReport,
  generateAutomaticEodReports,
  listEodReports,
  listExecutions,
  listTemplates,
  reviewEodReport,
  runReport,
  toExcelHtml,
  toCsv,
  flattenReport,
  toSimplePdf,
  updateEodReport,
  updateTemplate,
  startOfIstDay,
  eodVisibilityFilter,
  manualReportPayload,
};
