const questionEngineService = require("./questionEngine.service");
const scoringService = require("./scoring.service");
const recommendationService = require("./recommendation.service");
const entityConfigService = require("../entity-config/entityConfig.service");
const telemetryService = require("../telemetry/telemetry.service");
const complianceService = require("../compliance/compliance.service");
const leadService = require("../leads/lead.service");
const Settings = require("../../models/Settings");
const Case = require("../../models/Case");
const caseService = require("../cases/case.service");
const emailService = require("../email/email.service");
const notificationService = require("../notifications/notification.service");
const { VISA_PATHWAYS } = require("./quiz.config");

function badRequest(message) {
  const error = new Error(message);
  error.status = 422;
  return error;
}

// Defense in depth alongside the frontend's BlockIfHasCase/StartAssessmentButton
// gating: a determined or replayed client could still POST directly to this
// public endpoint. req.user is only ever populated here when the request
// carried a valid Bearer token (see optionalAuthenticate.js) — anonymous
// submissions (the real funnel) are completely unaffected by this check.
async function rejectIfHasCase(req) {
  if (!req?.user) return;
  const filter = caseService.buildCaseFilter({}, req.user);
  const exists = await Case.exists(filter);
  if (exists) {
    const error = new Error("This account already has an active case.");
    error.status = 409;
    error.code = "CASE_EXISTS";
    throw error;
  }
}

function isKnownVisaPathway(visaPathway) {
  return VISA_PATHWAYS.some((v) => v.key === visaPathway);
}

// Single-fetch payload for the public quiz landing/question page: the
// question set, the answer scale, the versions the frontend must echo back
// on submit (so the server can detect a stale client), and the Phase 0
// disclaimer + brand tokens so the page never needs a second round-trip.
async function getDefinitionPayload({ visaPathway, sessionId, req } = {}) {
  const [definition, scoringConfig, publicConfig, settings] = await Promise.all([
    questionEngineService.resolveDefinition(visaPathway),
    questionEngineService.resolveScoringConfig(visaPathway),
    entityConfigService.getPublicConfig(),
    Settings.findOne({ key: "global" }).select("gaMeasurementId").lean(),
  ]);

  telemetryService.track({
    name: "quiz.started",
    sessionId,
    properties: { visaPathway: definition.visaPathway },
    ip: req?.ip,
  }).catch(() => {});

  return {
    visaPathway: definition.visaPathway,
    profileQuestions: definition.profileQuestions,
    criteriaQuestions: definition.criteriaQuestions,
    quizDefinitionVersion: definition.version,
    scoringConfigVersion: scoringConfig.version,
    disclaimer: publicConfig.disclaimer,
    disclaimerVersion: publicConfig.disclaimerVersion,
    brandTokens: publicConfig.brandTokens,
    lawFirmConfigured: publicConfig.lawFirmConfigured,
    gaMeasurementId: settings?.gaMeasurementId || "",
  };
}

function listVisaPathways() {
  return questionEngineService.listVisaPathways();
}

// Server is the source of truth for the score — a client-supplied
// tier/score (if any is even sent) is always ignored; everything is
// recomputed here from the currently active config.
async function submit(payload = {}, req) {
  await rejectIfHasCase(req);

  const visaPathway = payload.visaPathway;
  if (!visaPathway || !isKnownVisaPathway(visaPathway)) {
    throw badRequest(`Unknown visaPathway "${visaPathway}"`);
  }
  if (!Array.isArray(payload.criteriaAnswers)) {
    throw badRequest("criteriaAnswers must be an array");
  }

  const [definition, scoringConfig] = await Promise.all([
    questionEngineService.resolveDefinition(visaPathway),
    questionEngineService.resolveScoringConfig(visaPathway),
  ]);

  // The public quiz no longer collects 0-3 "evidence strength" answers (see
  // EligibilityQuiz.jsx — replaced by the 5 fixed qualifying questions in
  // profileAnswers instead). Scoring/tier logic still runs for any visa an
  // admin has configured with real criteriaAnswers via the DB-authored quiz
  // CRUD, but a criteria-less submit skips it entirely rather than producing
  // a meaningless "Tier D" on every single lead.
  const hasCriteriaAnswers = payload.criteriaAnswers.length > 0;
  const scoreResult = hasCriteriaAnswers
    ? scoringService.score(payload.criteriaAnswers, scoringConfig, {
        scaleLabelsByKey: questionEngineService.scaleLabelsByKey(definition),
        scoringConfigVersion: scoringConfig.version,
        quizDefinitionVersion: definition.version,
      })
    : null;

  const recommendation = scoreResult
    ? await recommendationService.build(scoreResult, scoringConfig)
    : { pathwayString: `${visaPathway} consultation`, alternativePathways: [], nextStep: `Let's go over your ${visaPathway} options in a free consultation.` };

  let disclaimerAcceptedVersion;
  if (payload.disclaimerAccepted) {
    const acceptance = await complianceService.recordAcceptance({
      sessionId: payload.sessionId,
      context: "public_quiz",
      req,
    }).catch(() => null);
    disclaimerAcceptedVersion = acceptance?.disclaimerVersion;
  }

  const ipHash = telemetryService.hashIp(req?.ip);
  const lead = await leadService.createQuizLead({
    fullName: payload.fullName,
    email: payload.email,
    phone: payload.phone,
    visaPathway,
    source: payload.source,
    utm: payload.utm,
    sessionId: payload.sessionId,
    profileAnswers: payload.profileAnswers,
    criteriaAnswers: scoreResult ? scoreResult.evidenceStrength.map(({ key, value, met, developable }) => ({ key, value, met, developable })) : [],
    scoreResult: scoreResult || undefined,
    disclaimerAcceptedVersion,
    nextStep: recommendation.nextStep,
    ipHash,
  }, req);

  telemetryService.track({
    name: "quiz.completed",
    sessionId: payload.sessionId,
    properties: { visaPathway, tier: scoreResult?.tier, criteriaMetCount: scoreResult?.criteriaMetCount },
    utm: payload.utm,
    ip: req?.ip,
  }).catch(() => {});

  return {
    tier: scoreResult?.tier,
    pathwayString: recommendation.pathwayString,
    alternativePathways: recommendation.alternativePathways,
    evidenceStrength: scoreResult?.evidenceStrength || [],
    nextStep: recommendation.nextStep,
    leadId: lead._id,
    routing: scoreResult?.routing,
  };
}

// Public, unauthenticated draft autosave — see EligibilityQuiz.jsx (fires on
// every step advance) and lead.service.js's saveDraftLead (the actual
// upsert). Deliberately does none of submit()'s scoring/email/notification
// side effects; it only ever needs to persist whatever's been answered so
// far.
async function saveDraft(payload = {}, req) {
  const lead = await leadService.saveDraftLead(payload, req);
  return { leadId: lead._id };
}

const Lead = require("../../models/Lead");

function buildLeadFilter(query = {}) {
  const filter = {};
  if (query.tier) filter["scoreResult.tier"] = query.tier;
  if (query.visaPathway) filter.visaPathway = query.visaPathway;
  if (query.status) filter.status = query.status;
  if (query.utmSource) filter["utm.source"] = query.utmSource;
  if (query.utmCampaign) filter["utm.campaign"] = query.utmCampaign;
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(query.from);
    if (query.to) filter.createdAt.$lte = new Date(query.to);
  }
  return filter;
}

async function listLeads(query = {}) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 25, 1), 200);
  const filter = buildLeadFilter(query);
  const [items, total] = await Promise.all([
    Lead.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate("consultationId").populate("assignedTo", "name displayName email").lean(),
    Lead.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 } };
}

async function getLead(id) {
  return Lead.findById(id).populate("consultationId").populate("strategyQueueId").populate("assignedTo", "name displayName email").lean();
}

function notFoundError(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function invalidTransitionError(fromStatus, action) {
  const error = new Error(`Cannot ${action} from lead status "${fromStatus}"`);
  error.status = 409;
  error.code = "INVALID_TRANSITION";
  return error;
}

// Shared-team-inbox semantics: the first admin to open a lead clears its
// "new/unseen" state for every admin, matching how this app's other
// notification "read" state works (not a per-admin read receipt).
// Every lead mutation below re-populates consultationId/assignedTo before
// returning — the admin frontend replaces its whole in-memory lead object
// with whatever these return (see AdminPortal.jsx's handle* callbacks), so
// an unpopulated response here would silently wipe out consultation/assignee
// details that listLeads()/getLead() had already populated, the moment a
// user opens (markLeadSeen) or acts on a lead.
async function repopulateLead(lead) {
  return lead.populate([{ path: "consultationId" }, { path: "assignedTo", select: "name displayName email" }]);
}

async function markLeadSeen(id, user) {
  const lead = await Lead.findById(id);
  if (!lead) throw notFoundError("Lead not found");
  if (!lead.seenAt) {
    lead.seenAt = new Date();
    lead.seenBy = user?._id;
    await lead.save();
  }
  return repopulateLead(lead);
}

async function updateLeadStatus(id, status, req) {
  const lead = await Lead.findById(id);
  if (!lead) throw notFoundError("Lead not found");
  lead.status = status;
  await lead.save();
  await require("../audit/audit.service").recordAuditEvent({
    req, action: "lead.status_update", entityType: "Lead", entityId: String(lead._id), severity: "low", metadata: { status },
  });
  return repopulateLead(lead);
}

async function assignLead(id, assignedTo, req) {
  const lead = await Lead.findById(id);
  if (!lead) throw notFoundError("Lead not found");
  lead.assignedTo = assignedTo || null;
  await lead.save();
  await require("../audit/audit.service").recordAuditEvent({
    req, action: "lead.assign", entityType: "Lead", entityId: String(lead._id), severity: "low", metadata: { assignedTo },
  });
  return repopulateLead(lead);
}

async function addLeadNote(id, text, user, req) {
  if (!text?.trim()) throw badRequest("note text is required");
  const lead = await Lead.findById(id);
  if (!lead) throw notFoundError("Lead not found");
  lead.notes.push({ text: text.trim(), author: user?._id });
  await lead.save();
  await require("../audit/audit.service").recordAuditEvent({
    req, action: "lead.note_add", entityType: "Lead", entityId: String(lead._id), severity: "low",
  });
  return repopulateLead(lead);
}

// The four functions below enforce the Phase 6 lead state machine
// (new/booked -> consultation_confirmed -> consultation_completed ->
// approved -> [converted, handled entirely by POST /api/cases] with
// rejected as a terminal branch off either consultation status). Unlike
// updateLeadStatus (an unrestricted admin override, left untouched above),
// each of these only permits its one specific transition.

async function confirmConsultation(id, user, req) {
  const lead = await Lead.findById(id);
  if (!lead) throw notFoundError("Lead not found");
  if (!["new", "booked"].includes(lead.status)) {
    throw invalidTransitionError(lead.status, "confirm consultation");
  }
  lead.status = "consultation_confirmed";
  lead.consultation = lead.consultation || {};
  lead.consultation.confirmedAt = new Date();
  lead.consultation.scheduledBy = user?._id;
  await lead.save();
  await require("../audit/audit.service").recordAuditEvent({
    req, action: "lead.consultation_confirm", entityType: "Lead", entityId: String(lead._id), severity: "low",
  });
  emailService.sendTemplateEmail("consultation-confirmation", {
    to: lead.email,
    data: { fullName: lead.fullName },
  }).catch(() => {});
  return repopulateLead(lead);
}

async function completeConsultation(id, notes, req) {
  const lead = await Lead.findById(id);
  if (!lead) throw notFoundError("Lead not found");
  if (lead.status !== "consultation_confirmed") {
    throw invalidTransitionError(lead.status, "mark consultation complete");
  }
  lead.status = "consultation_completed";
  lead.consultation = lead.consultation || {};
  lead.consultation.completedAt = new Date();
  if (notes) lead.consultation.notes = notes;
  await lead.save();
  await require("../audit/audit.service").recordAuditEvent({
    req, action: "lead.consultation_complete", entityType: "Lead", entityId: String(lead._id), severity: "low",
  });
  return repopulateLead(lead);
}

async function approveLead(id, user, req) {
  const lead = await Lead.findById(id);
  if (!lead) throw notFoundError("Lead not found");
  if (lead.status !== "consultation_completed") {
    throw invalidTransitionError(lead.status, "approve");
  }
  lead.status = "approved";
  lead.approval = lead.approval || {};
  lead.approval.approvedAt = new Date();
  lead.approval.approvedBy = user?._id;
  await lead.save();
  await require("../audit/audit.service").recordAuditEvent({
    req, action: "lead.approve", entityType: "Lead", entityId: String(lead._id), severity: "low",
  });
  emailService.sendTemplateEmail("lead-approved", {
    to: lead.email,
    data: { fullName: lead.fullName },
  }).catch(() => {});
  notificationService.createForRoles(["super_admin", "admin", "team_lead"], {
    type: "lead_approved",
    title: "Lead approved — ready for case creation",
    message: `${lead.fullName || lead.email} is approved and ready to convert to a case.`,
    link: "/leads",
  }, user, req).catch(() => {});
  return repopulateLead(lead);
}

async function rejectLead(id, rejectionReason, req) {
  const lead = await Lead.findById(id);
  if (!lead) throw notFoundError("Lead not found");
  if (!["consultation_confirmed", "consultation_completed"].includes(lead.status)) {
    throw invalidTransitionError(lead.status, "reject");
  }
  lead.status = "rejected";
  lead.approval = lead.approval || {};
  lead.approval.rejectedAt = new Date();
  lead.approval.rejectionReason = rejectionReason || "";
  await lead.save();
  await require("../audit/audit.service").recordAuditEvent({
    req, action: "lead.reject", entityType: "Lead", entityId: String(lead._id), severity: "low", metadata: { rejectionReason },
  });
  emailService.sendTemplateEmail("lead-rejected", {
    to: lead.email,
    data: { fullName: lead.fullName },
  }).catch(() => {});
  return repopulateLead(lead);
}

module.exports = {
  getDefinitionPayload, listVisaPathways, submit, saveDraft, listLeads, getLead,
  markLeadSeen, updateLeadStatus, assignLead, addLeadNote,
  confirmConsultation, completeConsultation, approveLead, rejectLead,
};
