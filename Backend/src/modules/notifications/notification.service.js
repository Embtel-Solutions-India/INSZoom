const AuditLog = require("../../models/AuditLog");
const Notification = require("../../models/Notification");
const NotificationPreference = require("../../models/NotificationPreference");
const NotificationTemplate = require("../../models/NotificationTemplate");
const User = require("../../models/User");
const { normalizeRole } = require("../authorization/roleHierarchy");
const realtimeGateway = require("../realtime/realtime.gateway");
const emailService = require("../email/email.service");
const pushService = require("./push.service");
const { resolveNotificationDefaults } = require("./notificationRules");

const STAFF_ROLES = ["super_admin", "admin", "team_lead", "case_manager", "attorney", "paralegal", "reviewer", "finance", "hr"];
const ROLE_EVENT_VISIBILITY = {
  client: { clientVisible: true, internalOnly: false },
  employer: { clientVisible: true, internalOnly: false },
  professor: { clientVisible: true, internalOnly: false },
};

function idOf(value) {
  return value?._id?.toString?.() || value?.toString?.();
}

function sameId(left, right) {
  return Boolean(left && right && idOf(left) === idOf(right));
}

function addAuditEntry(notification, action, user, changes = {}, req) {
  notification.auditHistory.push({
    action,
    performedBy: user?._id,
    performedAt: new Date(),
    changes,
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
  });
}

async function writeAuditLog(action, notification, user, changes, req) {
  await AuditLog.create({
    userId: user?._id,
    action,
    entityType: "notification",
    entityId: notification?._id?.toString(),
    changes,
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
    description: `${action} notification ${notification?.title || notification?._id}`,
  }).catch(() => {});
}

function canAccessNotification(user, notification) {
  if (!user || !notification) return false;
  const role = normalizeRole(user.role);
  if (["super_admin", "admin"].includes(role)) return true;
  if (notification.internalOnly && !STAFF_ROLES.includes(role)) return false;
  if (ROLE_EVENT_VISIBILITY[role] && notification.clientVisible === false) return false;
  if (sameId(notification.userId, user._id) || sameId(notification.user, user._id)) return true;
  if (notification.recipientRoles?.map(normalizeRole).includes(role)) return true;
  if (notification.recipientRole && normalizeRole(notification.recipientRole) === role) return true;
  if (role === "employer" && sameId(notification.companyId, user.companyId)) return true;
  if (role === "team_lead" && sameId(notification.teamId, user.teamId)) return true;
  return false;
}

function addCommonFilters(filter, query = {}) {
  if (query.isRead !== undefined) filter.isRead = query.isRead === "true" || query.isRead === true;
  if (query.read !== undefined) filter.read = query.read === "true" || query.read === true;
  if (query.type) filter.type = query.type;
  if (query.category) filter.category = query.category;
  if (query.priority) filter.priority = query.priority;
  if (query.caseId) filter.caseId = query.caseId;
  if (query.pinned !== undefined) filter.pinned = query.pinned === "true" || query.pinned === true;
  if (query.search) filter.$text = { $search: query.search };
  if (query.includeSnoozed !== "true") {
    filter.$and = [
      ...(filter.$and || []),
      { $or: [{ snoozedUntil: { $exists: false } }, { snoozedUntil: { $lte: new Date() } }] },
    ];
  }
  return filter;
}

function buildUserFilter(user, query = {}) {
  const role = normalizeRole(user.role);
  const recipientOr = [
    { userId: user._id },
    { user: user._id },
    { recipientRole: role },
    { recipientRoles: role },
  ];
  if (user.companyId) recipientOr.push({ companyId: user.companyId });
  if (user.teamId) recipientOr.push({ teamId: user.teamId });

  const filter = {
    deletedAt: { $exists: false },
    archived: query.archived === "true" ? true : { $ne: true },
    $or: recipientOr,
  };
  if (ROLE_EVENT_VISIBILITY[role]) {
    filter.internalOnly = { $ne: true };
    filter.clientVisible = { $ne: false };
  }
  return addCommonFilters(filter, query);
}

function buildAdminFilter(query = {}) {
  const filter = { deletedAt: { $exists: false } };
  if (query.userId) filter.userId = query.userId;
  if (query.role) filter.$or = [{ recipientRole: query.role }, { recipientRoles: query.role }];
  if (query.archived !== undefined) filter.archived = query.archived === "true" || query.archived === true;
  else filter.archived = { $ne: true };
  return addCommonFilters(filter, query);
}

function inferCategory(type = "general") {
  if (type.startsWith("case_") || ["rfe_received", "rfe_submitted", "petition_filed", "receipt_number_generated"].includes(type)) return "case";
  if (type.startsWith("document_") || type.includes("passport") || type.includes("visa") || type.includes("ocr")) return "document";
  if (type.startsWith("questionnaire_")) return "questionnaire";
  if (type.startsWith("workflow_") || type.includes("approval") || type.includes("deadline")) return "workflow";
  if (type.includes("message") || type.includes("conversation") || type === "mention" || type === "file_shared") return "message";
  if (type.startsWith("appointment_") || type.includes("meeting")) return "appointment";
  if (type.includes("payment") || type.includes("invoice") || type.includes("refund")) return "payment";
  if (type.includes("account") || type.includes("password") || type.includes("profile") || type.includes("role") || type.includes("email")) return "user";
  if (type.includes("security") || type.includes("login")) return "security";
  if (type.includes("system") || type.includes("api")) return "system";
  return "general";
}

function renderText(template = "", variables = {}) {
  return template.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_, key) => {
    const value = key.split(".").reduce((current, part) => (current == null ? undefined : current[part]), variables);
    return value == null ? "" : String(value);
  });
}

async function renderTemplate(templateKey, payload) {
  if (!templateKey) return payload;
  const template = await NotificationTemplate.findOne({ key: templateKey, active: true, archivedAt: { $exists: false } });
  if (!template) return payload;
  template.usageCount += 1;
  template.lastUsedAt = new Date();
  await template.save();
  const variables = payload.variables || payload.metadata || {};
  return {
    ...payload,
    type: payload.type || template.type,
    category: payload.category || template.category,
    priority: payload.priority || template.priority,
    channels: payload.channels || template.channels,
    title: payload.title || renderText(template.titleTemplate, variables),
    message: payload.message || renderText(template.messageTemplate, variables),
    link: payload.link || renderText(template.linkTemplate || "", variables),
    clientVisible: payload.clientVisible ?? template.visibility?.clientVisible,
    internalOnly: payload.internalOnly ?? template.visibility?.internalOnly,
  };
}

function normalizeCreatePayload(payload, actor) {
  const userId = payload.userId || payload.user || payload.recipient;
  const caseId = payload.caseId || payload.case;
  const type = payload.type || "general";
  const scheduledFor = payload.scheduledFor ? new Date(payload.scheduledFor) : undefined;
  // Business-rule defaults, by type — only used when a caller doesn't
  // already supply priority/channels itself. Every existing call site
  // passes these explicitly today, so this is purely additive: it can only
  // change behavior for a caller that omits them, never override one that
  // doesn't.
  const rule = resolveNotificationDefaults(type);
  const channels = payload.channels || rule?.channels || ["in_app", "socket"];
  return {
    user: userId,
    userId,
    recipientRole: payload.recipientRole,
    recipientRoles: payload.recipientRoles || [],
    companyId: payload.companyId,
    teamId: payload.teamId,
    type,
    category: payload.category || inferCategory(type),
    title: payload.title,
    message: payload.message,
    priority: payload.priority || rule?.priority || "medium",
    link: payload.link,
    metadata: payload.metadata,
    eventName: payload.eventName,
    eventId: payload.eventId,
    dedupeKey: payload.dedupeKey,
    templateKey: payload.templateKey,
    clientVisible: payload.clientVisible !== false,
    internalOnly: payload.internalOnly === true,
    case: caseId,
    caseId,
    taskId: payload.taskId,
    documentId: payload.documentId,
    paymentId: payload.paymentId,
    appointmentId: payload.appointmentId,
    conversationId: payload.conversationId,
    messageId: payload.messageId,
    channels,
    delivery: channels.map((channel) => ({ channel, status: "pending" })),
    scheduledFor,
    queuedAt: scheduledFor ? new Date() : undefined,
    queueStatus: scheduledFor ? "scheduled" : "none",
    expiresAt: payload.expiresAt,
    createdBy: actor?._id || payload.createdBy,
    source: payload.source || "shared",
  };
}

async function getPreference(userId) {
  if (!userId) return null;
  return NotificationPreference.findOne({ userId });
}

function channelsEnabledByPreference(channels, preference, notification) {
  if (!preference) return channels;
  if (!preference.globalEnabled) return [];
  if (preference.mutedUntil && preference.mutedUntil > new Date()) return [];
  const typePref = preference.types?.find((item) => item.type === notification.type);
  if (typePref?.enabled === false) return [];
  const categoryPref = preference.categories?.find((item) => item.category === notification.category);
  if (categoryPref?.enabled === false) return [];
  return channels.filter((channel) => {
    const typeChannel = typePref?.channels?.find((item) => item.channel === channel);
    if (typeChannel) return typeChannel.enabled;
    const categoryChannel = categoryPref?.channels?.find((item) => item.channel === channel);
    if (categoryChannel) return categoryChannel.enabled;
    const globalChannel = preference.channels?.find((item) => item.channel === channel);
    return globalChannel ? globalChannel.enabled : true;
  });
}

async function applyPreferences(notification) {
  if (!notification.userId) return notification;
  const preference = await getPreference(notification.userId);
  notification.channels = channelsEnabledByPreference(notification.channels || ["in_app"], preference, notification);
  if (!notification.channels.length) {
    notification.delivery = [{ channel: "in_app", status: "skipped", error: "Notification muted by user preference" }];
  }
  return notification;
}

async function deliverRealtime(notification) {
  const emitted = [];
  if (notification.userId) {
    realtimeGateway.emitToUser(notification.userId, "new_notification", notification);
    realtimeGateway.emitToUser(notification.userId, "notification:new", notification);
    realtimeGateway.emitToUser(notification.userId, "notification:badge", { unreadDelta: notification.isRead ? 0 : 1 });
    emitted.push(notification.userId.toString());
  }
  const roles = [...new Set([notification.recipientRole, ...(notification.recipientRoles || [])].filter(Boolean))];
  roles.forEach((role) => realtimeGateway.emitToRole(role, "notification:new", notification));
  notification.deliveredAt = new Date();
  notification.delivery = (notification.delivery || []).map((delivery) => {
    if (["socket", "in_app", "browser"].includes(delivery.channel)) {
      const deliveryObject = typeof delivery.toObject === "function" ? delivery.toObject() : delivery;
      return { ...deliveryObject, status: "sent", sentAt: new Date() };
    }
    if (["email", "sms", "push", "whatsapp", "slack", "teams"].includes(delivery.channel) && delivery.status === "pending") {
      const deliveryObject = typeof delivery.toObject === "function" ? delivery.toObject() : delivery;
      return { ...deliveryObject, status: "queued" };
    }
    return delivery;
  });
  return emitted;
}

/**
 * Central email dispatch for notifications. Any call site that wants an
 * email alongside (or instead of) the in-app notification simply passes
 * `emailTemplate` (+ optional `emailData` / `emailTo`) into
 * createNotification() — this is the ONLY place in the app that decides
 * whether/how that email actually gets sent, so business logic elsewhere
 * never needs to know about EmailService, templates, or providers.
 */
async function dispatchEmailChannel(notification, payload, actor) {
  const emailDelivery = (notification.delivery || []).find((entry) => entry.channel === "email");
  if (!payload.emailTemplate || !emailDelivery) return;

  const recipientEmail = payload.emailTo || (notification.userId ? (await User.findById(notification.userId).select("email").lean())?.email : null);
  if (!recipientEmail) {
    emailDelivery.status = "failed";
    emailDelivery.error = "No recipient email address could be resolved";
    return;
  }

  const result = await emailService.sendTemplateEmail(payload.emailTemplate, {
    to: recipientEmail,
    data: payload.emailData || payload.metadata || {},
    caseId: notification.caseId,
    userId: notification.userId,
    triggeredBy: actor?._id,
    source: notification.source,
  }).catch((error) => ({ sent: false, error }));

  if (result.sent) {
    emailDelivery.status = "sent";
    emailDelivery.sentAt = new Date();
    emailDelivery.providerMessageId = result.log?.providerMessageId;
  } else if (result.skipped) {
    emailDelivery.status = "pending";
    emailDelivery.error = "Email provider not configured; queued in EmailLog";
  } else {
    emailDelivery.status = "failed";
    emailDelivery.error = result.error?.message || "Email send failed";
  }
}

/**
 * Central FCM dispatch for notifications — the browser-push analog of
 * dispatchEmailChannel above. Runs whenever the "push" channel survives
 * applyPreferences() (i.e. channels included "push" AND the recipient
 * hasn't muted push for this type/category/globally). Other modules never
 * call push.service.js directly; this is the only call site.
 */
async function dispatchPushChannel(notification, payload, actor) {
  const pushDelivery = (notification.delivery || []).find((entry) => entry.channel === "push");
  if (!pushDelivery || !notification.userId) return;

  const result = await pushService.sendToUser(notification.userId, {
    title: notification.title,
    body: notification.message,
    link: notification.link,
    data: { notificationId: notification._id?.toString(), type: notification.type, caseId: idOf(notification.caseId) },
  }).catch((error) => ({ successCount: 0, failureCount: 0, error: error.message }));

  if (result.skipped) {
    pushDelivery.status = "skipped";
    pushDelivery.error = result.skipped;
  } else if (result.error) {
    pushDelivery.status = "failed";
    pushDelivery.error = result.error;
  } else if (result.successCount > 0) {
    pushDelivery.status = "sent";
    pushDelivery.sentAt = new Date();
  } else {
    pushDelivery.status = "failed";
    pushDelivery.error = "No device accepted the push notification";
  }
}

async function createNotification(payload, actor, req) {
  const renderedPayload = await renderTemplate(payload.templateKey, payload);
  if (renderedPayload.dedupeKey) {
    const existing = await Notification.findOne({ dedupeKey: renderedPayload.dedupeKey, deletedAt: { $exists: false } });
    if (existing) return existing;
  }
  // Requesting an email template implicitly requests the "email" channel,
  // so callers don't have to remember to list it manually.
  if (renderedPayload.emailTemplate && !(renderedPayload.channels || []).includes("email")) {
    renderedPayload.channels = [...(renderedPayload.channels || ["in_app", "socket"]), "email"];
  }
  const notification = await Notification.create(normalizeCreatePayload(renderedPayload, actor));
  await applyPreferences(notification);
  addAuditEntry(notification, "create", actor, renderedPayload, req);
  if (!notification.scheduledFor) {
    await deliverRealtime(notification);
    await dispatchEmailChannel(notification, renderedPayload, actor);
    await dispatchPushChannel(notification, renderedPayload, actor);
  }
  await notification.save();
  await writeAuditLog("create", notification, actor, renderedPayload, req);
  return notification;
}

async function createForRoles(roles, payload, actor, req) {
  const normalizedRoles = roles.map(normalizeRole);
  const users = await User.find({ role: { $in: normalizedRoles }, isActive: { $ne: false } }).select("_id role companyId teamId");
  const notifications = [];
  if (!users.length) {
    notifications.push(await createNotification({ ...payload, recipientRoles: normalizedRoles }, actor, req));
    return notifications;
  }
  // Each recipient's notification is independent — fan out concurrently
  // instead of one at a time, in bounded batches so a large role (e.g. every
  // case_manager) doesn't fire hundreds of simultaneous writes/realtime emits.
  const BATCH_SIZE = 10;
  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((user) => createNotification({ ...payload, userId: user._id, recipientRole: normalizeRole(user.role) }, actor, req))
    );
    notifications.push(...batchResults);
  }
  return notifications;
}

async function createFromEvent(eventName, context = {}, actor, req) {
  const eventMap = {
    "case.created": { type: "case_created", title: "New Case Created", message: "A new case has been created.", roles: ["admin", "case_manager"] },
    "case.assigned": { type: "case_assigned", title: "Case Assigned", message: "A case has been assigned.", roles: ["case_manager", "attorney"] },
    "case.status_changed": { type: "case_stage_changed", title: "Case Status Changed", message: "Case status has changed.", roles: ["case_manager", "attorney"] },
    "case.closed": { type: "case_closed", title: "Case Closed", message: "A case has been closed.", roles: ["case_manager"] },
    "document.uploaded": { type: "document_uploaded", title: "Document Uploaded", message: "A document was uploaded.", roles: ["case_manager"] },
    "document.approved": { type: "document_approved", title: "Document Approved", message: "A document was approved.", roles: ["client", "case_manager"] },
    "document.rejected": { type: "document_rejected", title: "Document Rejected", message: "A document was rejected.", roles: ["client", "case_manager"] },
    "questionnaire.assigned": { type: "questionnaire_assigned", title: "Questionnaire Assigned", message: "A questionnaire has been assigned.", roles: ["client"] },
    "questionnaire.submitted": { type: "questionnaire_submitted", title: "Questionnaire Submitted", message: "A questionnaire was submitted.", roles: ["case_manager"] },
    "workflow.sla_breached": { type: "workflow_sla_breached", title: "Workflow SLA Breached", message: "A workflow SLA has been breached.", roles: ["admin", "case_manager"] },
    "message.received": { type: "message_received", title: "New Message", message: "A new message was received.", roles: [] },
    "payment.failed": { type: "payment_failed", title: "Payment Failed", message: "A payment failed.", roles: ["finance", "admin"] },
    "security.failed_logins": { type: "multiple_failed_logins", title: "Multiple Failed Login Attempts", message: "Multiple failed login attempts detected.", roles: ["admin", "super_admin"] },
  };
  const mapped = eventMap[eventName] || { type: "general", title: context.title || "CRM Update", message: context.message || "An event occurred.", roles: context.roles || [] };
  const base = {
    ...mapped,
    ...context,
    eventName,
    eventId: context.eventId,
    metadata: { ...(context.metadata || {}), eventName },
  };
  if (context.userId || context.user) return [await createNotification(base, actor, req)];
  return createForRoles(context.roles || mapped.roles || [], base, actor, req);
}

async function markRead(notification, user, req) {
  notification.read = true;
  notification.isRead = true;
  notification.readAt = notification.readAt || new Date();
  addAuditEntry(notification, "read", user, {}, req);
  await notification.save();
  realtimeGateway.emitToUser(notification.userId, "notification:read", { id: notification._id });
  await writeAuditLog("read", notification, user, {}, req);
  return notification;
}

async function updateNotificationState(notification, action, payload, user, req) {
  if (action === "archive") {
    notification.archived = true;
    notification.archivedAt = new Date();
  } else if (action === "pin") {
    notification.pinned = true;
    notification.pinnedAt = new Date();
  } else if (action === "unpin") {
    notification.pinned = false;
    notification.pinnedAt = undefined;
  } else if (action === "snooze") {
    notification.snoozedUntil = payload.snoozedUntil ? new Date(payload.snoozedUntil) : new Date(Date.now() + Number(payload.minutes || 60) * 60 * 1000);
  } else if (action === "delete") {
    notification.deletedAt = new Date();
    notification.deletedBy = user._id;
  }
  addAuditEntry(notification, action, user, payload, req);
  await notification.save();
  await writeAuditLog(action, notification, user, payload, req);
  return notification;
}

async function processScheduled(limit = 100, actor, req) {
  const now = new Date();
  const notifications = await Notification.find({ scheduledFor: { $lte: now }, queueStatus: "scheduled", deletedAt: { $exists: false } }).limit(limit);
  for (const notification of notifications) {
    notification.queueStatus = "processing";
    await deliverRealtime(notification);
    notification.queueStatus = "processed";
    notification.processedAt = new Date();
    addAuditEntry(notification, "process_scheduled", actor, {}, req);
    await notification.save();
  }
  return { processedCount: notifications.length };
}

async function retryFailed(limit = 100, actor, req) {
  const now = new Date();
  const notifications = await Notification.find({
    "delivery.status": { $in: ["failed", "retrying"] },
    "delivery.nextRetryAt": { $lte: now },
    retryCount: { $lt: 3 },
    deletedAt: { $exists: false },
  }).limit(limit);
  for (const notification of notifications) {
    notification.retryCount += 1;
    notification.delivery = notification.delivery.map((delivery) => {
      if (["failed", "retrying"].includes(delivery.status)) {
        const deliveryObject = typeof delivery.toObject === "function" ? delivery.toObject() : delivery;
        return { ...deliveryObject, status: "queued", attempts: (delivery.attempts || 0) + 1 };
      }
      return delivery;
    });
    addAuditEntry(notification, "retry", actor, {}, req);
    await notification.save();
  }
  return { processedCount: notifications.length };
}

async function getAnalytics(query = {}) {
  const match = { deletedAt: { $exists: false } };
  if (query.category) match.category = query.category;
  if (query.type) match.type = query.type;
  const [byType, byCategory, byPriority, unread] = await Promise.all([
    Notification.aggregate([{ $match: match }, { $group: { _id: "$type", count: { $sum: 1 } } }]),
    Notification.aggregate([{ $match: match }, { $group: { _id: "$category", count: { $sum: 1 } } }]),
    Notification.aggregate([{ $match: match }, { $group: { _id: "$priority", count: { $sum: 1 } } }]),
    Notification.countDocuments({ ...match, isRead: false }),
  ]);
  return { byType, byCategory, byPriority, unread };
}

function populateNotificationQuery(query) {
  return query.populate([
    { path: "userId", select: "name displayName email role" },
    { path: "user", select: "name displayName email role" },
    { path: "caseId", select: "caseNumber caseId clientName" },
    { path: "case", select: "caseNumber caseId clientName" },
    { path: "createdBy", select: "name displayName email role" },
  ]);
}

// Reassignment side-effect: a case manager who's just lost a case shouldn't
// keep seeing unread notifications tied to it in their bell — reuses the
// existing isRead field (no schema change) rather than deleting anything.
async function dismissCaseNotificationsForUser(caseId, userId) {
  if (!caseId || !userId) return { modifiedCount: 0 };
  return Notification.updateMany(
    { caseId, userId, isRead: false },
    { $set: { isRead: true, read: true, readAt: new Date() } }
  );
}

module.exports = {
  addAuditEntry,
  buildAdminFilter,
  buildUserFilter,
  canAccessNotification,
  createForRoles,
  createFromEvent,
  createNotification,
  dismissCaseNotificationsForUser,
  getAnalytics,
  getPreference,
  markRead,
  populateNotificationQuery,
  processScheduled,
  retryFailed,
  updateNotificationState,
  writeAuditLog,
};
