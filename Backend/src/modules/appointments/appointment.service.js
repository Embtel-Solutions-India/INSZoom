const AuditLog = require("../../models/AuditLog");
const Appointment = require("../../models/Appointment");
const CalendarAvailability = require("../../models/CalendarAvailability");
const CalendarEvent = require("../../models/CalendarEvent");
const CalendarIntegration = require("../../models/CalendarIntegration");
const CalendarResource = require("../../models/CalendarResource");
const Case = require("../../models/Case");
const User = require("../../models/User");
const caseService = require("../cases/case.service");
const notificationService = require("../notifications/notification.service");
const { normalizeRole } = require("../authorization/roleHierarchy");
const { zonedTimeToUtc, zonedDateParts } = require("../../utils/timezone");

// Bay Area / firm default when no CalendarAvailability doc has been
// configured for the host yet — see getAvailability().
const DEFAULT_AVAILABILITY_TIMEZONE = "America/Los_Angeles";

const STAFF_ROLES = ["super_admin", "admin", "case_manager", "team_lead"];
const SCHEDULER_ROLES = ["super_admin", "admin", "case_manager", "team_lead", "client", "user"];

function sameId(left, right) {
  return left && right && left.toString() === right.toString();
}

function roleOf(user) {
  return normalizeRole(user?.role);
}

function isStaff(user) {
  return STAFF_ROLES.includes(roleOf(user));
}

function canCreateAppointment(user, publicBooking = false) {
  if (publicBooking) return true;
  return user && SCHEDULER_ROLES.includes(roleOf(user));
}

function canManageAppointment(user, appointment) {
  if (!user || !appointment) return false;
  const role = roleOf(user);
  if (["super_admin", "admin"].includes(role)) return true;
  if (sameId(appointment.assignedTo, user._id)) return true;
  if (sameId(appointment.caseManagerId, user._id)) return true;
  if (role === "team_lead" && sameId(appointment.teamId, user.teamId)) return true;
  return false;
}

async function canAccessAppointment(user, appointment) {
  if (!user || !appointment) return false;
  if (canManageAppointment(user, appointment)) return true;
  if (sameId(appointment.linkedUser, user._id) || sameId(appointment.clientId, user._id)) return true;
  if (appointment.caseId) {
    const caseData = appointment.caseId.stage ? appointment.caseId : await Case.findById(appointment.caseId);
    return caseService.canAccessCase(user, caseData);
  }
  return false;
}

function addAuditEntry(appointment, action, user, changes = {}, req) {
  appointment.auditHistory.push({
    action,
    performedBy: user?._id,
    performedAt: new Date(),
    changes,
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
  });
}

async function writeAuditLog(action, appointment, user, changes, req) {
  await AuditLog.create({
    userId: user?._id,
    action,
    entityType: "appointment",
    entityId: appointment?._id?.toString(),
    changes,
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
    description: `${action} appointment ${appointment?.title || appointment?._id}`,
  }).catch(() => {});
}

async function buildAppointmentFilter(query, user) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.type) filter.type = query.type;
  if (query.caseId) filter.caseId = query.caseId;
  if (query.assignedTo) filter.assignedTo = query.assignedTo;
  if (query.clientId) filter.clientId = query.clientId;
  if (query.from || query.to) {
    filter.startAt = {};
    if (query.from) filter.startAt.$gte = new Date(query.from);
    if (query.to) filter.startAt.$lte = new Date(query.to);
  }
  if (query.search) {
    filter.$or = [
      { name: { $regex: query.search, $options: "i" } },
      { email: { $regex: query.search, $options: "i" } },
      { title: { $regex: query.search, $options: "i" } },
      { visaType: { $regex: query.search, $options: "i" } },
    ];
  }

  if (!user) {
    filter.publicBooking = true;
    return filter;
  }
  const role = roleOf(user);
  if (["super_admin", "admin"].includes(role)) return filter;
  if (role === "team_lead" && user.teamId) {
    filter.teamId = user.teamId;
    return filter;
  }
  if (role === "case_manager") filter.$and = [...(filter.$and || []), { $or: [{ caseManagerId: user._id }, { assignedTo: user._id }] }];
  else filter.$and = [...(filter.$and || []), { $or: [{ linkedUser: user._id }, { clientId: user._id }, { "attendees.user": user._id }] }];
  return filter;
}

async function hydrateCaseContext(payload) {
  if (!payload.caseId) return {};
  const caseData = await Case.findById(payload.caseId);
  if (!caseData) {
    const error = new Error("Case not found");
    error.status = 404;
    throw error;
  }
  return {
    caseData,
    clientId: caseData.user || caseData.clientProfile,
    caseManagerId: caseData.assignedCaseManager,
    companyId: caseData.companyId,
    teamId: caseData.teamId,
    clientPortalId: caseData.clientPortalId,
  };
}

function defaultReminders(startAt) {
  if (!startAt) return [];
  const start = new Date(startAt);
  return [1440, 60].map((minutesBefore) => ({
    minutesBefore,
    remindAt: new Date(start.getTime() - minutesBefore * 60000),
    channel: "in_app",
    sent: false,
  })).filter((reminder) => reminder.remindAt > new Date());
}

async function hasConflict({ assignedTo, attorneyId, caseManagerId, startAt, endAt, excludeId }) {
  if (!startAt || !endAt) return false;
  const assignees = [assignedTo, caseManagerId].filter(Boolean);
  if (!assignees.length) return false;
  const query = {
    _id: { $ne: excludeId },
    status: { $nin: ["cancelled", "completed", "no_show"] },
    startAt: { $lt: endAt },
    endAt: { $gt: startAt },
    $or: [
      { assignedTo: { $in: assignees } },
      { caseManagerId: { $in: assignees } },
      { "attendees.user": { $in: assignees } },
    ],
  };
  return Appointment.exists(query);
}

async function hasResourceConflict({ resourceIds = [], startAt, endAt, excludeId }) {
  if (!startAt || !endAt || !resourceIds.length) return false;
  return Appointment.exists({
    _id: { $ne: excludeId },
    status: { $nin: ["cancelled", "completed", "no_show"] },
    resourceIds: { $in: resourceIds },
    startAt: { $lt: endAt },
    endAt: { $gt: startAt },
  });
}

async function assertNoSchedulingConflicts(appointmentData) {
  if (await hasConflict(appointmentData)) {
    const error = new Error("Appointment conflicts with an existing scheduled appointment");
    error.status = 409;
    throw error;
  }
  if (await hasResourceConflict(appointmentData)) {
    const error = new Error("A selected calendar resource is unavailable for this time slot");
    error.status = 409;
    throw error;
  }
}

async function upsertCalendarEventForAppointment(appointment, actor) {
  if (!appointment.startAt || !appointment.endAt) return null;
  return CalendarEvent.findOneAndUpdate(
    { appointmentId: appointment._id, source: "appointment" },
    {
      $set: {
        title: appointment.title || "Appointment",
        description: appointment.description || appointment.message,
        eventType: "custom",
        startAt: appointment.startAt,
        endAt: appointment.endAt,
        timezone: appointment.timezone || "UTC",
        visibility: appointment.publicBooking ? "private" : "team",
        ownerId: appointment.assignedTo || appointment.caseManagerId || appointment.linkedUser,
        caseId: appointment.caseId,
        companyId: appointment.companyId,
        appointmentId: appointment._id,
        source: "appointment",
        externalProvider: appointment.calendar?.provider === "internal" ? "none" : appointment.calendar?.provider,
        externalEventId: appointment.calendar?.externalEventId,
        metadata: {
          status: appointment.status,
          type: appointment.type,
          meetingProvider: appointment.meetingProvider,
          meetingUrl: appointment.meetingUrl,
        },
        updatedBy: actor?._id,
      },
      $setOnInsert: { createdBy: actor?._id },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

function buildRecurrenceDates(startAt, recurrence = {}) {
  if (!startAt || !recurrence.enabled || !recurrence.frequency) return [];
  const maxCount = Math.min(Number(recurrence.count || 0) || 12, 52);
  const interval = Math.max(Number(recurrence.interval || 1), 1);
  const until = recurrence.until ? new Date(recurrence.until) : null;
  const dates = [];
  let cursor = new Date(startAt);
  for (let index = 1; index < maxCount; index += 1) {
    cursor = new Date(cursor);
    if (recurrence.frequency === "daily") cursor.setDate(cursor.getDate() + interval);
    if (recurrence.frequency === "weekly") cursor.setDate(cursor.getDate() + interval * 7);
    if (recurrence.frequency === "monthly") cursor.setMonth(cursor.getMonth() + interval);
    if (recurrence.frequency === "yearly") cursor.setFullYear(cursor.getFullYear() + interval);
    if (until && cursor > until) break;
    dates.push(new Date(cursor));
  }
  return dates;
}

async function createRecurringInstances(parent, payload, user, req) {
  const dates = buildRecurrenceDates(parent.startAt, parent.recurrence);
  if (!dates.length) return [];
  const durationMs = parent.endAt && parent.startAt ? parent.endAt.getTime() - parent.startAt.getTime() : Number(parent.durationMinutes || 30) * 60000;
  const seriesId = parent.recurrence?.seriesId || parent._id.toString();
  parent.recurrence = { ...(parent.recurrence?.toObject?.() || parent.recurrence || {}), seriesId };
  await parent.save();
  const created = [];
  for (const startAt of dates) {
    const instancePayload = {
      ...payload,
      startAt,
      endAt: new Date(startAt.getTime() + durationMs),
      recurrence: {
        enabled: false,
        parentAppointmentId: parent._id,
        seriesId,
      },
      rescheduledFrom: undefined,
    };
    const appointmentData = normalizeAppointmentPayload(instancePayload, user, {}, payload.publicBooking);
    await assertNoSchedulingConflicts(appointmentData);
    const appointment = await Appointment.create(appointmentData);
    addAuditEntry(appointment, "create_recurring_instance", user, { parentAppointmentId: parent._id }, req);
    await appointment.save();
    await upsertCalendarEventForAppointment(appointment, user);
    created.push(appointment);
  }
  return created;
}

function normalizeAppointmentPayload(payload, user, context = {}, publicBooking = false) {
  const startAt = payload.startAt ? new Date(payload.startAt) : undefined;
  const endAt = payload.endAt ? new Date(payload.endAt) : (startAt && payload.durationMinutes ? new Date(startAt.getTime() + Number(payload.durationMinutes) * 60000) : undefined);
  return {
    ...payload,
    startAt,
    endAt,
    linkedUser: payload.linkedUser || payload.clientId || context.clientId || user?._id,
    clientId: payload.clientId || payload.linkedUser || context.clientId || user?._id,
    assignedTo: payload.assignedTo || context.caseManagerId,
    caseManagerId: payload.caseManagerId || context.caseManagerId,
    companyId: payload.companyId || context.companyId,
    teamId: payload.teamId || context.teamId,
    status: payload.status || (startAt ? "scheduled" : "pending"),
    reminders: payload.reminders || defaultReminders(startAt),
    publicBooking,
    selfScheduled: payload.selfScheduled || publicBooking,
    legacySource: payload.legacySource || (publicBooking ? "BAIS" : "shared"),
  };
}

async function createAppointment(payload, user, req, publicBooking = false) {
  if (!canCreateAppointment(user, publicBooking)) {
    const error = new Error("Not authorized to create appointments");
    error.status = 403;
    throw error;
  }
  const context = await hydrateCaseContext(payload);
  if (context.caseData && user && !caseService.canAccessCase(user, context.caseData)) {
    const error = new Error("Not authorized to schedule appointments for this case");
    error.status = 403;
    throw error;
  }

  const appointmentData = normalizeAppointmentPayload(payload, user, context, publicBooking);
  await assertNoSchedulingConflicts(appointmentData);

  const appointment = await Appointment.create(appointmentData);
  if (publicBooking) {
    const teamLead = await User.findOne({ role: "team_lead", isActive: { $ne: false } }).sort({ updatedAt: 1 }).select("_id teamId");
    if (teamLead?._id) {
      await notificationService.createNotification({
        userId: teamLead._id,
        type: "consultation_requested",
        title: "New Consultation Request",
        message: `${payload.name || payload.email || "A client"} requested a consultation.`,
        link: "/appointments",
        priority: appointment.type === "emergency_consultation" ? "high" : "medium",
        metadata: { appointmentId: appointment._id },
      }, user, req).catch(() => {});
    } else {
      await notificationService.createForRoles?.(["admin"], {
        type: "consultation_requested",
        title: "New Consultation Request",
        message: `${payload.name || payload.email || "A client"} requested a consultation and needs team lead review.`,
        link: "/appointments",
        priority: "high",
        metadata: { appointmentId: appointment._id },
      }, user, req).catch(() => {});
    }
  }
  addAuditEntry(appointment, "create", user, payload, req);
  await appointment.save();
  await upsertCalendarEventForAppointment(appointment, user);
  const recurringInstances = await createRecurringInstances(appointment, payload, user, req);
  await notifyAppointment(appointment, user, "appointment_created", req);
  await writeAuditLog("create", appointment, user, payload, req);
  if (recurringInstances.length) await writeAuditLog("create_recurring_series", appointment, user, { count: recurringInstances.length }, req);
  return appointment;
}

// `systemAuthorized` is a narrow, server-code-only escape hatch — never
// settable from a request body — for callers that have already performed
// their OWN equally-strong authorization check before reaching here (e.g.
// consultation.service.js's signed booking-token verification for an
// anonymous, account-less prospect, who by definition has no `user` for
// canManageAppointment/sameId(linkedUser) to match against).
async function updateAppointment(appointment, payload, user, req, { systemAuthorized = false } = {}) {
  if (!systemAuthorized && !canManageAppointment(user, appointment) && !sameId(appointment.linkedUser, user?._id)) {
    const error = new Error("Not authorized to update this appointment");
    error.status = 403;
    throw error;
  }
  const allowedFields = [
    "title", "description", "type", "status", "priority", "startAt", "endAt", "timezone", "durationMinutes",
    "locationType", "location", "meetingUrl", "meetingProvider", "meetingProviderMetadata", "assignedTo", "caseManagerId", "notes", "message",
    "resourceIds", "attendees", "calendar", "confirmationRequired",
  ];
  const changes = {};
  allowedFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      changes[field] = { from: appointment[field], to: payload[field] };
      appointment[field] = ["startAt", "endAt"].includes(field) && payload[field] ? new Date(payload[field]) : payload[field];
    }
  });
  if (payload.reminders) appointment.reminders = payload.reminders;
  await assertNoSchedulingConflicts({ ...appointment.toObject(), excludeId: appointment._id });
  addAuditEntry(appointment, "update", user, changes, req);
  await appointment.save();
  await upsertCalendarEventForAppointment(appointment, user);
  await notifyAppointment(appointment, user, "appointment_updated", req);
  await writeAuditLog("update", appointment, user, changes, req);
  return appointment;
}

async function cancelAppointment(appointment, payload, user, req, { systemAuthorized = false } = {}) {
  if (!systemAuthorized && !canManageAppointment(user, appointment) && !sameId(appointment.linkedUser, user?._id)) {
    const error = new Error("Not authorized to cancel this appointment");
    error.status = 403;
    throw error;
  }
  appointment.status = "cancelled";
  appointment.cancelledAt = new Date();
  appointment.cancelledBy = user?._id;
  appointment.cancellationReason = payload.reason || payload.cancellationReason;
  addAuditEntry(appointment, "cancel", user, payload, req);
  await appointment.save();
  await CalendarEvent.findOneAndUpdate({ appointmentId: appointment._id, source: "appointment" }, { deletedAt: new Date(), updatedBy: user?._id });
  await notifyAppointment(appointment, user, "appointment_cancelled", req);
  await writeAuditLog("cancel", appointment, user, payload, req);
  return appointment;
}

async function rescheduleAppointment(appointment, payload, user, req, options = {}) {
  const previousId = appointment._id;
  const updated = await updateAppointment(appointment, {
    ...payload,
    status: payload.status || "rescheduled",
    rescheduledFrom: previousId,
  }, user, req, options);
  await notifyAppointment(updated, user, "appointment_rescheduled", req);
  return updated;
}

async function notifyAppointment(appointment, actor, eventType, req) {
  const recipients = new Set();
  [appointment.linkedUser, appointment.clientId, appointment.assignedTo, appointment.caseManagerId]
    .filter(Boolean)
    .forEach((id) => recipients.add(id.toString()));
  const titleByEvent = {
    appointment_created: "Appointment Scheduled",
    appointment_updated: "Appointment Updated",
    appointment_cancelled: "Appointment Cancelled",
    appointment_reminder: "Appointment Reminder",
  };
  await Promise.all([...recipients].map((userId) => notificationService.createNotification({
    userId,
    type: eventType === "appointment_cancelled" ? "appointment_cancelled" : eventType === "appointment_rescheduled" ? "appointment_rescheduled" : eventType === "appointment_reminder" ? "appointment_reminder_24h" : appointment.type === "biometrics" ? "biometric_appointment" : "appointment_scheduled",
    title: titleByEvent[eventType] || "Appointment Update",
    message: `${appointment.title || "Appointment"}${appointment.startAt ? ` on ${appointment.startAt.toISOString()}` : ""}`,
    caseId: appointment.caseId,
    link: `/appointments/${appointment._id}`,
    priority: eventType === "appointment_reminder" ? "high" : "medium",
    metadata: { appointmentId: appointment._id, eventType },
  }, actor, req)));
}

async function getAvailability({ userId, from, to, durationMinutes = 30 }) {
  const start = from ? new Date(from) : new Date();
  const end = to ? new Date(to) : new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);
  const availability = await CalendarAvailability.findOne({ userId });
  const appointments = await Appointment.find({
    status: { $nin: ["cancelled", "completed", "no_show"] },
    startAt: { $lt: end },
    endAt: { $gt: start },
    $or: [
      { assignedTo: userId },
      { caseManagerId: userId },
      { "attendees.user": userId },
    ],
  }).select("startAt endAt");
  const busy = appointments.map((item) => ({ startAt: item.startAt, endAt: item.endAt }));
  const slots = [];
  // Working-hours timezone is one value for the whole availability window
  // set (matches how setHostAvailability/CalendarAvailability store it) —
  // NOT the server process's own local timezone, and NOT UTC by default.
  const timeZone = availability?.timezone || DEFAULT_AVAILABILITY_TIMEZONE;
  const windows = availability?.workingHours?.length ? availability.workingHours : [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startTime: "09:00", endTime: "18:00" }));
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const { year, month, day, dayOfWeek } = zonedDateParts(cursor, timeZone);
    const dayWindows = windows.filter((window) => Number(window.dayOfWeek) === dayOfWeek);
    for (const window of dayWindows) {
      const [startHour, startMinute] = window.startTime.split(":").map(Number);
      const [endHour, endMinute] = window.endTime.split(":").map(Number);
      let slot = zonedTimeToUtc(year, month, day, startHour, startMinute, timeZone);
      const dayEnd = zonedTimeToUtc(year, month, day, endHour, endMinute, timeZone);
      while (slot.getTime() + Number(durationMinutes) * 60000 <= dayEnd.getTime()) {
        const slotEnd = new Date(slot.getTime() + Number(durationMinutes) * 60000);
        const blocked = busy.some((item) => item.startAt < slotEnd && item.endAt > slot);
        const blackedOut = availability?.blackouts?.some((item) => item.startAt < slotEnd && item.endAt > slot);
        if (!blocked && !blackedOut && slot > new Date()) slots.push({ startAt: new Date(slot), endAt: slotEnd, timezone: timeZone });
        slot = new Date(slot.getTime() + Number(durationMinutes) * 60000);
      }
    }
  }
  return { availability, busy, slots: slots.slice(0, 100) };
}

async function getDashboard(query, user) {
  const filter = await buildAppointmentFilter(query, user);
  const now = new Date();
  const [upcoming, overdueReminders, byStatus, byType] = await Promise.all([
    Appointment.find({ ...filter, startAt: { $gte: now } }).sort({ startAt: 1 }).limit(10),
    Appointment.countDocuments({ ...filter, "reminders.remindAt": { $lte: now }, "reminders.sent": false }),
    Appointment.aggregate([{ $match: filter }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    Appointment.aggregate([{ $match: filter }, { $group: { _id: "$type", count: { $sum: 1 } } }]),
  ]);
  return { upcoming, overdueReminders, byStatus, byType };
}

async function syncCalendar(user, provider) {
  const integration = await CalendarIntegration.findOne({ userId: user._id, provider });
  if (!integration) {
    const error = new Error(`${provider} calendar integration is not connected`);
    error.status = 501;
    throw error;
  }
  integration.syncStatus = "syncing";
  integration.lastSyncedAt = new Date();
  await integration.save();
  integration.syncStatus = "synced";
  await integration.save();
  return { provider, syncStatus: integration.syncStatus, lastSyncedAt: integration.lastSyncedAt };
}

async function sendDueReminders(now = new Date()) {
  const appointments = await Appointment.find({
    status: { $in: ["scheduled", "confirmed", "pending"] },
    "reminders.remindAt": { $lte: now },
    "reminders.sent": false,
  });
  let sent = 0;
  for (const appointment of appointments) {
    let changed = false;
    for (const reminder of appointment.reminders) {
      if (!reminder.sent && reminder.remindAt <= now) {
        await notifyAppointment(appointment, null, "appointment_reminder");
        reminder.sent = true;
        reminder.sentAt = now;
        changed = true;
        sent += 1;
      }
    }
    if (changed) await appointment.save();
  }
  return sent;
}

function populateAppointmentQuery(query) {
  return query.populate([
    { path: "linkedUser", select: "name displayName email role phone" },
    { path: "clientId", select: "name displayName email role phone" },
    { path: "assignedTo", select: "name displayName email role" },
    { path: "caseManagerId", select: "name displayName email role" },
    { path: "caseId", select: "caseNumber caseId clientName visaType" },
    { path: "resourceIds", select: "name type location capacity" },
  ]);
}

module.exports = {
  buildAppointmentFilter,
  canAccessAppointment,
  canManageAppointment,
  cancelAppointment,
  createAppointment,
  getAvailability,
  getDashboard,
  rescheduleAppointment,
  sendDueReminders,
  syncCalendar,
  updateAppointment,
  populateAppointmentQuery,
};
