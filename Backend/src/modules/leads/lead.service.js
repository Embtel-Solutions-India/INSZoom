const LeadModel = require("../../models/Lead");
const Settings = require("../../models/Settings");
const emailService = require("../email/email.service");
const entityConfigService = require("../entity-config/entityConfig.service");
const telemetryService = require("../telemetry/telemetry.service");
const crmSyncService = require("../eligibility-quiz/crmSync.service");
const notificationService = require("../notifications/notification.service");
const realtimeGateway = require("../realtime/realtime.gateway");
const CaseNumberService = require("../../services/CaseNumberService");

const STAFF_ROLES = ["super_admin", "admin", "case_manager"];

const LEAD_EMAIL_RECIPIENT = "kritagya@bayareaimmigrationservices.com";

function clean(value) {
  return String(value || "").trim();
}

// Preserved for backward compatibility — some existing/legacy callers may
// still read `email.mailtoUrl`/`email.subject`/`email.body` off createLead()'s
// return value; nothing about the response shape changes.
function buildLeadEmail(lead) {
  const createdAt = lead.createdAt ? new Date(lead.createdAt).toLocaleString("en-US") : new Date().toLocaleString("en-US");
  const subject = `New Consultation Lead - ${lead.fullName}`;
  const body = [
    "A new consultation lead has been received from the BAIS client portal.",
    "",
    `Name: ${lead.fullName}`,
    `Email: ${lead.email}`,
    `Phone: ${lead.phone}`,
    `Visa Type: ${lead.visaType || "Not specified"}`,
    `Source: ${lead.source || "BAIS appointment form"}`,
    `Submitted: ${createdAt}`,
    "",
    "Message:",
    lead.message || "No message provided.",
  ].join("\n");

  return {
    subject,
    body,
    mailtoUrl: `mailto:${LEAD_EMAIL_RECIPIENT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  };
}

async function resolveNotificationRecipient() {
  const settings = await Settings.findOne({ key: "global" }).select("leadNotificationEmail");
  return settings?.leadNotificationEmail || LEAD_EMAIL_RECIPIENT;
}

// Two independent channels, both best-effort:
//  1. A single configured recipient (Settings.leadNotificationEmail, falling
//     back to the legacy hardcoded address) gets the plain email — this is
//     the original Phase 1 mechanism and stays exactly as-is.
//  2. Every admin/case_manager gets a real in-app + push + socket
//     notification (via the shared notification system, not a bespoke one)
//     so the admin Leads Inbox lights up live regardless of who's logged in
//     — this is the piece Phase 1 was missing.
async function notifyStaffOfLead(lead) {
  const to = await resolveNotificationRecipient();
  const emailData = {
    fullName: lead.fullName,
    email: lead.email,
    phone: lead.phone,
    visaPathway: lead.visaPathway,
    source: lead.source,
    tier: lead.scoreResult?.tier,
    criteriaMetCount: lead.scoreResult?.criteriaMetCount,
    routing: lead.scoreResult?.routing,
  };

  await emailService.sendTemplateEmail("quiz-lead-internal", { to, data: emailData, source: "shared" }).catch(() => null);

  const tierLabel = lead.scoreResult?.tier ? ` (Tier ${lead.scoreResult.tier})` : "";
  await notificationService.createForRoles(STAFF_ROLES, {
    type: "lead_created",
    title: `New lead: ${lead.fullName}${tierLabel}`,
    message: `${lead.visaPathway || "General inquiry"} — ${lead.email}`,
    link: "/admin/portal?tab=leads",
    priority: lead.scoreResult?.tier === "A" ? "high" : "medium",
    channels: ["in_app", "socket", "push"],
    metadata: { leadId: String(lead._id), tier: lead.scoreResult?.tier },
    source: "shared",
  }).catch(() => null);

  realtimeGateway.emitToRole("admin", "lead:created", lead);
  realtimeGateway.emitToRole("case_manager", "lead:created", lead);
}

async function createConsultationLead(payload = {}, req, options = {}) {
  const visaPathway = clean(payload.visaPathway || payload.visaType || payload.visaInterest || payload.visa);
  const message = clean(payload.message || payload.note);
  const lead = await LeadModel.create({
    fullName: clean(payload.fullName || payload.name),
    email: clean(payload.email).toLowerCase(),
    phone: clean(payload.phone),
    visaPathway,
    visaInterest: visaPathway,
    source: clean(payload.source) || "BAIS consultation request",
    message,
    status: options.status || "new",
    leadNumber: await CaseNumberService.nextLeadNumber(),
    consultationId: options.consultationId || null,
    consultation: {
      requestedAt: options.requestedAt || new Date(),
      scheduledAt: options.scheduledAt || null,
      notes: message,
    },
    userAgent: req?.headers?.["user-agent"],
  });
  await notifyStaffOfLead(lead);
  return lead;
}

// Backward-compatible entry point for the existing `/leads/public` contract
// (BAIS appointment/consultation form). Now ALSO persists a `Lead` document
// (previously this only ever produced a mailto: link and never touched the
// database) and sends the staff notification via sendTemplateEmail instead
// of a hardcoded mailto recipient — the response shape callers already rely
// on (`{lead, email}`) is unchanged.
async function createLead(payload = {}, req) {
  const leadData = {
    fullName: clean(payload.fullName || payload.name),
    email: clean(payload.email).toLowerCase(),
    phone: clean(payload.phone),
    visaType: clean(payload.visaType || payload.visa),
    message: clean(payload.message),
    source: clean(payload.source) || "BAIS appointment form",
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
    createdAt: new Date(),
  };

  const email = buildLeadEmail(leadData);
  leadData.mailtoUrl = email.mailtoUrl;

  const persisted = await createConsultationLead({
    fullName: leadData.fullName,
    email: leadData.email,
    phone: leadData.phone,
    visaType: leadData.visaType,
    source: leadData.source,
    message: leadData.message,
  }, req, {
    status: "new",
    requestedAt: leadData.createdAt,
  });

  return { lead: { ...leadData, leadId: persisted._id, leadNumber: persisted.leadNumber }, email };
}

// Full public-quiz lead: persists the complete quiz payload (profile +
// criteria answers + scoreResult + UTM + disclaimer version + ipHash), sends
// the prospect confirmation email, fires telemetry, and enqueues CRM sync
// (fire-and-forget — never awaited by the caller, so submit() stays fast).
async function createQuizLead(payload, req) {
  const lead = await LeadModel.create({
    fullName: payload.fullName,
    email: payload.email,
    phone: payload.phone,
    visaPathway: payload.visaPathway,
    source: payload.source || "public_quiz",
    utm: payload.utm,
    profileAnswers: payload.profileAnswers,
    criteriaAnswers: payload.criteriaAnswers,
    scoreResult: payload.scoreResult,
    disclaimerAcceptedVersion: payload.disclaimerAcceptedVersion,
    ipHash: payload.ipHash,
    userAgent: req?.headers?.["user-agent"],
  });

  const publicConfig = await entityConfigService.getPublicConfig().catch(() => ({}));
  await emailService.sendTemplateEmail("quiz-lead-confirmation", {
    to: lead.email,
    data: {
      fullName: lead.fullName,
      visaPathway: lead.visaPathway,
      pathwayString: lead.scoreResult?.pathwayString,
      nextStep: payload.nextStep,
      msoEntityShortName: publicConfig.msoEntityShortName,
    },
    source: "shared",
  }).catch(() => null);
  await notifyStaffOfLead(lead);

  telemetryService.track({
    name: "lead.created",
    sessionId: payload.sessionId,
    properties: { visaPathway: lead.visaPathway, tier: lead.scoreResult?.tier, routing: lead.scoreResult?.routing },
    utm: payload.utm,
    ip: req?.ip,
  }).catch(() => {});

  // Fire-and-forget: CRM sync must never delay or fail the quiz submit response.
  crmSyncService.syncLead(lead, req).catch(() => {});

  return lead;
}

// PHASE 4 — shared field-mapping helper for the two new lead-creation paths
// below. Lead.js (confirmed by reading the model directly) has no
// `quizAnswers` field — only `profileAnswers` (Mixed, generic) and
// `criteriaAnswers` (a typed array meant for the scored quiz specifically).
// Both new endpoints store their raw answers payload in `profileAnswers`,
// the field that actually exists and is already the generic "raw answers"
// slot on this model, rather than inventing a new schema field for a Phase 4
// deliverable that only needs an additive column, not a data-shape change.
function buildLeadData({ contact, visaInterest, extensionInterest, answers, source }) {
  return {
    fullName: clean(contact?.name || contact?.fullName),
    email: clean(contact?.email).toLowerCase(),
    phone: clean(contact?.phone),
    source,
    status: "new",
    visaInterest: clean(visaInterest),
    extensionInterest: clean(extensionInterest),
    profileAnswers: answers && typeof answers === "object" ? answers : {},
  };
}

/**
 * PHASE 4 — POST /api/leads (public, pre-login quiz-shaped submission).
 *
 * INVARIANT: creates exactly one Lead document. Never creates a Case, User,
 * Client, or any canonical/form data — confirmed by inspection: this
 * function touches only the Lead collection (via LeadModel.create) and the
 * shared notifyStaffOfLead() helper (email + in-app notification, no model
 * writes of its own beyond Notification).
 *
 * Deliberately a parallel function rather than a thin wrapper around
 * createQuizLead(): that function's payload/response contract is tied to
 * the real scored quiz (profileAnswers/criteriaAnswers/scoreResult with
 * tier/pathwayString/routing, its own quiz-lead-confirmation email that
 * reads scoreResult.pathwayString) — see EligibilityQuiz.jsx, which stays
 * on the pre-existing POST /api/eligibility-quiz/submit path per Step 21's
 * explicit "leave it unchanged" instruction and is not wired to this new
 * endpoint. This function's simpler {contact, visaInterest, quizAnswers}
 * shape has no score to report, so it reuses only the notification
 * mechanism (notifyStaffOfLead), not the scored-quiz email/CRM-sync/
 * telemetry side effects that assume a completed, scored quiz.
 */
async function createLeadFromQuiz(payload = {}, req) {
  const leadData = buildLeadData({
    contact: payload.contact || { name: payload.fullName || payload.name, email: payload.email, phone: payload.phone },
    visaInterest: payload.visaInterest,
    extensionInterest: payload.extensionInterest,
    answers: payload.quizAnswers,
    source: "quiz",
  });
  leadData.leadNumber = await CaseNumberService.nextLeadNumber();
  leadData.ipHash = payload.ipHash;
  leadData.userAgent = req?.headers?.["user-agent"];

  const lead = await LeadModel.create(leadData);
  await notifyStaffOfLead(lead);
  return lead;
}

/**
 * PHASE 4 — POST /api/leads/from-intake (authenticated client, intake
 * questionnaire submission).
 *
 * INVARIANT: creates exactly one Lead document. Never creates a Case, User,
 * Client, or any canonical/form data. Does NOT itself modify the User
 * document — the caller (lead.controller.js's createLeadFromIntake) is
 * responsible for setting req.user.leadId, since that's a property of the
 * authenticated request, not of lead creation itself.
 *
 * The contact email is always the authenticated user's own email — never
 * taken from the request body — so a client can never create a Lead
 * attributed to a different address than the account submitting it.
 */
async function createLeadFromIntake(payload = {}, user, req) {
  const leadData = buildLeadData({
    contact: { name: user.name || user.displayName, email: user.email, phone: user.phone },
    visaInterest: payload.visaInterest,
    extensionInterest: payload.extensionInterest,
    answers: payload.intakeAnswers,
    source: "intake",
  });
  leadData.leadNumber = await CaseNumberService.nextLeadNumber();
  leadData.userAgent = req?.headers?.["user-agent"];

  const lead = await LeadModel.create(leadData);
  await notifyStaffOfLead(lead);
  return lead;
}

module.exports = {
  LEAD_EMAIL_RECIPIENT,
  buildLeadEmail,
  createLead,
  createConsultationLead,
  createQuizLead,
  createLeadFromQuiz,
  createLeadFromIntake,
};
