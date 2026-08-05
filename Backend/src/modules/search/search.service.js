const mongoose = require("mongoose");
const Appointment = require("../../models/Appointment");
const Beneficiary = require("../../models/Beneficiary");
const Case = require("../../models/Case");
const Client = require("../../models/Client");
const Company = require("../../models/Company");
const Conversation = require("../../models/Conversation");
const Document = require("../../models/Document");
const Message = require("../../models/Message");
const Notification = require("../../models/Notification");
const Payment = require("../../models/Payment");
const Questionnaire = require("../../models/Questionnaire");
const ReportExecution = require("../../models/ReportExecution");
const ReportTemplate = require("../../models/ReportTemplate");
const SavedSearch = require("../../models/SavedSearch");
const SearchHistory = require("../../models/SearchHistory");
const Task = require("../../models/Task");
const USCISFormTemplate = require("../../models/USCISFormTemplate");
const User = require("../../models/User");
const Workflow = require("../../models/Workflow");
const { hasPermission } = require("../authorization/rbac.service");

const staffRoles = new Set(["super_admin", "admin", "case_manager", "team_lead"]);
const clientRoles = new Set(["client", "user"]);

const cache = new Map();
const CACHE_TTL_MS = 30 * 1000;
const MAX_QUERY_LENGTH = 120;
const SYNONYMS = {
  h1b: ["h-1b", "h 1b", "h1-b"],
  rfe: ["request for evidence", "evidence request"],
  receipt: ["uscis receipt", "receipt number"],
  passport: ["travel document"],
  invoice: ["bill", "billing"],
  company: ["employer", "organization"],
  client: ["applicant", "customer"],
};

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeQuery(query = "") {
  return String(query).trim().replace(/\s+/g, " ").slice(0, MAX_QUERY_LENGTH);
}

function tokenize(query = "") {
  return normalizeQuery(query)
    .toLowerCase()
    .split(/[^a-z0-9@._-]+/i)
    .filter((token) => token.length >= 2)
    .slice(0, 8);
}

function expandTerms(query = "") {
  const terms = [normalizeQuery(query)];
  tokenize(query).forEach((token) => {
    (SYNONYMS[token] || []).forEach((synonym) => terms.push(synonym));
  });
  return [...new Set(terms.filter(Boolean))].slice(0, 12);
}

function fuzzyRegex(query = "") {
  const normalized = normalizeQuery(query);
  if (!normalized || normalized.length > 40) return null;
  const compact = normalized.replace(/\s+/g, "");
  if (compact.length < 3 || compact.length > 24) return null;
  return new RegExp(compact.split("").map(escapeRegex).join(".{0,2}"), "i");
}

function queryConditions(query, fields) {
  const normalized = normalizeQuery(query);
  const tokens = tokenize(normalized);
  const expanded = expandTerms(normalized);
  const fuzzy = fuzzyRegex(normalized);
  const conditions = [];
  expanded.forEach((term) => {
    const regex = new RegExp(escapeRegex(term), "i");
    fields.forEach((field) => conditions.push({ [field]: regex }));
  });
  tokens.forEach((token) => {
    const tokenRegex = new RegExp(escapeRegex(token), "i");
    fields.forEach((field) => conditions.push({ [field]: tokenRegex }));
  });
  if (fuzzy) fields.slice(0, 4).forEach((field) => conditions.push({ [field]: fuzzy }));
  return conditions;
}

function objectId(value) {
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : null;
}

function userScope(user, entity) {
  if (!user) return { _id: null };
  if (staffRoles.has(user.role)) return {};
  const id = objectId(user._id || user.id);
  const companyId = objectId(user.companyId);
  if (clientRoles.has(user.role)) {
    const own = {
      users: [{ _id: id }],
      clients: [{ user: id }],
      beneficiaries: [{ user: id }],
      cases: [{ user: id }],
      documents: [{ user: id }, { uploadedByUser: id }],
      conversations: [{ "participants.user": id }, { clientId: id }, { receiverId: id }],
      messages: [{ senderId: id }, { receiverId: id }, { readByUsers: id }, { "mentions.userId": id }],
      notifications: [{ user: id }, { userId: id }],
      appointments: [{ linkedUser: id }, { clientId: id }, { "attendees.user": id }],
      payments: [{ user: id }],
      questionnaires: [{ "visibility.roles": user.role }, { libraryVisibility: "public" }],
      workflows: [{ owner: id }, { assignedTo: id }],
    };
    return own[entity] ? { $or: own[entity] } : { _id: null };
  }
  return { _id: null };
}

function mergeAnd(...filters) {
  const compact = filters.filter((filter) => filter && Object.keys(filter).length);
  if (!compact.length) return {};
  if (compact.length === 1) return compact[0];
  return { $and: compact };
}

function applyFilters(filter, filters = {}, config) {
  const extra = {};
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    if (!config.filterFields?.includes(key)) return;
    extra[key] = Array.isArray(value) ? { $in: value } : value;
  });
  if (filters.from || filters.to) {
    const field = config.dateField || "createdAt";
    extra[field] = {};
    if (filters.from) extra[field].$gte = new Date(filters.from);
    if (filters.to) extra[field].$lte = new Date(filters.to);
  }
  return mergeAnd(filter, extra);
}

function getValue(record, path) {
  return path.split(".").reduce((value, key) => (value == null ? value : value[key]), record);
}

function firstValue(record, fields) {
  for (const field of fields) {
    const value = getValue(record, field);
    if (Array.isArray(value) && value.length) return value.join(", ");
    if (value) return value;
  }
  return "";
}

function relevance(record, query, fields) {
  const normalized = normalizeQuery(query).toLowerCase();
  if (!normalized) return 1;
  let score = 0;
  fields.forEach((field, index) => {
    const value = String(firstValue(record, [field]) || "").toLowerCase();
    if (!value) return;
    if (value === normalized) score += 100 - index;
    else if (value.startsWith(normalized)) score += 60 - index;
    else if (value.includes(normalized)) score += 25 - index;
    tokenize(normalized).forEach((token) => {
      if (value.includes(token)) score += 5;
    });
  });
  return score;
}

function mapResult(config, record, query) {
  const title = firstValue(record, config.titleFields) || `${config.label} ${record._id}`;
  const subtitle = firstValue(record, config.subtitleFields || []);
  const description = firstValue(record, config.descriptionFields || []);
  return {
    id: record._id,
    entity: config.entity,
    label: config.label,
    title,
    subtitle,
    description,
    status: firstValue(record, ["status", "paymentStatus", "lifecycleStatus", "reviewStatus"]),
    url: config.url(record),
    updatedAt: record.updatedAt || record.createdAt,
    score: relevance(record, query, config.fields),
    highlights: tokenize(query).slice(0, 5),
    metadata: config.metadata?.(record) || {},
  };
}

const configs = [
  {
    entity: "tasks",
    resource: "tasks",
    label: "Task",
    model: Task,
    fields: ["title", "description", "category", "priority", "status", "tags"],
    titleFields: ["title"],
    subtitleFields: ["status", "priority", "dueDate"],
    filterFields: ["status", "priority", "category", "caseId", "assignedTo", "companyId", "teamId"],
    dateField: "dueDate",
    url: (row) => `/tasks/${row._id}`,
  },
  {
    entity: "uscis_forms",
    resource: "forms",
    label: "USCIS Form",
    model: USCISFormTemplate,
    fields: ["formCode", "title", "description", "visaTypes", "version", "status"],
    titleFields: ["formCode", "title"],
    subtitleFields: ["version", "status"],
    filterFields: ["formCode", "status", "version"],
    url: (row) => `/uscis-forms/${row._id}`,
  },
  {
    entity: "users",
    resource: "users",
    label: "User",
    model: User,
    fields: ["name", "displayName", "email", "phone", "department", "specialization", "role"],
    titleFields: ["name", "displayName", "email"],
    subtitleFields: ["email", "role"],
    filterFields: ["role", "isActive", "department", "companyId"],
    url: (row) => `/admin/users/${row._id}`,
  },
  {
    entity: "clients",
    resource: "clients",
    label: "Client",
    model: Client,
    fields: ["fullName", "email", "primaryPhone", "whatsappNumber", "passportNumber", "visaType", "visaCategory", "clientPortalId"],
    titleFields: ["fullName", "email"],
    subtitleFields: ["email", "visaType", "clientPortalId"],
    filterFields: ["status", "visaType", "companyId", "assignedCaseManager"],
    url: (row) => `/clients/${row._id}`,
  },
  {
    entity: "companies",
    resource: "companies",
    label: "Company",
    model: Company,
    fields: ["name", "legalName", "dbaName", "ein", "contact.email", "contact.phone", "industry", "immigrationPrograms.name", "immigrationPrograms.visaType"],
    titleFields: ["name", "legalName"],
    subtitleFields: ["contact.email", "ein", "status"],
    filterFields: ["status", "industry"],
    url: (row) => `/companies/${row._id}`,
  },
  {
    entity: "beneficiaries",
    resource: "beneficiaries",
    label: "Beneficiary",
    model: Beneficiary,
    fields: ["fullName", "email", "primaryPhone", "passportNumber", "alienRegistrationNumber", "aNumber", "visaType", "visaCategory", "beneficiaryNumber", "clientPortalId"],
    titleFields: ["fullName", "email"],
    subtitleFields: ["visaType", "passportNumber", "beneficiaryNumber"],
    filterFields: ["status", "visaType", "companyId", "assignedCaseManager"],
    url: (row) => `/beneficiaries/${row._id}`,
  },
  {
    entity: "cases",
    resource: "cases",
    label: "Case",
    model: Case,
    fields: ["caseId", "caseNumber", "clientName", "clientEmail", "visaType", "visaCategory", "petitionType", "uscisReceiptNumber", "receiptTracking.receiptNumber", "priority", "status"],
    titleFields: ["caseNumber", "caseId"],
    subtitleFields: ["clientName", "visaType", "status"],
    descriptionFields: ["petitionType", "uscisReceiptNumber"],
    filterFields: ["status", "stage", "priority", "visaType", "caseType", "companyId", "assignedCaseManager"],
    url: (row) => `/cases/${row._id}`,
  },
  {
    entity: "documents",
    resource: "documents",
    label: "Document",
    model: Document,
    fields: ["originalName", "originalFileName", "fileName", "documentType", "category", "description", "tags", "ocr.rawText"],
    titleFields: ["originalName", "originalFileName", "fileName"],
    subtitleFields: ["documentType", "category", "reviewStatus"],
    filterFields: ["category", "documentType", "reviewStatus", "status", "requestStatus", "caseId", "companyId"],
    dateField: "uploadDate",
    url: (row) => `/documents/${row._id}`,
  },
  {
    entity: "messages",
    resource: "messages",
    label: "Message",
    model: Message,
    fields: ["message", "messageBody", "normalizedBody", "senderName", "senderEmail", "labels", "email.subject", "email.from"],
    titleFields: ["email.subject", "senderName", "senderEmail"],
    subtitleFields: ["message", "messageBody"],
    filterFields: ["caseId", "conversationId", "category", "priority", "channel", "direction", "isInternal"],
    url: (row) => `/messages/${row.conversationId || row.threadId || row._id}`,
  },
  {
    entity: "notifications",
    resource: "notifications",
    label: "Notification",
    model: Notification,
    fields: ["title", "message", "type", "category", "priority", "eventName", "metadata.summary"],
    titleFields: ["title"],
    subtitleFields: ["message", "category", "priority"],
    filterFields: ["type", "category", "priority", "isRead", "read", "caseId", "companyId"],
    url: (row) => row.link || `/notifications/${row._id}`,
  },
  {
    entity: "questionnaires",
    resource: "questionnaires",
    label: "Questionnaire",
    model: Questionnaire,
    fields: ["key", "title", "description", "category", "visaTypes", "caseTypes", "tags", "module"],
    titleFields: ["title", "key"],
    subtitleFields: ["category", "status", "module"],
    filterFields: ["status", "type", "module", "category", "isTemplate"],
    url: (row) => `/questionnaires/${row._id}`,
  },
  {
    entity: "workflows",
    resource: "workflows",
    label: "Workflow",
    model: Workflow,
    fields: ["name", "templateKey", "entityType", "currentStage", "status", "priority"],
    titleFields: ["name", "templateKey"],
    subtitleFields: ["entityType", "status", "currentStage"],
    filterFields: ["status", "priority", "entityType", "caseId", "companyId"],
    url: (row) => `/workflows/${row._id}`,
  },
  {
    entity: "appointments",
    resource: "appointments",
    label: "Appointment",
    model: Appointment,
    fields: ["title", "name", "email", "phone", "visaType", "message", "notes", "location", "meetingUrl"],
    titleFields: ["title", "name"],
    subtitleFields: ["email", "startAt", "status"],
    filterFields: ["status", "type", "visaType", "caseId", "companyId", "assignedTo", "caseManagerId"],
    dateField: "startAt",
    url: (row) => `/appointments/${row._id}`,
  },
  {
    entity: "payments",
    resource: "payments",
    label: "Payment",
    model: Payment,
    fields: ["invoiceNumber", "packageName", "packageKey", "status", "paymentStatus", "lifecycleStatus", "transactions.transactionId", "transactions.gatewayTransactionId", "transactions.stripePaymentIntentId", "invoices.invoiceNumber"],
    titleFields: ["invoiceNumber", "packageName", "packageKey"],
    subtitleFields: ["status", "paymentStatus", "totalAmount"],
    filterFields: ["status", "paymentStatus", "lifecycleStatus", "caseId", "companyId", "planKey"],
    url: (row) => `/payments/${row._id}`,
  },
  {
    entity: "reports",
    resource: "reports",
    label: "Report",
    model: ReportTemplate,
    fields: ["name", "description", "reportType", "dataSource"],
    titleFields: ["name"],
    subtitleFields: ["reportType", "dataSource"],
    filterFields: ["reportType", "active", "visibility"],
    url: (row) => `/reports/templates/${row._id}`,
  },
  {
    entity: "report_executions",
    resource: "reports",
    label: "Report Execution",
    model: ReportExecution,
    fields: ["name", "reportType", "status", "format", "error"],
    titleFields: ["name", "reportType"],
    subtitleFields: ["status", "format"],
    filterFields: ["reportType", "status", "format"],
    url: (row) => `/reports/executions/${row._id}`,
  },
  {
    entity: "conversations",
    resource: "messages",
    label: "Conversation",
    model: Conversation,
    fields: ["subject", "lastMessagePreview", "category", "labels", "inbox", "status"],
    titleFields: ["subject"],
    subtitleFields: ["lastMessagePreview", "status", "inbox"],
    filterFields: ["status", "type", "priority", "category", "inbox", "companyId", "caseId"],
    url: (row) => `/messages/${row._id}`,
  },
];

function availableConfigs(user, requestedEntities = []) {
  const wanted = new Set((requestedEntities || []).filter(Boolean));
  return configs.filter((config) => {
    if (wanted.size && !wanted.has(config.entity) && !wanted.has(config.resource)) return false;
    return hasPermission(user, `${config.resource}:read`);
  });
}

function parseNaturalLanguage(query = "") {
  const normalized = normalizeQuery(query).toLowerCase();
  const filters = {};
  const entities = [];
  if (/\bh[-\s]?1b\b/.test(normalized)) filters.visaType = "H1B";
  if (/\brfe\b|request for evidence/.test(normalized)) {
    entities.push("cases", "documents", "notifications");
    filters.priority = normalized.includes("pending") ? "high" : undefined;
  }
  if (/waiting for documents|missing documents|document pending/.test(normalized)) {
    entities.push("cases", "documents");
    filters.requestStatus = "missing";
  }
  if (/invoice|payment|revenue|refund/.test(normalized)) entities.push("payments");
  if (/appointment|meeting|calendar/.test(normalized)) entities.push("appointments");
  if (/questionnaire|intake/.test(normalized)) entities.push("questionnaires");
  if (/workflow|sla|escalation/.test(normalized)) entities.push("workflows");
  const assignedMatch = normalized.match(/assigned to (case manager|manager)?\s*([a-z ]+)/);
  if (assignedMatch) {
    filters.assignedRole = assignedMatch[1]?.replace("manager", "case_manager").replace("case case_manager", "case_manager") || "";
    filters.assignedName = assignedMatch[2]?.trim();
    entities.push("cases", "appointments", "workflows");
  }
  return { query: normalized.replace(/show me|show|find|list/g, "").trim(), entities: [...new Set(entities)], filters };
}

async function assignmentFilter(config, filters = {}) {
  if (!filters.assignedName) return {};
  const regex = new RegExp(escapeRegex(filters.assignedName), "i");
  const users = await User.find({ $or: [{ name: regex }, { displayName: regex }, { email: regex }] }).select("_id role").limit(25).lean();
  const ids = users.map((item) => item._id);
  if (!ids.length) return { _id: null };
  if (config.entity === "cases") {
    if (filters.assignedRole === "case_manager") return { assignedCaseManager: { $in: ids } };
    return { $or: [{ assignedCaseManager: { $in: ids } }, { assignedAgentUser: { $in: ids } }] };
  }
  if (config.entity === "appointments") {
    return { $or: [{ assignedTo: { $in: ids } }, { caseManagerId: { $in: ids } }, { "attendees.user": { $in: ids } }] };
  }
  if (config.entity === "workflows") {
    return { $or: [{ assignedTo: { $in: ids } }, { owner: { $in: ids } }] };
  }
  return {};
}

async function searchEntity(config, query, filters, user, limit) {
  const conditions = queryConditions(query, config.fields);
  const queryFilter = conditions.length ? { $or: conditions } : {};
  const accessFilter = userScope(user, config.entity);
  const assignedFilter = await assignmentFilter(config, filters);
  const cleanedFilters = { ...filters };
  delete cleanedFilters.assignedName;
  delete cleanedFilters.assignedRole;
  const finalFilter = applyFilters(mergeAnd(queryFilter, accessFilter, assignedFilter), cleanedFilters, config);
  const rows = await config.model
    .find(finalFilter)
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(limit)
    .lean();
  return rows.map((row) => mapResult(config, row, query)).sort((a, b) => b.score - a.score);
}

function cacheKey(user, query, entities, filters, page, limit) {
  return JSON.stringify({ user: String(user?._id || user?.id), role: user?.role, query, entities, filters, page, limit });
}

async function globalSearch({ query = "", entities = [], filters = {}, page = 1, limit = 10, source = "global" }, user, req) {
  const started = Date.now();
  const normalized = normalizeQuery(query);
  const parsed = source === "natural_language" ? parseNaturalLanguage(normalized) : null;
  const effectiveQuery = parsed?.query || normalized;
  const effectiveEntities = entities.length ? entities : parsed?.entities || [];
  const effectiveFilters = { ...filters, ...(parsed?.filters || {}) };
  const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
  const perEntityLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
  const key = cacheKey(user, effectiveQuery, effectiveEntities, effectiveFilters, pageNumber, perEntityLimit);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.value, cached: true };

  const selectedConfigs = availableConfigs(user, effectiveEntities);
  const groups = await Promise.all(selectedConfigs.map((config) => searchEntity(config, effectiveQuery, effectiveFilters, user, perEntityLimit)));
  const grouped = selectedConfigs.map((config, index) => ({ entity: config.entity, label: config.label, results: groups[index], count: groups[index].length }));
  const flattened = grouped.flatMap((group) => group.results).sort((a, b) => b.score - a.score || new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  const total = flattened.length;
  const items = flattened.slice((pageNumber - 1) * perEntityLimit, pageNumber * perEntityLimit);
  const value = {
    query: effectiveQuery,
    interpreted: parsed || null,
    items,
    grouped,
    pagination: { page: pageNumber, limit: perEntityLimit, total, pages: Math.ceil(total / perEntityLimit) || 1 },
    durationMs: Date.now() - started,
  };
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  if (user?._id && normalized) {
    SearchHistory.create({
      user: user._id,
      query: normalized,
      normalizedQuery: normalized.toLowerCase(),
      entities: effectiveEntities,
      filters: effectiveFilters,
      resultCount: total,
      durationMs: value.durationMs,
      source,
      ipAddress: req?.ip,
      userAgent: req?.get?.("user-agent"),
    }).catch(() => {});
  }
  return value;
}

async function autocomplete(query, user) {
  const value = normalizeQuery(query);
  if (!value || value.length < 2) return [];
  const selected = availableConfigs(user).slice(0, 8);
  const groups = await Promise.all(selected.map((config) => searchEntity(config, value, {}, user, 5)));
  return groups.flatMap((items) => items).sort((a, b) => b.score - a.score).slice(0, 10);
}

async function suggestions(query, user) {
  const normalized = normalizeQuery(query).toLowerCase();
  const recent = user?._id
    ? await SearchHistory.find({ user: user._id, normalizedQuery: { $regex: escapeRegex(normalized), $options: "i" } }).sort({ createdAt: -1 }).limit(5).lean()
    : [];
  const smart = [
    "show me H1B cases waiting for documents",
    "show pending RFEs",
    "show cases assigned to a case manager",
    "show overdue payments",
    "show documents with failed OCR",
  ].filter((item) => !normalized || item.includes(normalized));
  return [...new Set([...recent.map((item) => item.query), ...smart])].slice(0, 8);
}

async function listHistory(user, query = {}) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
  const [items, total] = await Promise.all([
    SearchHistory.find({ user: user._id }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    SearchHistory.countDocuments({ user: user._id }),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 } };
}

async function listSavedSearches(user) {
  const access = [{ owner: user._id }, { visibility: "organization" }];
  if (user.teamId) access.push({ visibility: "team", teamId: user.teamId });
  return SavedSearch.find({ $or: access }).sort({ pinned: -1, updatedAt: -1 }).lean();
}

async function createSavedSearch(payload, user) {
  return SavedSearch.create({ ...payload, owner: user._id, teamId: user.teamId, companyId: user.companyId });
}

async function updateSavedSearch(id, payload, user) {
  return SavedSearch.findOneAndUpdate({ _id: id, owner: user._id }, payload, { new: true, runValidators: true });
}

async function deleteSavedSearch(id, user) {
  return SavedSearch.findOneAndDelete({ _id: id, owner: user._id });
}

async function runSavedSearch(id, user, req) {
  const savedSearch = await SavedSearch.findOne({ _id: id, $or: [{ owner: user._id }, { visibility: "organization" }, { visibility: "team", teamId: user.teamId }] }).lean();
  if (!savedSearch) return null;
  await SavedSearch.updateOne({ _id: id }, { $inc: { runCount: 1 }, $set: { lastRunAt: new Date() } });
  return globalSearch({ query: savedSearch.query, entities: savedSearch.entities, filters: savedSearch.filters, source: "global" }, user, req);
}

module.exports = {
  autocomplete,
  createSavedSearch,
  deleteSavedSearch,
  globalSearch,
  listHistory,
  listSavedSearches,
  parseNaturalLanguage,
  runSavedSearch,
  suggestions,
  updateSavedSearch,
};
