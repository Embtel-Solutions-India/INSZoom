const Settings = require("../../models/Settings");
const User = require("../../models/User");
const Appointment = require("../../models/Appointment");
const CalendarAvailability = require("../../models/CalendarAvailability");
const Lead = require("../../models/Lead");
const appointmentService = require("../appointments/appointment.service");
const leadService = require("../leads/lead.service");
const entityConfigService = require("../entity-config/entityConfig.service");
const emailService = require("../email/email.service");
const notificationService = require("../notifications/notification.service");
const telemetryService = require("../telemetry/telemetry.service");
const auditService = require("../audit/audit.service");
const realtimeGateway = require("../realtime/realtime.gateway");
const bookingTokenService = require("./bookingToken.service");
const { buildConsultationIcs } = require("./ics.service");

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 422;
  return error;
}

async function resolveConfig() {
  const settings = await Settings.findOne({ key: "global" }).select("consultation");
  const config = settings?.consultation || {};
  let hostUserId = config.hostUserId;
  let hostConfigured = true;
  if (!hostUserId) {
    hostConfigured = false;
    const fallbackHost = await User.findOne({ role: "super_admin", isActive: { $ne: false } }).select("_id").sort({ createdAt: 1 });
    hostUserId = fallbackHost?._id || null;
  }
  return {
    hostUserId,
    hostConfigured,
    publicHostName: config.publicHostName || "Our Immigration Team",
    durationMinutes: config.durationMinutes || 30,
    bufferMinutes: config.bufferMinutes ?? 15,
    locationType: config.locationType || "video",
    meetingLink: config.meetingLink || "",
    timezone: config.timezone || "America/Los_Angeles",
    minNoticeHours: config.minNoticeHours ?? 12,
    bookingWindowDays: config.bookingWindowDays || 21,
    dailyCap: config.dailyCap || 0,
  };
}

// Public-facing meeting summary. Deliberately excludes hostUserId and any
// other internal identity — only what a prospect needs to decide to book.
async function getPublicConfig() {
  const [config, publicEntityConfig] = await Promise.all([
    resolveConfig(),
    entityConfigService.getPublicConfig().catch(() => ({})),
  ]);
  return {
    title: "Free Consultation",
    durationMinutes: config.durationMinutes,
    locationType: config.locationType,
    publicHostName: config.publicHostName,
    timezone: config.timezone,
    brandTokens: publicEntityConfig.brandTokens,
    disclaimer: publicEntityConfig.disclaimer,
  };
}

// Resolves bookable slots for the host: delegates the actual working-hours/
// blackout/existing-appointment math to the appointments module (never
// duplicated here), then layers on this feature's own rules — buffer
// padding between bookings, a minimum-notice cutoff, a hard booking-window
// cap, and a daily booking cap — before returning ONLY start/end times.
async function getPublicSlots({ from, to } = {}) {
  const config = await resolveConfig();
  if (!config.hostUserId) return { slots: [], durationMinutes: config.durationMinutes, timezone: config.timezone };

  const now = new Date();
  const earliest = new Date(now.getTime() + config.minNoticeHours * 60 * 60 * 1000);
  const latest = new Date(now.getTime() + config.bookingWindowDays * 24 * 60 * 60 * 1000);
  const rangeStart = from && new Date(from) > earliest ? new Date(from) : earliest;
  const rangeEnd = to && new Date(to) < latest ? new Date(to) : latest;
  if (rangeStart >= rangeEnd) return { slots: [], durationMinutes: config.durationMinutes, timezone: config.timezone };

  const availability = await appointmentService.getAvailability({
    userId: config.hostUserId,
    from: rangeStart,
    to: rangeEnd,
    durationMinutes: config.durationMinutes,
  });

  const bufferMs = config.bufferMinutes * 60 * 1000;
  const paddedBusy = availability.busy.map((b) => ({
    startAt: new Date(new Date(b.startAt).getTime() - bufferMs),
    endAt: new Date(new Date(b.endAt).getTime() + bufferMs),
  }));

  let dailyCounts = null;
  if (config.dailyCap > 0) {
    const counts = await Appointment.aggregate([
      { $match: { assignedTo: config.hostUserId, startAt: { $gte: rangeStart, $lte: rangeEnd }, status: { $nin: ["cancelled", "no_show"] } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$startAt" } }, count: { $sum: 1 } } },
    ]);
    dailyCounts = new Map(counts.map((c) => [c._id, c.count]));
  }

  const slots = availability.slots.filter((slot) => {
    const overlapsBuffer = paddedBusy.some((b) => b.startAt < slot.endAt && b.endAt > slot.startAt);
    if (overlapsBuffer) return false;
    if (dailyCounts) {
      const dayKey = new Date(slot.startAt).toISOString().slice(0, 10);
      if ((dailyCounts.get(dayKey) || 0) >= config.dailyCap) return false;
    }
    return true;
  }).map((slot) => ({ startAt: slot.startAt, endAt: slot.endAt }));

  return { slots, durationMinutes: config.durationMinutes, timezone: config.timezone };
}

function manageUrlFor(token) {
  const base = (process.env.CLIENT_URLS || process.env.CLIENT_URL || "http://localhost:5173").split(",")[0].trim();
  return `${base}/consultation/booking/${token}`;
}

async function notifyHost(appointment, config, lead) {
  const host = await User.findById(config.hostUserId).select("email name displayName").lean();
  if (!host) return;

  await emailService.sendTemplateEmail("consultation-host-notify", {
    to: host.email,
    data: {
      fullName: appointment.name,
      email: appointment.email,
      phone: appointment.phone,
      startAt: appointment.startAt,
      visaPathway: lead?.visaPathway,
      tier: lead?.scoreResult?.tier,
      criteriaMetCount: lead?.scoreResult?.criteriaMetCount,
    },
    source: "shared",
  }).catch(() => null);

  await notificationService.createNotification({
    userId: config.hostUserId,
    type: "consultation_booked",
    title: `New consultation booked: ${appointment.name}`,
    message: `${appointment.startAt.toLocaleString?.() || appointment.startAt} — ${lead?.scoreResult?.tier ? `Tier ${lead.scoreResult.tier}` : "General inquiry"}`,
    link: "/admin/portal?tab=appointments",
    priority: lead?.scoreResult?.tier === "A" ? "high" : "medium",
    channels: ["in_app", "socket", "push"],
    metadata: { appointmentId: String(appointment._id), leadId: lead ? String(lead._id) : undefined },
    source: "shared",
  }).catch(() => null);
}

// Booking is atomic in the same sense the rest of this codebase is:
// appointmentService.createAppointment() re-checks for a scheduling
// conflict immediately before the write and throws 409 if the slot was
// taken between the client fetching slots and submitting — there is no
// separate/duplicate conflict check here.
async function book({ leadId, name, email, phone, startAt, note, source, visaType }, req) {
  if (!name || !email || !startAt) throw badRequest("name, email, and startAt are required");
  const config = await resolveConfig();
  if (!config.hostUserId) throw badRequest("Consultation booking is not configured yet — no host is set");

  const start = new Date(startAt);
  const end = new Date(start.getTime() + config.durationMinutes * 60 * 1000);

  let lead = null;
  if (leadId) lead = await Lead.findById(leadId);

  const appointment = await appointmentService.createAppointment({
    name,
    email: String(email).toLowerCase(),
    phone,
    visaType: lead?.visaPathway,
    message: note,
    type: "initial_consultation",
    priority: lead?.scoreResult?.tier === "A" ? "high" : "medium",
    assignedTo: config.hostUserId,
    startAt: start,
    endAt: end,
    durationMinutes: config.durationMinutes,
    locationType: config.locationType,
    meetingUrl: config.locationType === "video" ? config.meetingLink : undefined,
    leadTier: lead?.scoreResult?.tier || null,
  }, null, req, true);

  if (lead) {
    lead.consultationId = appointment._id;
    lead.status = "booked";
    lead.consultation = lead.consultation || {};
    lead.consultation.requestedAt = lead.consultation.requestedAt || new Date();
    lead.consultation.scheduledAt = appointment.startAt;
    if (note) lead.consultation.notes = note;
    await lead.save();
    // Mirrors lead.service.js's "lead:created" push (see LeadsInbox) so an
    // already-open admin Leads Inbox reflects the new booking — including
    // the consultation date/time — live, with no manual refresh needed.
    await lead.populate("consultationId");
    realtimeGateway.emitToRole("admin", "lead:updated", lead);
    realtimeGateway.emitToRole("case_manager", "lead:updated", lead);
  } else {
    lead = await leadService.createConsultationLead({
      fullName: name,
      email,
      phone,
      visaType,
      message: note,
      source: source || "BAIS scheduled consultation",
    }, req, {
      status: "booked",
      consultationId: appointment._id,
      requestedAt: new Date(),
      scheduledAt: appointment.startAt,
    });
    await lead.populate("consultationId");
    realtimeGateway.emitToRole("admin", "lead:updated", lead);
    realtimeGateway.emitToRole("case_manager", "lead:updated", lead);
  }

  const bookingToken = bookingTokenService.issue(String(appointment._id));
  const manageUrl = manageUrlFor(bookingToken);

  const publicConfig = await entityConfigService.getPublicConfig().catch(() => ({}));
  const icsContent = buildConsultationIcs({
    uid: `${appointment._id}@consultation.immigration-crm`,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    summary: `Free Consultation with ${config.publicHostName}`,
    description: config.locationType === "phone" ? "We'll call you at the phone number provided." : (config.meetingLink || "Video call details to follow."),
    location: config.locationType === "video" ? config.meetingLink : "Phone call",
  });

  await emailService.sendTemplateEmail("consultation-confirmation", {
    to: appointment.email,
    data: {
      fullName: appointment.name,
      startAt: appointment.startAt,
      meetingUrl: config.locationType === "video" ? config.meetingLink : "",
      locationType: config.locationType,
      publicHostName: config.publicHostName,
      manageUrl,
      msoEntityShortName: publicConfig.msoEntityShortName,
    },
    attachments: [{ filename: "consultation.ics", content: icsContent, contentType: "text/calendar" }],
    source: "shared",
  }).catch(() => null);

  await notifyHost(appointment, config, lead);

  telemetryService.track({
    name: "consultation.booked",
    properties: { tier: lead?.scoreResult?.tier, visaPathway: lead?.visaPathway },
    ip: req?.ip,
  }).catch(() => {});

  await auditService.recordAuditEvent({
    req,
    action: "consultation.booked",
    entityType: "Appointment",
    entityId: String(appointment._id),
    severity: "low",
    metadata: { leadId: lead ? String(lead._id) : undefined },
  });

  return {
    bookingToken,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    timezone: config.timezone,
    publicHostName: config.publicHostName,
    locationType: config.locationType,
    meetingLinkOrPhone: config.locationType === "video" ? config.meetingLink : "phone",
    leadId: lead ? String(lead._id) : undefined,
  };
}

async function resolveAppointmentByToken(token) {
  const decoded = bookingTokenService.verify(token);
  if (!decoded) {
    const error = new Error("This booking link is invalid or has expired");
    error.status = 410;
    throw error;
  }
  const appointment = await Appointment.findById(decoded.appointmentId);
  if (!appointment) throw notFound("Booking not found");
  return appointment;
}

// Neutral, prospect-facing booking detail — no host identity.
async function getByToken(token) {
  const appointment = await resolveAppointmentByToken(token);
  const config = await resolveConfig();
  return {
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    status: appointment.status,
    publicHostName: config.publicHostName,
    locationType: appointment.locationType,
    meetingUrl: appointment.locationType === "video" ? appointment.meetingUrl : undefined,
    name: appointment.name,
    email: appointment.email,
  };
}

async function reschedule(token, newStartAt, req) {
  const appointment = await resolveAppointmentByToken(token);
  const config = await resolveConfig();
  if (!newStartAt) throw badRequest("newStartAt is required");

  const start = new Date(newStartAt);
  const end = new Date(start.getTime() + config.durationMinutes * 60 * 1000);
  const updated = await appointmentService.rescheduleAppointment(appointment, { startAt: start, endAt: end }, null, req, { systemAuthorized: true });

  const publicConfig = await entityConfigService.getPublicConfig().catch(() => ({}));
  await emailService.sendTemplateEmail("consultation-reschedule", {
    to: updated.email,
    data: {
      fullName: updated.name,
      startAt: updated.startAt,
      meetingUrl: config.locationType === "video" ? config.meetingLink : "",
      locationType: config.locationType,
      publicHostName: config.publicHostName,
      manageUrl: manageUrlFor(token),
      msoEntityShortName: publicConfig.msoEntityShortName,
    },
    source: "shared",
  }).catch(() => null);

  telemetryService.track({ name: "consultation.rescheduled", properties: {}, ip: req?.ip }).catch(() => {});
  return { startAt: updated.startAt, endAt: updated.endAt };
}

async function cancel(token, reason, req) {
  const appointment = await resolveAppointmentByToken(token);
  const cancelled = await appointmentService.cancelAppointment(appointment, { reason }, null, req, { systemAuthorized: true });

  const publicConfig = await entityConfigService.getPublicConfig().catch(() => ({}));
  await emailService.sendTemplateEmail("consultation-cancel", {
    to: cancelled.email,
    data: { fullName: cancelled.name, startAt: cancelled.startAt, reason, msoEntityShortName: publicConfig.msoEntityShortName },
    source: "shared",
  }).catch(() => null);

  telemetryService.track({ name: "consultation.cancelled", properties: {}, ip: req?.ip }).catch(() => {});
  return { status: cancelled.status };
}

async function getHostAvailability() {
  const config = await resolveConfig();
  if (!config.hostUserId) return null;
  return CalendarAvailability.findOne({ userId: config.hostUserId });
}

async function setHostAvailability(payload, actor, req) {
  const config = await resolveConfig();
  if (!config.hostUserId) throw badRequest("Set a consultation host before configuring availability");

  const updated = await CalendarAvailability.findOneAndUpdate(
    { userId: config.hostUserId },
    {
      $set: {
        timezone: payload.timezone,
        workingHours: payload.workingHours,
        slotDurationMinutes: config.durationMinutes,
        selfSchedulingEnabled: true,
        updatedBy: actor?._id,
      },
      $setOnInsert: { createdBy: actor?._id },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
  );

  await auditService.recordAuditEvent({
    req,
    action: "consultation.availability_updated",
    entityType: "CalendarAvailability",
    entityId: String(updated._id),
    severity: "medium",
  });

  return updated;
}

module.exports = {
  resolveConfig,
  getPublicConfig,
  getPublicSlots,
  book,
  getByToken,
  reschedule,
  cancel,
  getHostAvailability,
  setHostAvailability,
};
