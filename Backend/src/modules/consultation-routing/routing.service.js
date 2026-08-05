const Settings = require("../../models/Settings");
const Lead = require("../../models/Lead");
const StrategyCallQueueItem = require("../../models/StrategyCallQueueItem");
const Appointment = require("../../models/Appointment");
const appointmentService = require("../appointments/appointment.service");
const entityConfigService = require("../entity-config/entityConfig.service");
const telemetryService = require("../telemetry/telemetry.service");
const emailService = require("../email/email.service");
const auditService = require("../audit/audit.service");

const DIRECT_ROUTINGS = new Set(["direct_priority", "direct"]);

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

// Picks the first roster entry (Settings.consultationRouting, founder-
// provided — Phase 1 Section 12) that covers this visa pathway + language
// and hasn't hit its daily capacity cap yet. Returns null when no roster is
// configured at all, or every matching entry is at capacity — callers must
// treat null as "fall back to the strategy queue," never as an error.
async function resolveConsultant(visaPathway, languagePreference = "English") {
  const settings = await Settings.findOne({ key: "global" }).select("consultationRouting");
  const roster = settings?.consultationRouting || [];
  if (!roster.length) return null;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  for (const entry of roster) {
    const coversVisa = !entry.visaPathways?.length || entry.visaPathways.includes(visaPathway);
    const coversLanguage = !entry.languages?.length || entry.languages.includes(languagePreference);
    if (!coversVisa || !coversLanguage) continue;
    const bookedToday = await Appointment.countDocuments({
      assignedTo: entry.userId,
      startAt: { $gte: todayStart, $lte: todayEnd },
      status: { $nin: ["cancelled", "no_show"] },
    });
    if (bookedToday >= (entry.dailyCapacityCap || 8)) continue;
    return entry.userId;
  }
  return null;
}

async function ensureQueueItem(lead) {
  if (lead.strategyQueueId) {
    const existing = await StrategyCallQueueItem.findById(lead.strategyQueueId);
    if (existing) return existing;
  }
  const queueItem = await StrategyCallQueueItem.create({
    leadId: lead._id,
    tier: lead.scoreResult?.tier,
    visaPathway: lead.visaPathway,
    languagePreference: lead.languagePreference || "English",
  });
  lead.strategyQueueId = queueItem._id;
  await lead.save();
  telemetryService.track({
    name: "strategy_queue.created",
    properties: { tier: lead.scoreResult?.tier, visaPathway: lead.visaPathway },
  }).catch(() => {});
  return queueItem;
}

// Returns the booking options for a lead: direct-booking availability when
// the lead's tier routes to direct booking AND a roster consultant is
// available, otherwise a (possibly fallback) strategy-queue placement.
async function getOptions(leadId, { languagePreference } = {}) {
  const lead = await Lead.findById(leadId);
  if (!lead) throw notFound("Lead not found");

  const isDirectRouting = DIRECT_ROUTINGS.has(lead.scoreResult?.routing);
  if (isDirectRouting) {
    const consultantId = await resolveConsultant(lead.visaPathway, languagePreference || lead.languagePreference);
    if (consultantId) {
      const availability = await appointmentService.getAvailability({ userId: consultantId, durationMinutes: 30 });
      return {
        mode: "direct_booking",
        priority: lead.scoreResult.routing === "direct_priority",
        rosterConfigured: true,
        consultantId,
        slots: availability.slots,
      };
    }
    // No roster configured (or every match over capacity) — fall back to
    // the strategy queue rather than pretending a calendar exists.
    const queueItem = await ensureQueueItem(lead);
    return {
      mode: "strategy_queue",
      priority: lead.scoreResult.routing === "direct_priority",
      rosterConfigured: false,
      queueItemId: queueItem._id,
      message: "A booking calendar hasn't been configured yet for your pathway — our team will reach out to schedule your consultation.",
    };
  }

  const queueItem = await ensureQueueItem(lead);
  return { mode: "strategy_queue", rosterConfigured: true, queueItemId: queueItem._id };
}

async function book(leadId, { startAt, endAt, durationMinutes, timezone }, req) {
  const lead = await Lead.findById(leadId);
  if (!lead) throw notFound("Lead not found");
  if (!DIRECT_ROUTINGS.has(lead.scoreResult?.routing)) {
    throw badRequest("This lead is routed to the strategy queue, not direct booking");
  }
  if (!startAt) throw badRequest("startAt is required");

  const consultantId = await resolveConsultant(lead.visaPathway, lead.languagePreference);
  if (!consultantId) throw badRequest("No booking calendar is configured for this pathway yet — use the strategy queue instead");

  const appointment = await appointmentService.createAppointment({
    name: lead.fullName,
    email: lead.email,
    phone: lead.phone,
    visaType: lead.visaPathway,
    type: lead.scoreResult.routing === "direct_priority" ? "initial_consultation" : "consultation",
    priority: lead.scoreResult.routing === "direct_priority" ? "high" : "medium",
    assignedTo: consultantId,
    startAt,
    endAt,
    durationMinutes: durationMinutes || 30,
    timezone,
  }, null, req, true);

  lead.consultationId = appointment._id;
  lead.status = "booked";
  await lead.save();

  const publicConfig = await entityConfigService.getPublicConfig().catch(() => ({}));
  await emailService.sendTemplateEmail("consultation-confirmation", {
    to: lead.email,
    data: {
      fullName: lead.fullName,
      startAt: appointment.startAt,
      meetingUrl: appointment.meetingUrl,
      msoEntityShortName: publicConfig.msoEntityShortName,
    },
    source: "shared",
  }).catch(() => null);

  telemetryService.track({
    name: "consultation.booked",
    properties: { tier: lead.scoreResult.tier, visaPathway: lead.visaPathway },
  }).catch(() => {});

  await auditService.recordAuditEvent({
    req,
    action: "consultation.booked",
    entityType: "Lead",
    entityId: String(lead._id),
    severity: "low",
    metadata: { appointmentId: String(appointment._id) },
  });

  return { appointment, lead };
}

async function listQueue(query = {}) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.tier) filter.tier = query.tier;
  if (query.visaPathway) filter.visaPathway = query.visaPathway;
  return StrategyCallQueueItem.find(filter).sort({ createdAt: 1 }).populate("leadId").populate("assignedTo", "name displayName email");
}

async function claim(queueItemId, user, req) {
  const item = await StrategyCallQueueItem.findById(queueItemId);
  if (!item) throw notFound("Queue item not found");
  if (item.status !== "queued") throw badRequest(`Queue item is already ${item.status}`);
  item.status = "claimed";
  item.assignedTo = user._id;
  await item.save();
  await auditService.recordAuditEvent({
    req,
    action: "strategy_queue.claimed",
    entityType: "StrategyCallQueueItem",
    entityId: String(item._id),
    severity: "low",
  });
  return item;
}

module.exports = { resolveConsultant, getOptions, book, listQueue, claim, ensureQueueItem };
