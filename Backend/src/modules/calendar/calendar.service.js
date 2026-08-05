const CalendarAvailability = require("../../models/CalendarAvailability");
const CalendarEvent = require("../../models/CalendarEvent");
const CalendarIntegration = require("../../models/CalendarIntegration");
const CalendarResource = require("../../models/CalendarResource");
const Appointment = require("../../models/Appointment");
const appointmentService = require("../appointments/appointment.service");
const { normalizeRole } = require("../authorization/roleHierarchy");

function canManageCalendar(user) {
  return ["super_admin", "admin", "case_manager", "team_lead"].includes(normalizeRole(user?.role));
}

async function listEvents(query, user) {
  const filter = { deletedAt: { $exists: false } };
  if (query.eventType) filter.eventType = query.eventType;
  if (query.caseId) filter.caseId = query.caseId;
  if (query.ownerId) filter.ownerId = query.ownerId;
  if (query.from || query.to) {
    filter.startAt = {};
    if (query.from) filter.startAt.$gte = new Date(query.from);
    if (query.to) filter.startAt.$lte = new Date(query.to);
  }
  if (!canManageCalendar(user)) {
    filter.$or = [
      { ownerId: user._id },
      { visibility: "public" },
      { visibility: "company", companyId: user.companyId },
      { appointmentId: { $exists: true } },
    ];
  }
  return CalendarEvent.find(filter).sort({ startAt: 1 }).limit(Math.min(Number(query.limit || 500), 1000));
}

async function combinedCalendar(query, user) {
  const appointmentFilter = await appointmentService.buildAppointmentFilter(query, user);
  const [appointments, events] = await Promise.all([
    appointmentService.populateAppointmentQuery(Appointment.find(appointmentFilter).sort({ startAt: 1 }).limit(500)),
    listEvents(query, user),
  ]);
  return {
    appointments,
    events,
    items: [
      ...appointments.map((appointment) => ({
        id: appointment._id,
        source: "appointment",
        title: appointment.title,
        start: appointment.startAt,
        end: appointment.endAt,
        status: appointment.status,
        type: appointment.type,
        appointment,
      })),
      ...events.map((event) => ({
        id: event._id,
        source: event.source,
        title: event.title,
        start: event.startAt,
        end: event.endAt,
        type: event.eventType,
        event,
      })),
    ].sort((left, right) => new Date(left.start) - new Date(right.start)),
  };
}

async function upsertAvailability(userId, payload, actor) {
  return CalendarAvailability.findOneAndUpdate(
    { userId },
    { $set: { ...payload, userId, updatedBy: actor?._id }, $setOnInsert: { createdBy: actor?._id } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );
}

async function createResource(payload, user) {
  return CalendarResource.create({ ...payload, createdBy: user?._id });
}

async function updateResource(id, payload, user) {
  return CalendarResource.findByIdAndUpdate(id, { ...payload, updatedBy: user?._id }, { new: true, runValidators: true });
}

async function upsertIntegration(payload, user) {
  return CalendarIntegration.findOneAndUpdate(
    { userId: payload.userId || user._id, provider: payload.provider },
    { $set: { ...payload, userId: payload.userId || user._id, updatedBy: user._id, syncStatus: payload.syncEnabled ? "connected" : "not_connected" }, $setOnInsert: { createdBy: user._id } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );
}

async function createEvent(payload, user) {
  return CalendarEvent.create({ ...payload, createdBy: user?._id, ownerId: payload.ownerId || user?._id });
}

async function updateEvent(id, payload, user) {
  return CalendarEvent.findByIdAndUpdate(id, { ...payload, updatedBy: user?._id }, { new: true, runValidators: true });
}

async function suggestSlots(query, user) {
  const userId = query.userId || query.attorneyId || query.caseManagerId || user._id;
  const availability = await appointmentService.getAvailability({ ...query, userId, durationMinutes: query.durationMinutes || 30 });
  return availability.slots.slice(0, Number(query.count || 5)).map((slot, index) => ({
    ...slot,
    score: 100 - index * 5,
    reason: index === 0 ? "Earliest available conflict-free slot" : "Available conflict-free slot",
  }));
}

module.exports = {
  combinedCalendar,
  createEvent,
  createResource,
  listEvents,
  suggestSlots,
  updateEvent,
  updateResource,
  upsertAvailability,
  upsertIntegration,
};
