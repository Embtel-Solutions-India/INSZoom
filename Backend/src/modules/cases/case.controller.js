const path = require("path");
const multer = require("multer");
const Case = require("../../models/Case");
const CaseAssignmentEvent = require("../../models/CaseAssignmentEvent");
const Client = require("../../models/Client");
const Conversation = require("../../models/Conversation");
const EmployeeProfile = require("../../models/EmployeeProfile");
const EmployerProfile = require("../../models/EmployerProfile");
const Lead = require("../../models/Lead");
const Questionnaire = require("../../models/Questionnaire");
const User = require("../../models/User");
const { resolveDocumentRequirements } = require("../document-requirements/document-requirement.resolver");
const generateCaseNumber = require("./caseId");
const caseService = require("./case.service");
const workflowService = require("./case.workflow.service");
const lifecycleOrchestrator = require("./case-lifecycle-orchestrator.service");
const { evaluateStageGate } = require("./case-gating.config");
const { createPerfTimer } = require("../../utils/perfTimer");
const questionnaireService = require("../questionnaires/questionnaire.service");
const documentService = require("../documents/document.service");
const messageService = require("../messages/message.service");
const paymentGateway = require("../payments/payment.gateway");
const paymentService = require("../payments/payment.service");
const notificationService = require("../notifications/notification.service");
const realtimeGateway = require("../realtime/realtime.gateway");
const storageService = require("../uploads/storage.service");
const { normalizeRole } = require("../authorization/roleHierarchy");
const emailService = require("../email/email.service");
const clientInviteService = require("../auth/clientInvite.service");
const { generateOpaqueToken, hashToken } = require("../auth/password.service");
const { generateUniqueReferralCode } = require("../../utils/referralCode");
const CaseNumberService = require("../../services/CaseNumberService");
const { getCaseStructure } = require("../../config/visaCategories");
const { PACKAGE_NAMES, normalizePackageName } = require("../../config/packages");

const checklistAllowedMimeTypes = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

const PREMIUM_PROCESSING_ADDON = {
  key: "premium_processing_i907",
  service: "Premium Processing",
  form: "I-907",
  processingTime: "15 Business Days",
  governmentFeeCents: 280500,
  attorneyFeeCents: 25000,
  get totalFeeCents() {
    return this.governmentFeeCents + this.attorneyFeeCents;
  },
  requiredDocuments: [
    { name: "Receipt Notice (I-797)", documentType: "i_797_receipt_notice", required: true, status: "requested" },
    { name: "G-28 (if required)", documentType: "g_28", required: false, status: "requested" },
    { name: "Authorization Letter (if employer files)", documentType: "authorization_letter", required: false, status: "requested" },
  ],
};

const I907_QUESTIONNAIRE_KEY = "i907_premium_processing_profile";
const CASE_PLAN_STATUSES = new Set(["not_started", "pending", "failed"]);
const PHASE5_CASE_CREATE_ROLES = new Set(["super_admin", "admin", "team_lead"]);
const CLIENT_SETUP_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

const PREMIUM_PROCESSING_ELIGIBLE_TYPES = new Set([
  "h-1b",
  "h1b",
  "h-1b petition",
  "h1b petition",
  "i-140",
  "i140",
  "i-765",
  "i765",
  "i-539",
  "i539",
  "o-1",
  "o1",
  "l-1",
  "l1",
  "eb-1",
  "eb1",
  "eb-2",
  "eb2",
  "eb-3",
  "eb3",
]);

function normalizePetitionType(value = "") {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function cleanString(value) {
  return String(value || "").trim();
}

function cleanEmail(value) {
  return cleanString(value).toLowerCase();
}

function resolveCreationSource(input, userRole) {
  const requested = cleanString(input);
  if (requested) return requested;
  return normalizeRole(userRole) === "team_lead" ? "team_lead_direct" : "admin_direct";
}

function resolveChildCaseCount(caseStructure, input) {
  if (caseStructure === "single") return 0;
  if (caseStructure === "family") return 1;
  const parsed = Number.parseInt(input, 10);
  return Math.max(1, Number.isFinite(parsed) ? parsed : 1);
}

function resolveDataEntryMode(caseStructure, input) {
  if (caseStructure === "single") return "not_required";
  if (["fill_self", "invite", "not_set"].includes(input)) return input;
  return "not_set";
}

function centsFromPrice(input) {
  if (input === undefined || input === null || input === "") return 0;
  const numeric = Number(input);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.round(numeric > 10000 ? numeric : numeric * 100);
}

function publicCaseSummary(caseData) {
  return {
    _id: caseData._id,
    caseNumber: caseData.caseNumber,
    caseStructure: caseData.caseStructure,
    caseRole: caseData.caseRole,
    childIndex: caseData.childIndex,
    visaType: caseData.visaType,
  };
}

async function cleanupPhase5Create(created) {
  await Promise.allSettled([
    created.employeeProfileIds.length ? EmployeeProfile.deleteMany({ _id: { $in: created.employeeProfileIds } }) : null,
    created.employerProfileIds.length ? EmployerProfile.deleteMany({ _id: { $in: created.employerProfileIds } }) : null,
    created.caseIds.length ? Case.deleteMany({ _id: { $in: created.caseIds } }) : null,
    created.userIds.length ? User.deleteMany({ _id: { $in: created.userIds } }) : null,
  ].filter(Boolean));

  for (const snapshot of created.updatedUsers) {
    const update = {};
    if (Object.keys(snapshot.set || {}).length) update.$set = snapshot.set;
    if (Object.keys(snapshot.unset || {}).length) update.$unset = snapshot.unset;
    await User.findByIdAndUpdate(snapshot._id, update).catch(() => null);
  }
}

function supportsPremiumProcessing(caseData) {
  const values = [
    caseData.petitionType,
    caseData.petitionSubType,
    caseData.visaType,
    caseData.visaCategory,
    caseData.caseType,
  ].map(normalizePetitionType).filter(Boolean);

  return values.some((value) => (
    PREMIUM_PROCESSING_ELIGIBLE_TYPES.has(value)
    || /\bh[\s-]?1b\b/.test(value)
    || /\bi[\s-]?140\b/.test(value)
    || /\bi[\s-]?765\b/.test(value)
    || /\bi[\s-]?539\b/.test(value)
    || /\bo[\s-]?1[a-z]?\b/.test(value)
    || /\bl[\s-]?1[a-z]?\b/.test(value)
    || /\beb[\s-]?[123][a-z]?\b/.test(value)
  ));
}

function getCaseReceiptNumber(caseData) {
  return caseData.uscisReceiptNumber
    || caseData.uscisNumber
    || caseData.receiptTracking?.receiptNumber
    || caseData.immigrationLifecycle?.tracking?.filing?.receiptNumber
    || "";
}

function hasAddon(caseData, key) {
  return (caseData.addons || []).some((addon) => addon.key === key && addon.status !== "cancelled");
}

function premiumProcessingEligibility(caseData) {
  const supportsPremium = supportsPremiumProcessing(caseData);
  const hasReceipt = Boolean(getCaseReceiptNumber(caseData));
  const alreadyUpgraded = hasAddon(caseData, PREMIUM_PROCESSING_ADDON.key);
  const checks = [
    { key: "receipt", label: "Case has USCIS Receipt Number", passed: hasReceipt },
    { key: "eligible", label: "Case is eligible for Premium Processing", passed: supportsPremium },
    { key: "petition_type", label: "Petition Type Supports I-907", passed: supportsPremium },
    { key: "not_upgraded", label: "Petition hasn't already been upgraded", passed: !alreadyUpgraded },
  ];
  return {
    compatible: supportsPremium,
    available: checks.every((check) => check.passed),
    checks,
    message: checks.every((check) => check.passed) ? "" : "Premium Processing is not available for this petition.",
  };
}

function serializePremiumProcessingAddon(caseData) {
  const eligibility = premiumProcessingEligibility(caseData);
  if (!eligibility.compatible) return null;
  return {
    ...PREMIUM_PROCESSING_ADDON,
    totalFeeCents: PREMIUM_PROCESSING_ADDON.totalFeeCents,
    eligibility,
    alreadyPurchased: hasAddon(caseData, PREMIUM_PROCESSING_ADDON.key),
  };
}

function canAssignCase(user, caseData) {
  if (caseService.canAccessCase(user, caseData)) return true;
  return normalizeRole(user?.role) === "team_lead" && !caseData.assignedCaseManager;
}

// Case reassignment (case manager or team lead) must take effect on the
// case's message conversation immediately, not lazily the next time someone
// with valid access happens to open it — otherwise the previous assignee
// keeps seeing the conversation in their Messages pane (and can still send
// on it) until someone else's visit triggers a resync, and the newly
// assigned person may not see it at all until then. Reuses
// messageService.syncCaseConversationParticipants(), the same sync already
// run on every GET /messages/case/:caseId — just triggered proactively here
// instead of only lazily.
async function syncCaseMessagingAssignment(caseData) {
  const conversation = await Conversation.findOne({ caseId: caseData._id, type: "case", deletedAt: { $exists: false } });
  if (conversation) await messageService.syncCaseConversationParticipants(conversation, caseData);
}

function sameId(left, right) {
  const leftId = left?._id?.toString?.() || left?.toString?.();
  const rightId = right?._id?.toString?.() || right?.toString?.();
  return Boolean(leftId && rightId && leftId === rightId);
}

const REASSIGNABLE_ROLES = new Set(["case_manager", "team_lead", "admin", "super_admin"]);

// Reassignment audit + side effects, shared by every assignUser() call site
// (case manager / team lead / primary+secondary owner). A no-op — the
// incoming assignee is already the current holder of that role slot — is
// skipped entirely: nothing was actually reassigned, so no event, no
// eviction, no "you lost this case" notification should fire. Must run
// AFTER caseData.save() so the persisted state matches what's recorded.
async function recordReassignment(caseData, role, previousAssignedTo, assignedTo, actor, req) {
  if (!assignedTo || sameId(previousAssignedTo, assignedTo)) return;

  await CaseAssignmentEvent.create({
    caseId: caseData._id,
    role,
    fromManagerId: previousAssignedTo || null,
    toManagerId: assignedTo,
    reassignedById: actor._id,
    reason: req?.body?.reason || req?.body?.notes || "",
    caseStatusAtReassignment: caseData.status,
  });

  const conversation = await Conversation.findOne({ caseId: caseData._id, type: "case", deletedAt: { $exists: false } });
  if (conversation) {
    if (previousAssignedTo) realtimeGateway.evictUserFromConversation(previousAssignedTo, conversation._id);
    realtimeGateway.joinUserToConversation(assignedTo, conversation._id);
  }

  if (previousAssignedTo) {
    await notificationService.dismissCaseNotificationsForUser(caseData._id, previousAssignedTo).catch(() => {});
    await notificationService.createNotification({
      userId: previousAssignedTo,
      type: "case_reassigned",
      title: "Case Reassigned",
      message: `Case ${caseData.caseNumber || caseData.caseId} has been reassigned to another ${role.replace(/_/g, " ")}. You no longer have access to it.`,
      caseId: caseData._id,
      priority: "low",
      metadata: { assignmentRole: role, toManagerId: assignedTo },
    }, actor, req).catch(() => {});
    realtimeGateway.emitToUser(previousAssignedTo, "case:unassigned", { _id: caseData._id, caseNumber: caseData.caseNumber, assignmentRole: role });
  }
}

// Phase 7 — cascades a principal case's team-lead/case-manager assignment
// down to its child cases, skipping any child that has been individually
// overridden (assignmentOverridden: true — set automatically below whenever
// a child case is the direct target of assignCaseManager/assignTeamLead,
// which is how /assign-override-style behavior is achieved without a
// separate endpoint: this same controller pair already handles any case by
// id, so "assign this one child directly" and "assign-override" are the same
// action). Runs after the principal's own caseData.save() has committed, and
// a cascade failure never rolls back that already-committed assignment.
// Split into two updateMany calls (rather than one aggregation-pipeline
// update) so the conditional pending_assignment -> assigned transition below
// doesn't depend on MongoDB 4.2+ pipeline-update support.
async function cascadeAssignmentToChildren(principalCase, fieldSet) {
  const childFilter = { parentCase: principalCase._id, assignmentOverridden: { $ne: true } };
  const [pendingResult, otherResult] = await Promise.all([
    Case.updateMany(
      { ...childFilter, status: "pending_assignment" },
      { $set: { ...fieldSet, status: "assigned", "workflow.status": "assigned" } }
    ),
    Case.updateMany({ ...childFilter, status: { $ne: "pending_assignment" } }, { $set: fieldSet }),
  ]);
  return (pendingResult.modifiedCount || 0) + (otherResult.modifiedCount || 0);
}

async function notifyAssignee(userId, caseData, role, actor, req) {
  if (!userId) return;
  const packageName = caseData.package || caseData.primaryPackage || caseData.plan?.tier;
  const detailParts = [
    caseData.clientName ? `Client: ${caseData.clientName}` : null,
    caseData.visaType ? `Visa: ${caseData.visaType}` : null,
    packageName ? `Package: ${packageName}` : null,
  ].filter(Boolean);

  // Case Manager assignment additionally requires an email per the case
  // assignment workflow (Team Lead assigns -> Case Manager is emailed).
  // Email dispatch itself is centralized inside notificationService —
  // this controller only supplies the template key + data.
  let emailFields = {};
  if (role === "case_manager") {
    const assignee = await User.findById(userId).select("name displayName email").catch(() => null);
    if (assignee?.email) {
      emailFields = {
        emailTemplate: "case-assigned-case-manager",
        emailTo: assignee.email,
        emailData: { caseManagerName: assignee.name || assignee.displayName, caseNumber: caseData.caseNumber || caseData.caseId, clientName: caseData.clientName },
      };
    }
  }

  await notificationService.createNotification({
    userId,
    type: "case_assigned",
    title: "Case Assigned",
    message: `You have been assigned as ${role.replace(/_/g, " ")} for case ${caseData.caseNumber || caseData.caseId}.${detailParts.length ? ` ${detailParts.join(" · ")}` : ""}`,
    caseId: caseData._id,
    link: `/crm-cases/${caseData._id}`,
    priority: "medium",
    metadata: {
      assignmentRole: role,
      clientName: caseData.clientName,
      clientEmail: caseData.clientEmail,
      visaType: caseData.visaType,
      visaCategory: caseData.visaCategory,
      package: packageName,
    },
    ...emailFields,
  }, actor, req).catch(() => {});

  // Realtime push so "My Assigned Cases" updates without a page refresh
  realtimeGateway.emitToUser(userId, "case:assigned", {
    _id: caseData._id,
    caseNumber: caseData.caseNumber,
    clientName: caseData.clientName,
    visaType: caseData.visaType,
    package: packageName,
    priority: caseData.priority,
    status: caseData.status,
    assignmentRole: role,
  });
}

// `notifyAssignee` above tells the STAFF member being assigned. Separately,
// the CLIENT needs to know who is now handling their case - a distinct
// audience, distinct template ("case-manager-assigned" the first time,
// "case-manager-reassigned" when replacing a prior case manager), and a
// distinct failure mode (this must never block or roll back an assignment
// that already succeeded, hence the .catch(() => {}) - same convention as
// notifyAssignee's own email/notification call).
async function notifyClientOfCaseManagerAssignment(caseData, caseManagerId, previousCaseManagerId, actor, req) {
  if (!caseData.user) return;
  const caseManager = await User.findById(caseManagerId).select("name displayName").catch(() => null);
  const caseManagerName = caseManager?.name || caseManager?.displayName || "your case manager";
  const isReassignment = Boolean(previousCaseManagerId);
  const emailTemplate = isReassignment ? "case-manager-reassigned" : "case-manager-assigned";
  const portalLink = `${process.env.BAIS_FRONTEND_URL || "http://localhost:5173"}/dashboard/case/${caseData._id}`;

  await notificationService.createNotification({
    userId: caseData.user,
    type: "case_assigned",
    category: "case",
    title: isReassignment ? "Your Case Has a New Case Manager" : "Your Case Manager Has Been Assigned",
    message: `${caseManagerName} is now managing your case ${caseData.caseNumber || caseData.caseId}.`,
    caseId: caseData._id,
    link: `/dashboard/case/${caseData._id}`,
    priority: "high",
    source: "shared",
    channels: ["in_app", "socket", "push", "email"],
    emailTemplate,
    emailTo: caseData.clientEmail,
    emailData: {
      clientName: caseData.clientName,
      caseNumber: caseData.caseNumber || caseData.caseId,
      caseManagerName,
      portalLink,
    },
  }, actor, req).catch(() => {});
}

exports.checklistUploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.MAX_UPLOAD_SIZE_BYTES || 10 * 1024 * 1024), files: 10 },
  fileFilter: (req, file, cb) => {
    if (checklistAllowedMimeTypes.has(file.mimetype)) return cb(null, true);
    return cb(new Error("Invalid file type. Allowed: PDF, JPG, PNG, DOC, DOCX, TXT"));
  },
}).array("files", 10);

async function getCaseOr404(id, res) {
  const caseData = await Case.findById(id);
  if (!caseData) {
    res.status(404).json({ success: false, message: "Case not found" });
    return null;
  }
  return caseData;
}

async function getAuthorizedCase(req, res) {
  const caseData = await getCaseOr404(req.params.id, res);
  if (!caseData) return null;
  if (!caseService.canAccessCase(req.user, caseData)) {
    res.status(403).json({ success: false, message: "You do not have permission to access this case" });
    return null;
  }
  return caseData;
}

function handleError(error, next) {
  if (next) return next(error);
  throw error;
}

exports.getCaseConfig = async (req, res, next) => {
  try {
    res.json({
      success: true,
      lifecycleStages: Case.lifecycleStages,
      stages: Case.crmStages,
      statuses: Case.statuses,
      priorities: Case.priorities,
    });
  } catch (error) {
    handleError(error, next);
  }
};

exports.getMyCase = async (req, res, next) => {
  // Stage breakdown for the endpoint that was 504-ing in production: mongo_query
  // isolates the populate fan-out's actual DB time (vs. pool-checkout wait,
  // already visible separately via mongodb_pool_checkout_wait) from
  // serialization time, so a future slowdown here shows which stage grew
  // instead of just "the request was slow." Never sent to the client — logged
  // server-side only, via timer.done()/mark(), same as cases_list_performance.
  const timer = createPerfTimer("cases_my_performance", { requestId: req.requestId, userId: req.user?._id });
  try {
    const filter = caseService.buildCaseFilter({}, req.user);
    timer.mark("filter_resolved");
    // .lean(): this is a pure read (serializeCaseForUser/summarizeCase only
    // ever read from it, never .save() it) feeding a 16-path populate, which
    // is already a heavy connection-pool draw per request (see
    // mongodb_pool_checkout_wait in prod logs) — lean() skips Mongoose
    // document hydration/casting on all 17 documents involved, shortening how
    // long each of those pool connections is held. Case has no schema
    // virtuals, so this changes no field in the response.
    //
    // Prefer req.user.primaryCaseId over "most recently created match" when
    // the filter matches more than one case. This matters specifically for
    // the employer/employee pre-invite window: createCase intentionally sets
    // Case.user to the employer's own account on BOTH the principal and every
    // child case (so "fill self" mode needs no extra wiring, and
    // inviteEmployee's ALREADY_INVITED check/ownership transfer assumes that
    // starting state - see inviteEmployee's comment on childCase.user). Before
    // an employee is invited, an employer's filter above matches both their
    // principal case and every one of its children, and .sort({createdAt:-1})
    // always picked the child (created after the principal in the same
    // request) - the employer's own "my case" endpoint returned their
    // employee's case, showing the wrong checklist/dashboard state entirely.
    // primaryCaseId is set once at account creation/invite time and never
    // repointed at a child case for the original employer account, so it
    // reliably names "this login's own case" for both an employer and an
    // invited employee (whose primaryCaseId points at their own child case).
    let caseData = req.user.primaryCaseId
      ? await caseService.populateCaseQueryForClient(Case.findOne({ ...filter, _id: req.user.primaryCaseId }).lean())
      : null;
    if (!caseData) {
      caseData = await caseService.populateCaseQueryForClient(Case.findOne(filter).sort({ createdAt: -1 }).lean());
    }
    timer.mark("mongo_query_completed", { found: Boolean(caseData) });
    if (!caseData) {
      timer.done({ found: false });
      return res.json(null);
    }
    const payload = caseService.serializeCaseForUser(caseData, req.user);
    payload.caseSummary = caseService.summarizeCase(caseData);
    timer.mark("serialization_completed");
    timer.done({ found: true });
    res.json(payload);
  } catch (error) {
    timer.done({ error: true });
    handleError(error, next);
  }
};

exports.getAvailableAddons = async (req, res, next) => {
  try {
    if (caseService.isRestrictedPortalRole(req.user?.role)) {
      return res.status(403).json({ success: false, message: "Not authorized to access case upgrades" });
    }
    const caseData = await getAuthorizedCase(req, res);
    if (!caseData) return;
    const premiumProcessing = serializePremiumProcessingAddon(caseData);
    res.json({
      success: true,
      addons: premiumProcessing ? [premiumProcessing] : [],
      purchased: caseData.addons || [],
    });
  } catch (error) {
    handleError(error, next);
  }
};

exports.purchaseAddon = async (req, res, next) => {
  try {
    if (caseService.isRestrictedPortalRole(req.user?.role)) {
      return res.status(403).json({ success: false, message: "Not authorized to purchase case upgrades" });
    }
    const caseData = await getAuthorizedCase(req, res);
    if (!caseData) return;
    const addonKey = req.params.addonKey || req.body.addonKey;
    if (addonKey !== PREMIUM_PROCESSING_ADDON.key) {
      return res.status(404).json({ success: false, message: "Upgrade is not available" });
    }
    const eligibility = premiumProcessingEligibility(caseData);
    if (!eligibility.available) {
      return res.status(400).json({ success: false, message: eligibility.message, eligibility });
    }

    const payment = await paymentService.createPayment({
      caseId: caseData._id,
      user: caseData.user || req.user._id,
      packageKey: PREMIUM_PROCESSING_ADDON.key,
      packageName: "Premium Processing Upgrade (Form I-907)",
      baseAmount: PREMIUM_PROCESSING_ADDON.totalFeeCents,
      totalAmount: PREMIUM_PROCESSING_ADDON.totalFeeCents,
      totalFee: PREMIUM_PROCESSING_ADDON.totalFeeCents,
      planKey: "pay_in_full",
      legacySource: "BAIS",
      notes: `Upgrade for case ${caseData.caseNumber || caseData.caseId}`,
      billingItems: [
        {
          code: "I-907_GOVERNMENT_FEE",
          description: "Premium Processing Government Fee",
          quantity: 1,
          unitAmount: PREMIUM_PROCESSING_ADDON.governmentFeeCents,
          amount: PREMIUM_PROCESSING_ADDON.governmentFeeCents,
          taxable: false,
        },
        {
          code: "I-907_ATTORNEY_FEE",
          description: "Premium Processing Attorney Fee",
          quantity: 1,
          unitAmount: PREMIUM_PROCESSING_ADDON.attorneyFeeCents,
          amount: PREMIUM_PROCESSING_ADDON.attorneyFeeCents,
          taxable: false,
        },
      ],
    }, req.user, req);

    caseData.addons.push({
      key: PREMIUM_PROCESSING_ADDON.key,
      service: PREMIUM_PROCESSING_ADDON.service,
      form: PREMIUM_PROCESSING_ADDON.form,
      status: "payment_pending",
      paymentStatus: "pending",
      payment: payment._id,
      governmentFeeCents: PREMIUM_PROCESSING_ADDON.governmentFeeCents,
      attorneyFeeCents: PREMIUM_PROCESSING_ADDON.attorneyFeeCents,
      totalFeeCents: PREMIUM_PROCESSING_ADDON.totalFeeCents,
      processingTime: PREMIUM_PROCESSING_ADDON.processingTime,
      purchasedAt: new Date(),
      requiredDocuments: PREMIUM_PROCESSING_ADDON.requiredDocuments,
      intake: { relatedReceiptNumber: getCaseReceiptNumber(caseData), relatedFormNumber: caseData.petitionType || caseData.visaType },
      history: [{ status: "payment_pending", note: "Premium Processing upgrade requested", by: req.user._id }],
    });
    PREMIUM_PROCESSING_ADDON.requiredDocuments.forEach((document) => {
      // Dedup by documentType against BOTH mirrored arrays (matching
      // assignStandardDocuments' pattern) and push into both — pushing into
      // documentChecklist alone let this diverge from checklistItems.
      const exists = [...(caseData.documentChecklist || []), ...(caseData.checklistItems || [])].some((item) => item.documentType === document.documentType);
      if (exists) return;
      const next = { ...document, category: "immigration", requestedDate: new Date() };
      caseData.documentChecklist.push(next);
      caseData.checklistItems.push(next);
    });
    caseService.addTimelineEvent(caseData, "addon", "Premium Processing Purchased", "Premium Processing (Form I-907) upgrade was added and is pending payment.", req.user, { addonKey: PREMIUM_PROCESSING_ADDON.key, paymentId: payment._id });
    await caseData.save();

    await questionnaireService.ensureDefaultVisaTemplates(req.user, req).catch(() => []);
    const i907Questionnaire = await Questionnaire.findOne({
      key: I907_QUESTIONNAIRE_KEY,
      status: { $ne: "archived" },
      isActive: { $ne: false },
      latestVersion: true,
    }).sort({ version: -1 });
    const alreadyAssigned = (caseData.questionnaireReferences || []).some((reference) => (
      String(reference.questionnaireId || reference.questionnaireTemplateId) === String(i907Questionnaire?._id)
      && !["rejected"].includes(reference.status)
    ));
    if (i907Questionnaire && !alreadyAssigned) {
      await questionnaireService.assignQuestionnaire(i907Questionnaire, {
        caseId: caseData._id,
        assignedTo: caseData.user || req.user._id,
        message: "Please complete the Form I-907 Premium Processing information in your profile.",
      }, req.user, req);
    }

    const transaction = await paymentService.createPendingTransaction(payment, {
      amount: PREMIUM_PROCESSING_ADDON.totalFeeCents,
      amountUnit: "cents",
      scheduleKey: "pay_in_full",
      label: "Premium Processing Upgrade (I-907)",
    }, req);
    const session = await paymentGateway.createCheckoutSession({ payment, transaction, user: req.user, caseData });
    await paymentService.attachCheckoutSession(payment, transaction, session);

    res.status(201).json({
      success: true,
      addon: caseData.addons[caseData.addons.length - 1],
      payment,
      checkout: {
        url: session.url,
        sessionId: session.sessionId,
        disabled: session.disabled,
        paymentRequestId: transaction.paymentRequestId,
      },
    });
  } catch (error) {
    handleError(error, next);
  }
};

exports.getCases = async (req, res, next) => {
  const timer = createPerfTimer("cases_list_performance", {
    requestId: req.requestId,
    userId: req.user?._id,
    role: req.user?.role,
  });
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const filter = await caseService.resolveCaseSearchFilter(req.query, req.user);
    timer.mark("filter_resolved", { page, limit });
    const sort = caseService.buildCaseSort(req.query);
    const skip = (page - 1) * limit;
    timer.mark("pagination_ready", { skip, sort });

    const [total, cases] = await Promise.all([
      Case.countDocuments(filter),
      Case.collection.aggregate([{ $match: filter }, { $sort: sort }, { $skip: skip }, { $limit: limit }], { allowDiskUse: true }).toArray()
        .then((docs) => caseService.populateCaseListDocs(docs)),
    ]);
    timer.mark("case_query_completed", { total, count: cases.length });

    const totalPages = Math.ceil(total / limit);
    const summaries = cases.map((caseData) => caseService.summarizeCase(caseData));
    const serializedCases = cases.map((caseData) => caseService.serializeCaseForUser(caseData, req.user));
    timer.mark("case_serialization_completed", { count: serializedCases.length });
    res.json({
      success: true,
      count: serializedCases.length,
      total,
      page,
      pages: totalPages,
      cases: serializedCases,
      summaries,
      data: serializedCases,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    });
    timer.done({ success: true });
  } catch (error) {
    timer.done({ success: false, errorName: error.name, errorCode: error.code });
    handleError(error, next);
  }
};

exports.getCase = async (req, res, next) => {
  try {
    const caseData = await caseService.getAccessibleCaseOrThrow(req.params.id, req.user);
    const serialized = caseService.serializeCaseForUser(caseData, req.user);
    res.json({ success: true, case: serialized, caseSummary: caseService.summarizeCase(caseData), data: serialized });
  } catch (error) {
    handleError(error, next);
  }
};

exports.getDashboardStats = async (req, res, next) => {
  try {
    const filter = caseService.buildCaseFilter({ ...req.query, status: req.query.status || "active" }, req.user);
    const [totalCases, newCases, casesByStage, casesByVisaType, pendingAttorneyReview] = await Promise.all([
      Case.countDocuments(filter),
      Case.countDocuments({ ...filter, createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }),
      Case.aggregate([{ $match: filter }, { $group: { _id: "$stage", count: { $sum: 1 } } }]),
      Case.aggregate([{ $match: filter }, { $group: { _id: "$visaType", count: { $sum: 1 } } }]),
      Case.countDocuments({ ...filter, stage: "form_preparation" }),
    ]);

    res.json({ success: true, stats: { totalCases, newCases, casesByStage, casesByVisaType, pendingFormReview: pendingAttorneyReview } });
  } catch (error) {
    handleError(error, next);
  }
};

exports.getNeedsAttention = async (req, res, next) => {
  try {
    const baseFilter = caseService.buildCaseFilter({}, req.user);
    const filter = {
      ...baseFilter,
      status: { $nin: ["completed", "cancelled", "closed", "archived"] },
      $or: [
        { status: "on_hold" },
        { stage: "rfe" },
        { "plan.paymentStatus": { $in: ["not_started", "pending", "failed"] } },
      ],
    };
    const cases = await Case.find(filter)
      .populate("assignedCaseManager", "name displayName")
      .select("caseNumber clientName visaType visaCategory stage status plan rfeDeadline assignedCaseManager updatedAt timeline questionnaireData")
      .sort({ updatedAt: -1 })
      .limit(20);

    const data = cases.map((c) => {
      const reasons = [];
      if (c.stage === "rfe") reasons.push({ label: "RFE", color: "red" });
      if (c.status === "on_hold") reasons.push({ label: "On Hold", color: "orange" });
      if (["not_started", "pending", "failed"].includes(c.plan?.paymentStatus)) reasons.push({ label: "Unpaid", color: "red" });
      const lastEvent = (c.timeline || [])[c.timeline.length - 1];
      return {
        _id: c._id,
        caseNumber: c.caseNumber,
        clientName: c.clientName,
        visaType: c.visaType,
        visaCategory: c.visaCategory,
        caseManagerName: c.assignedCaseManager?.name || c.assignedCaseManager?.displayName || "Unassigned",
        reasons,
        rfeDeadline: c.rfeDeadline,
        lastActivity: lastEvent?.description || lastEvent?.title || null,
        updatedAt: c.updatedAt,
      };
    });
    res.json({ success: true, count: data.length, data });
  } catch (error) {
    handleError(error, next);
  }
};

exports.getRecentActivity = async (req, res, next) => {
  try {
    const filter = caseService.buildCaseFilter({}, req.user);
    const cases = await Case.find(filter)
      .populate("timeline.createdBy", "name displayName")
      .select("caseNumber clientName timeline updatedAt")
      .sort({ updatedAt: -1 })
      .limit(30);

    const activities = cases
      .flatMap((c) =>
        (c.timeline || []).map((entry) => ({
          _id: entry._id,
          caseId: c._id,
          caseNumber: c.caseNumber,
          clientName: c.clientName,
          title: entry.title,
          description: entry.description,
          performedBy: entry.createdBy?.name || entry.createdBy?.displayName || "System",
          performedAt: entry.createdAt,
        }))
      )
      .sort((a, b) => new Date(b.performedAt) - new Date(a.performedAt))
      .slice(0, 20);

    res.json({ success: true, count: activities.length, data: activities });
  } catch (error) {
    handleError(error, next);
  }
};

// F-3 fix for M2: resolveDocumentRequirements() returns every document
// requirement for the visa type in one flat list (both the employer/
// petitioner side and the employee/beneficiary side), each item tagged with
// targetRole from its source questionnaire's checklistRole (see
// document-requirement.resolver.js's fileQuestionToRequirement). createCase
// previously assigned that same unfiltered list as both checklistItems and
// documentChecklist on every case in the family - principal AND every
// child - so an employee-role case's own missing-document view (case.service
// .js's summarizeCase) showed employer-only documents (business license,
// articles of incorporation, ...) as "missing" for itself. Filtering by the
// target case's role at creation keeps each case's checklist scoped to only
// the documents that role is actually responsible for, while still keeping
// role-agnostic items (targetRole "" - shared/reusable docs with no
// audience-specific questionnaire) on every case.
function filterChecklistForRole(checklist, role) {
  if (!role) return checklist;
  return checklist.filter((item) => !item.targetRole || item.targetRole === role);
}

exports.createCase = async (req, res, next) => {
  try {
    const requesterRole = normalizeRole(req.user.role);
    if (!PHASE5_CASE_CREATE_ROLES.has(requesterRole)) {
      return res.status(403).json({
        success: false,
        code: "FORBIDDEN",
        message: "Case creation requires admin or team_lead role",
      });
    }

    const {
      assignedCaseManager,
      caseDetails,
      childCaseCount,
      clientName,
      clientEmail,
      clientPhone,
      creationSource: requestedCreationSource,
      dataEntryMode,
      employerCompletionMode,
      employerEmail,
      employerName,
      extension,
      leadId,
      packageName,
      price,
      visaType,
    } = req.body;

    const trimmedClientName = cleanString(clientName);
    const email = cleanEmail(clientEmail);
    const trimmedVisaType = cleanString(visaType);
    if (!trimmedClientName || !email || !trimmedVisaType) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "clientName, clientEmail, and visaType are required",
      });
    }

    const creationSource = resolveCreationSource(requestedCreationSource, requesterRole);
    if (!["lead_conversion", "admin_direct", "team_lead_direct"].includes(creationSource)) {
      return res.status(400).json({
        success: false,
        code: "INVALID_CREATION_SOURCE",
        message: "creationSource must be lead_conversion, admin_direct, or team_lead_direct",
      });
    }
    if (creationSource === "lead_conversion" && !leadId) {
      return res.status(400).json({
        success: false,
        code: "LEAD_REQUIRED",
        message: "leadId is required when creationSource is lead_conversion",
      });
    }

    const sourceLead = leadId ? await Lead.findById(leadId) : null;
    if (creationSource === "lead_conversion" && !sourceLead) {
      return res.status(404).json({ success: false, code: "LEAD_NOT_FOUND", message: "Lead not found" });
    }
    if (sourceLead?.convertedCaseId) {
      return res.status(409).json({
        success: false,
        code: "LEAD_ALREADY_CONVERTED",
        message: "This lead has already been converted to a case",
      });
    }

    const caseStructure = getCaseStructure(trimmedVisaType);
    if (!caseStructure) {
      return res.status(400).json({
        success: false,
        code: "UNKNOWN_VISA_TYPE",
        message: `Visa type '${trimmedVisaType}' is not recognized. Add it to config/visaCategories.js`,
      });
    }

    const resolvedChildCaseCount = resolveChildCaseCount(caseStructure, childCaseCount);
    const resolvedDataEntryMode = resolveDataEntryMode(caseStructure, dataEntryMode);
    const packageInput = req.body.package || packageName || req.body.primaryPackage || req.body.plan?.tier;
    const normalizedPackage = packageInput ? normalizePackageName(packageInput) : "";
    if (packageInput && !normalizedPackage) {
      return res.status(400).json({ success: false, message: `Package must be one of: ${PACKAGE_NAMES.join(", ")}` });
    }

    const existingUser = await User.findOne({ email }).select("+password +inviteTokenHash");
    if (existingUser && normalizeRole(existingUser.role) !== "client") {
      return res.status(409).json({
        success: false,
        code: "EMAIL_OWNED_BY_NON_CLIENT",
        message: "This email address belongs to a non-client account",
      });
    }
    if (existingUser?.primaryCaseId || (existingUser?.caseIds || []).length) {
      return res.status(409).json({
        success: false,
        code: "CLIENT_ALREADY_HAS_CASE",
        message: "This client account is already linked to a case",
      });
    }

    const principalCaseNumber = await CaseNumberService.nextPrincipalCaseNumber();
    const childCaseNumbers = Array.from({ length: resolvedChildCaseCount }, (_, index) => (
      CaseNumberService.childCaseNumber(principalCaseNumber, index)
    ));

    const created = {
      caseIds: [],
      employerProfileIds: [],
      employeeProfileIds: [],
      userIds: [],
      updatedUsers: [],
    };
    const warnings = [];

    let setupToken = null;
    let clientUser = null;
    let principalCase = null;
    let childCases = [];

    try {
      const selectedAt = normalizedPackage ? new Date() : undefined;
      const checklist = await resolveDocumentRequirements(trimmedVisaType);
      const teamLead = await caseService.resolveTeamLeadForCase(req.body);
      const amount = centsFromPrice(price);
      const trimmedCaseDetails = cleanString(caseDetails);
      const trimmedEmployerName = cleanString(employerName);
      const trimmedEmployerEmail = cleanEmail(employerEmail);
      const assignmentMode = employerCompletionMode === "invite_employees"
        ? "invite_employees"
        : employerCompletionMode === "employer_completes"
          ? "employer_completes"
          : "";
      if (caseStructure === "employer_employee" && trimmedEmployerEmail && trimmedEmployerEmail === email) {
        warnings.push({
          code: "EMPLOYER_EMPLOYEE_EMAIL_MATCH",
          message: "Employer contact email matches the client/employee email. Keep the employer principal account and employee invite/self-service account separate for H-1B matters.",
        });
      }
      const status = assignedCaseManager ? "assigned" : "pending_assignment";
      const commonCaseData = {
        isDemoData: false,
        createdBy: req.user._id,
        lastModifiedBy: req.user._id,
        clientName: trimmedClientName,
        clientEmail: email,
        visaType: trimmedVisaType,
        visaCategory: trimmedVisaType,
        caseType: "immigration",
        petitionType: trimmedVisaType,
        petitionSubType: extension ? cleanString(extension) : undefined,
        package: normalizedPackage,
        primaryPackage: normalizedPackage || undefined,
        plan: {
          tier: normalizedPackage,
          selectedAt,
          paymentStatus: "not_started",
          amount,
          currency: "USD",
        },
        creationSource,
        leadId: creationSource === "lead_conversion" ? leadId : null,
        consultationId: sourceLead?.consultation?.appointmentId || sourceLead?.consultationId || undefined,
        status,
        assignedTeamLead: req.body.assignedTeamLead || teamLead?._id,
        teamId: req.body.teamId || teamLead?.teamId,
        assignedAgent: assignedCaseManager ? (req.user.displayName || req.user.name || "Immigration CRM") : "Team Lead Queue",
        agentEmail: assignedCaseManager ? req.user.email : undefined,
        assignedAgentUser: assignedCaseManager ? req.user._id : undefined,
        primaryOwner: assignedCaseManager || undefined,
        assignedCaseManager: assignedCaseManager || undefined,
        internalNotes: trimmedCaseDetails ? [{
          author: req.user._id,
          note: trimmedCaseDetails,
          category: "general",
          visibility: "team",
        }] : [],
        legacySource: "INSZoom",
      };

      const principalTargetRole = caseStructure === "family" ? "petitioner" : caseStructure === "employer_employee" ? "employer" : null;
      const principalChecklist = filterChecklistForRole(checklist, principalTargetRole);
      [principalCase] = await Case.create([{
        ...commonCaseData,
        caseId: principalCaseNumber,
        caseNumber: principalCaseNumber,
        clientPortalId: principalCaseNumber,
        checklistItems: principalChecklist,
        documentChecklist: principalChecklist,
        caseStructure,
        caseRole: caseStructure === "single" ? "single" : "principal",
        childCaseCount: resolvedChildCaseCount,
        childIndex: null,
        dataEntryMode: resolvedDataEntryMode,
        petitionerName: trimmedEmployerName || undefined,
        questionnaireData: {
          masterData: {
            ...(assignmentMode ? {
              employeeQuestionnaireAssignment: {
                mode: assignmentMode,
                selectedAt: new Date(),
                selectedBy: req.user._id,
              },
            } : {}),
            ...((trimmedEmployerName || trimmedEmployerEmail) ? {
              employer: {
                company: {
                  fullName: trimmedEmployerName,
                  email: trimmedEmployerEmail,
                },
              },
            } : {}),
          },
        },
      }]);
      created.caseIds.push(principalCase._id);

      if (existingUser) {
        created.updatedUsers.push({
          _id: existingUser._id,
          set: {
            primaryCaseId: existingUser.primaryCaseId || null,
            caseIds: existingUser.caseIds || [],
            leadId: existingUser.leadId || null,
            mustSetPassword: existingUser.mustSetPassword || false,
            caseRole: existingUser.caseRole || null,
            principalCaseId: existingUser.principalCaseId || null,
            isActive: existingUser.isActive,
            isEmailVerified: existingUser.isEmailVerified,
            inviteTokenExpiresAt: existingUser.inviteTokenExpiresAt || null,
            ...(existingUser.inviteTokenHash ? { inviteTokenHash: existingUser.inviteTokenHash } : {}),
          },
          unset: existingUser.inviteTokenHash ? {} : { inviteTokenHash: "" },
        });
        clientUser = existingUser;
        clientUser.name = clientUser.name || trimmedClientName;
        clientUser.displayName = clientUser.displayName || trimmedClientName;
        if (clientPhone && !clientUser.phone) clientUser.phone = cleanString(clientPhone);
      } else {
        setupToken = generateOpaqueToken();
        const referralCode = await generateUniqueReferralCode(User);
        [clientUser] = await User.create([{
          email,
          name: trimmedClientName,
          displayName: trimmedClientName,
          phone: clientPhone ? cleanString(clientPhone) : undefined,
          role: "client",
          referralCode,
          isActive: false,
          isEmailVerified: false,
          mustSetPassword: true,
          inviteTokenHash: hashToken(setupToken),
          inviteTokenExpiresAt: new Date(Date.now() + CLIENT_SETUP_TOKEN_EXPIRY_MS),
          primaryCaseId: principalCase._id,
          caseIds: [principalCase._id],
          caseRole: caseStructure === "single" ? "single" : "principal",
          principalCaseId: null,
          leadId: sourceLead?._id || undefined,
        }]);
        created.userIds.push(clientUser._id);
      }

      if (existingUser) {
        if (!clientUser.password && !clientUser.inviteTokenHash) {
          setupToken = generateOpaqueToken();
          clientUser.inviteTokenHash = hashToken(setupToken);
          clientUser.inviteTokenExpiresAt = new Date(Date.now() + CLIENT_SETUP_TOKEN_EXPIRY_MS);
          clientUser.mustSetPassword = true;
          clientUser.isActive = false;
          clientUser.isEmailVerified = false;
        }
        clientUser.primaryCaseId = principalCase._id;
        clientUser.caseIds = [principalCase._id];
        clientUser.caseRole = caseStructure === "single" ? "single" : "principal";
        clientUser.principalCaseId = null;
        if (sourceLead?._id) clientUser.leadId = sourceLead._id;
        await clientUser.save();
      }

      principalCase.user = clientUser._id;
      if (caseStructure === "employer_employee") {
        principalCase.employerUser = clientUser._id;
        principalCase.employeeInvite = assignmentMode === "invite_employees" ? {
          status: "not_sent",
          invitedBy: req.user._id,
        } : undefined;
        principalCase.employerEmployeeWorkflow = assignmentMode ? {
          employerStatus: "not_started",
          employeeStatus: assignmentMode === "invite_employees" ? "not_invited" : "in_progress",
          caseManagerStatus: assignmentMode === "invite_employees" ? "waiting_for_employee" : "waiting_for_employer",
        } : undefined;
      }
      if (caseStructure === "family") {
        principalCase.petitionerUser = clientUser._id;
        principalCase.familyWorkflow = {
          petitionerStatus: "not_started",
          beneficiaryStatus: "not_invited",
          caseManagerStatus: "new_case",
        };
      }

      let employerProfile = null;
      if (caseStructure !== "single") {
        // Only stamp a field with the staff-authoritative "case_manager_edit"
        // source when a real value was actually supplied here. Stamping an
        // empty placeholder as staff-authoritative would permanently block
        // the employer's own questionnaire submission from ever setting it
        // (canonicalFieldWriter treats case_manager_edit as staff-locked).
        const canonicalData = {};
        if (trimmedEmployerName) {
          canonicalData.legalName = { value: trimmedEmployerName, source: "case_manager_edit", updatedAt: new Date(), updatedBy: req.user._id };
        }
        if (trimmedEmployerEmail) {
          canonicalData.contact = { email: { value: trimmedEmployerEmail, source: "case_manager_edit", updatedAt: new Date(), updatedBy: req.user._id } };
        }
        [employerProfile] = await EmployerProfile.create([{
          principalCaseId: principalCase._id,
          canonicalData,
          updatedAt: new Date(),
          updatedBy: req.user._id,
        }]);
        created.employerProfileIds.push(employerProfile._id);
        principalCase.employerProfileId = employerProfile._id;
      }

      for (let index = 0; index < resolvedChildCaseCount; index += 1) {
        const childIndex = CaseNumberService.indexToSuffix(index);
        const childRole = caseStructure === "family" ? "beneficiary" : "employee";
        const childChecklist = filterChecklistForRole(checklist, childRole);
        const [childCase] = await Case.create([{
          ...commonCaseData,
          caseId: childCaseNumbers[index],
          caseNumber: childCaseNumbers[index],
          clientPortalId: childCaseNumbers[index],
          checklistItems: childChecklist,
          documentChecklist: childChecklist,
          // F-3 fix: commonCaseData.clientEmail/clientName carry the EMPLOYER's
          // own contact info (set above from the request body). Inheriting
          // them onto the child case made InvitePanel.jsx's `invited =
          // Boolean(child.clientEmail)` check true from the moment of
          // creation, before any real employee was ever invited — the
          // employer could never see the actual "Send Invite" name/email
          // form, only a permanent, incorrect "Invited" badge showing their
          // own email. Left blank until inviteEmployee (case.controller.js)
          // explicitly sets both on acceptance of a real invite.
          clientEmail: "",
          clientName: "",
          user: clientUser._id,
          parentCase: principalCase._id,
          caseStructure,
          caseRole: childRole,
          childIndex,
          childCaseCount: 0,
          employerProfileId: employerProfile?._id || null,
          dataEntryMode: resolvedDataEntryMode,
          assignmentOverridden: false,
        }]);
        created.caseIds.push(childCase._id);

        const [personProfile] = await EmployeeProfile.create([{
          caseId: childCase._id,
          principalCaseId: principalCase._id,
          profileType: childRole,
          updatedAt: new Date(),
          updatedBy: req.user._id,
        }]);
        created.employeeProfileIds.push(personProfile._id);
        childCase.personProfileId = personProfile._id;
        await childCase.save();
        childCases.push(childCase);
      }

      principalCase.childCases = childCases.map((childCase) => childCase._id);
      clientUser.caseIds = [principalCase._id, ...childCases.map((childCase) => childCase._id)];
      await clientUser.save();
      await principalCase.save();
    } catch (createError) {
      await cleanupPhase5Create(created);
      throw createError;
    }

    if (creationSource === "lead_conversion" && sourceLead) {
      sourceLead.status = "converted";
      sourceLead.convertedCaseId = principalCase._id;
      await sourceLead.save();
    }

    await caseService.hydrateCaseRelationships(principalCase, req.user, req);
    caseService.setStage(principalCase, "intake", req.user, "Case created by staff");
    await workflowService.caseCreated(principalCase, req.user);
    caseService.addAuditEntry(principalCase, "create", "Case family created by staff via INSZoom portal", req.user, {
      caseNumber: principalCase.caseNumber,
      caseStructure,
      childCaseCount: resolvedChildCaseCount,
      creationSource,
    }, req);
    await principalCase.save();
    await caseService.writeAuditLog("create", principalCase, req.user, req.body, req);

    // P12-S1 fix: initializeCase() -> orchestrate() resolves form templates,
    // rebuilds the canonical profile, and runs IntelligentQuestionnaireService
    // (an AI-backed questionnaire generation call) — real, unavoidable work,
    // but none of it is needed to tell the caller "the case now exists".
    // Awaiting it here before responding was the actual ~2-minute delay
    // (profiled directly - not email/notification sending, which was
    // already wrapped in its own .catch(() => null) and is comparatively
    // fast). The response now returns immediately from data already fully
    // saved (principalCase/childCases/clientUser); orchestration and the
    // client-invite notification/email both continue in the background.
    // The case-detail page (fetched on navigation a moment later) reflects
    // the fully-orchestrated state by the time a person actually looks at
    // it — nothing in the synchronous response path depended on it.
    setImmediate(async () => {
      try {
        await lifecycleOrchestrator.initializeCase(principalCase, req.user, req);
      } catch (err) {
        require("../../utils/logger").error("create_case_background_orchestration_failed", { caseId: principalCase._id, error: err.message });
      }
      if (setupToken) {
        await notificationService.createNotification({
          userId: clientUser._id,
          type: "case_created",
          category: "case",
          title: "Your Immigration Case Is Ready",
          message: `${principalCase.caseNumber} - ${principalCase.visaType}`,
          caseId: principalCase._id,
          link: "/accept-invite",
          priority: "medium",
          source: "shared",
          emailTemplate: "client-portal-invitation",
          emailTo: email,
          emailData: {
            clientName: trimmedClientName,
            caseNumber: principalCase.caseNumber,
            token: setupToken,
          },
        }, req.user, req).catch(() => null);
      }
    });

    res.status(201).json({
      success: true,
      message: "Case created",
      principalCase: publicCaseSummary(principalCase),
      childCases: childCases.map(publicCaseSummary),
      clientUser: {
        _id: clientUser._id,
        email: clientUser.email,
        mustSetPassword: clientUser.mustSetPassword,
      },
      case: principalCase,
      caseSummary: caseService.summarizeCase(principalCase),
      warnings,
    });
  } catch (error) {
    handleError(error, next);
  }
};

exports.updateCase = async (req, res, next) => {
  try {
    const caseData = await getCaseOr404(req.params.id, res);
    if (!caseData) return;
    if (!caseService.canAccessCase(req.user, caseData)) return res.status(403).json({ success: false, message: "Not authorized to update this case" });

    if (Object.prototype.hasOwnProperty.call(req.body, "package") && req.body.package) {
      const normalized = normalizePackageName(req.body.package);
      if (!normalized) {
        return res.status(400).json({ success: false, message: `Package must be one of: ${PACKAGE_NAMES.join(", ")}` });
      }
      req.body.package = normalized;
    }

    const oldStatus = caseData.status;
    const oldStage = caseData.stage;
    const allowedFields = [
      "status",
      "notes",
      "uscisNumber",
      "uscisReceiptNumber",
      "uscisDecision",
      "uscisDecisionDate",
      "priority",
      "visaCategory",
      "visaType",
      "package",
      "filingDate",
      "rfeDeadline",
      "rfeResponseDate",
      "visaExpirationDate",
      "filingDeadline",
      "interviewDate",
      "biometricAppointmentDate",
      "filingReadinessScore",
      "companyId",
      "teamId",
      "beneficiary",
      "clientProfile",
      "parentCase",
      "caseType",
      "petitionType",
      "petitionSubType",
      "clientName",
      "clientEmail",
    ];
    const changes = {};

    allowedFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        changes[field] = { from: caseData[field], to: req.body[field] };
        caseData[field] = req.body[field];
      }
    });
    ["petitioner", "petitionerModel", "employer", "organization"].forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        changes[field] = { from: caseData[field], to: req.body[field] };
        caseData[field] = req.body[field];
      }
    });
    if (req.body.petitionerId) {
      changes.petitioner = { from: caseData.petitioner, to: req.body.petitionerId };
      caseData.petitioner = req.body.petitionerId;
      caseData.petitionerModel = req.body.petitionerModel || caseData.petitionerModel || "User";
    }
    if (req.body.employerId) {
      changes.employer = { from: caseData.employer, to: req.body.employerId };
      caseData.employer = req.body.employerId;
    }
    if (req.body.organizationId) {
      changes.organization = { from: caseData.organization, to: req.body.organizationId };
      caseData.organization = req.body.organizationId;
    }
    caseData.lastModifiedBy = req.user._id;

    if (req.body.workflow) {
      Object.assign(caseData.workflow, req.body.workflow);
      changes.workflow = req.body.workflow;
    }
    if (req.body.receiptTracking) {
      Object.assign(caseData.receiptTracking, req.body.receiptTracking);
      changes.receiptTracking = req.body.receiptTracking;
    }
    if (req.body.currentStage !== undefined && req.body.currentStage !== caseData.currentStage) {
      caseService.setStage(caseData, req.body.currentStage, req.user, req.body.stageNote);
    }
    if (req.body.stage && req.body.stage !== oldStage) {
      caseService.setStage(caseData, req.body.stage, req.user, req.body.stageNote);
    }

    await caseService.hydrateCaseRelationships(caseData, req.user, req);
    await workflowService.statusChanged(caseData, oldStatus, caseData.status, req.user);
    caseService.addTimelineEvent(caseData, "case", "Case Updated", "Case fields updated", req.user, changes);
    caseService.addAuditEntry(caseData, "update", "Case updated", req.user, changes, req);
    await caseData.save();
    await caseService.writeAuditLog("update", caseData, req.user, changes, req);
    const orchestrationFields = new Set(["visaType", "visaCategory", "caseType", "petitionType", "petitionSubType", "employer", "organization", "companyId"]);
    if (Object.keys(changes).some((field) => orchestrationFields.has(field))) {
      await require("./immigration-knowledge-engine.service").orchestrate(caseData._id, req.user, req, {
        reason: "case_classification_changed",
      });
    }
    const lifecycle = await lifecycleOrchestrator.recalculate(caseData._id, req.user, req, "case_updated");

    res.json({ success: true, message: "Case updated", case: lifecycle.case, caseSummary: caseService.summarizeCase(lifecycle.case), workflow: lifecycle });
  } catch (error) {
    handleError(error, next);
  }
};

exports.updateCaseStage = async (req, res, next) => {
  try {
    const { stage, currentStage, note } = req.body;
    const caseData = await getCaseOr404(req.params.id, res);
    if (!caseData) return;
    if (!caseService.canAccessCase(req.user, caseData)) return res.status(403).json({ success: false, message: "Not authorized to update this case" });

    const targetStage = typeof (stage ?? currentStage) === "string" ? (stage ?? currentStage) : caseData.stage;
    const metrics = await lifecycleOrchestrator.metrics(caseData);
    const gateResult = evaluateStageGate(targetStage, metrics);
    if (gateResult.blocked) {
      return res.status(409).json({ success: false, code: "CHECKLIST_INCOMPLETE", message: gateResult.reason });
    }

    caseService.setStage(caseData, stage ?? currentStage, req.user, note);
    caseService.addAuditEntry(caseData, "update_stage", "Case stage updated", req.user, { stage, currentStage }, req);
    await caseData.save();
    await caseService.writeAuditLog("update_stage", caseData, req.user, { stage, currentStage }, req);
    const lifecycle = await lifecycleOrchestrator.recalculate(caseData._id, req.user, req, "case_stage_updated");

    res.json({
      success: true,
      case: lifecycle.case,
      caseSummary: caseService.summarizeCase(lifecycle.case),
      workflow: lifecycle,
      warning: gateResult.warning || undefined,
    });
  } catch (error) {
    handleError(error, next);
  }
};

exports.addInternalNote = async (req, res, next) => {
  try {
    const caseData = await getCaseOr404(req.params.id, res);
    if (!caseData) return;
    if (!caseService.canAccessCase(req.user, caseData)) return res.status(403).json({ success: false, message: "Not authorized to access this case" });

    caseData.internalNotes.push({ author: req.user._id, note: req.body.note, isInternal: req.body.isInternal !== false });
    caseService.addTimelineEvent(caseData, "note", "Internal Note Added", req.body.note, req.user);
    caseService.addAuditEntry(caseData, "add_note", "Internal note added", req.user, { note: req.body.note }, req);
    await caseData.save();
    await caseService.writeAuditLog("add_note", caseData, req.user, { note: req.body.note }, req);

    res.json({ success: true, case: caseData });
  } catch (error) {
    handleError(error, next);
  }
};

exports.addExternalNote = async (req, res, next) => {
  try {
    const caseData = await getCaseOr404(req.params.id, res);
    if (!caseData) return;
    if (!caseService.canAccessCase(req.user, caseData)) return res.status(403).json({ success: false, message: "Not authorized to access this case" });

    caseData.externalNotes.push({ author: req.user._id, note: req.body.note, isInternal: false });
    caseService.addTimelineEvent(caseData, "external_note", "External Note Added", req.body.note, req.user);
    caseService.addAuditEntry(caseData, "add_external_note", "External note added", req.user, { note: req.body.note }, req);
    await caseData.save();
    await caseService.writeAuditLog("add_external_note", caseData, req.user, { note: req.body.note }, req);

    res.json({ success: true, case: caseData });
  } catch (error) {
    handleError(error, next);
  }
};

exports.assignCaseManager = async (req, res, next) => {
  try {
    const caseData = await getCaseOr404(req.params.id, res);
    if (!caseData) return;
    if (!canAssignCase(req.user, caseData)) return res.status(403).json({ success: false, message: "Not authorized to assign this case" });
    const assignee = req.body.caseManagerId || req.body.primaryOwner || req.user._id;
    const previousCaseManagerId = caseData.assignedCaseManager;

    if (sameId(previousCaseManagerId, assignee)) {
      return res.status(400).json({ success: false, message: "Case is already assigned to this case manager" });
    }
    const assigneeUser = await User.findById(assignee).select("_id role isActive");
    if (!assigneeUser || assigneeUser.isActive === false) {
      return res.status(400).json({ success: false, message: "Target user was not found or is inactive" });
    }
    if (!REASSIGNABLE_ROLES.has(normalizeRole(assigneeUser.role))) {
      return res.status(400).json({ success: false, message: "Target user does not hold a case manager role" });
    }

    caseService.assignUser(caseData, "case_manager", assignee, req.user, req.body.notes);
    if (req.user.role === "team_lead" && !caseData.assignedTeamLead) caseService.assignUser(caseData, "team_lead", req.user._id, req.user, "Assigned by team lead");

    // Phase 7 — a child case (caseRole employee/beneficiary) being assigned
    // directly, rather than via cascade from its principal, is by definition
    // an individual override: mark it so a later principal-level assignment
    // skips this child instead of stomping the override.
    if (["employee", "beneficiary"].includes(caseData.caseRole)) {
      caseData.assignmentOverridden = true;
    }

    // Team Lead can set priority and add an internal note as part of the
    // same assignment action, atomically with the assignment itself.
    if (req.body.priority && caseData.priority !== req.body.priority) {
      const previousPriority = caseData.priority;
      caseData.priority = req.body.priority;
      caseService.addTimelineEvent(caseData, "priority", "Priority Updated", `Priority changed from ${previousPriority} to ${req.body.priority} during assignment`, req.user, { previousPriority, priority: req.body.priority });
      caseService.addAuditEntry(caseData, "update_priority", "Priority updated during assignment", req.user, { previousPriority, priority: req.body.priority }, req);
    }
    if (req.body.internalNote) {
      caseData.internalNotes.push({ author: req.user._id, note: req.body.internalNote, isInternal: true });
      caseService.addTimelineEvent(caseData, "note", "Internal Note Added", req.body.internalNote, req.user);
    }

    await caseData.save();
    await syncCaseMessagingAssignment(caseData);
    await recordReassignment(caseData, "case_manager", previousCaseManagerId, assignee, req.user, req);
    await caseService.writeAuditLog("assign_case_manager", caseData, req.user, { caseManagerId: assignee, priority: req.body.priority, internalNote: req.body.internalNote }, req);
    await notifyAssignee(assignee, caseData, "case_manager", req.user, req);
    await notifyClientOfCaseManagerAssignment(caseData, assignee, previousCaseManagerId, req.user, req);

    // Phase 7 — cascade to non-overridden children after the principal's own
    // assignment has committed; a cascade failure must not roll back or fail
    // the request that already succeeded for the principal case itself.
    let childrenCascaded = 0;
    if (caseData.caseRole === "principal") {
      childrenCascaded = await cascadeAssignmentToChildren(caseData, {
        assignedCaseManager: assignee,
        primaryOwner: assignee,
      }).catch((cascadeErr) => {
        console.error("[assignCaseManager] Cascade to children failed (non-fatal):", cascadeErr.message);
        return 0;
      });
    }

    const lifecycle = await lifecycleOrchestrator.onAssignment(caseData, req.user, req);
    res.json({ success: true, case: lifecycle.case, workflow: lifecycle.progress, childrenCascaded });
  } catch (error) {
    handleError(error, next);
  }
};

exports.assignTeamLead = async (req, res, next) => {
  try {
    const caseData = await getCaseOr404(req.params.id, res);
    if (!caseData) return;
    if (!canAssignCase(req.user, caseData)) return res.status(403).json({ success: false, message: "Not authorized to assign this case" });
    const teamLeadId = req.body.teamLeadId || req.body.assignedTeamLead || req.user._id;
    const previousTeamLeadId = caseData.assignedTeamLead;
    caseService.assignUser(caseData, "team_lead", teamLeadId, req.user, req.body.notes);

    // Phase 7 — see the matching comment in assignCaseManager above.
    if (["employee", "beneficiary"].includes(caseData.caseRole)) {
      caseData.assignmentOverridden = true;
    }

    await caseData.save();
    await syncCaseMessagingAssignment(caseData);
    await recordReassignment(caseData, "team_lead", previousTeamLeadId, teamLeadId, req.user, req);
    await caseService.writeAuditLog("assign_team_lead", caseData, req.user, { teamLeadId }, req);
    await notifyAssignee(teamLeadId, caseData, "team_lead", req.user, req);

    let childrenCascaded = 0;
    if (caseData.caseRole === "principal") {
      childrenCascaded = await cascadeAssignmentToChildren(caseData, {
        assignedTeamLead: teamLeadId,
      }).catch((cascadeErr) => {
        console.error("[assignTeamLead] Cascade to children failed (non-fatal):", cascadeErr.message);
        return 0;
      });
    }

    res.json({ success: true, case: caseData, childrenCascaded });
  } catch (error) {
    handleError(error, next);
  }
};

exports.transferOwnership = async (req, res, next) => {
  try {
    const caseData = await getCaseOr404(req.params.id, res);
    if (!caseData) return;
    if (!canAssignCase(req.user, caseData)) return res.status(403).json({ success: false, message: "Not authorized to transfer this case" });
    const previousOwners = {
      primary_owner: caseData.primaryOwner,
      secondary_owner: caseData.secondaryOwner,
      case_manager: caseData.assignedCaseManager,
      team_lead: caseData.assignedTeamLead,
    };
    if (req.body.primaryOwner) caseService.assignUser(caseData, "primary_owner", req.body.primaryOwner, req.user, req.body.notes);
    if (req.body.secondaryOwner) caseService.assignUser(caseData, "secondary_owner", req.body.secondaryOwner, req.user, req.body.notes);
    if (req.body.caseManagerId) caseService.assignUser(caseData, "case_manager", req.body.caseManagerId, req.user, req.body.notes);
    if (req.body.teamLeadId) caseService.assignUser(caseData, "team_lead", req.body.teamLeadId, req.user, req.body.notes);
    caseService.addTimelineEvent(caseData, "ownership", "Ownership Changed", "Case ownership updated", req.user, req.body);
    caseData.lastModifiedBy = req.user._id;
    await caseData.save();
    await syncCaseMessagingAssignment(caseData);
    await Promise.all([
      req.body.primaryOwner ? recordReassignment(caseData, "primary_owner", previousOwners.primary_owner, req.body.primaryOwner, req.user, req) : null,
      req.body.secondaryOwner ? recordReassignment(caseData, "secondary_owner", previousOwners.secondary_owner, req.body.secondaryOwner, req.user, req) : null,
      req.body.caseManagerId ? recordReassignment(caseData, "case_manager", previousOwners.case_manager, req.body.caseManagerId, req.user, req) : null,
      req.body.teamLeadId ? recordReassignment(caseData, "team_lead", previousOwners.team_lead, req.body.teamLeadId, req.user, req) : null,
    ].filter(Boolean));
    await caseService.writeAuditLog("ownership_changed", caseData, req.user, req.body, req);
    await Promise.all([req.body.primaryOwner, req.body.secondaryOwner, req.body.caseManagerId, req.body.teamLeadId].filter(Boolean).map((userId) => notifyAssignee(userId, caseData, "owner", req.user, req)));
    const lifecycle = await lifecycleOrchestrator.onAssignment(caseData, req.user, req);
    res.json({ success: true, case: lifecycle.case, workflow: lifecycle.progress });
  } catch (error) {
    handleError(error, next);
  }
};

// Compliance/audit view over CaseAssignmentEvent — reuses the same
// canAccessCase gate as the rest of case-detail (so a case manager viewing
// their own case's history is fine, but only admins/team leads/owners can
// ever see it, matching the "who can assign" surface described in the spec).
exports.getAssignmentHistory = async (req, res, next) => {
  try {
    const caseData = await getAuthorizedCase(req, res);
    if (!caseData) return;
    const events = await CaseAssignmentEvent.find({ caseId: caseData._id })
      .sort({ createdAt: -1 })
      .populate("fromManagerId", "name displayName email role")
      .populate("toManagerId", "name displayName email role")
      .populate("reassignedById", "name displayName email role")
      .lean();
    res.json({ success: true, events });
  } catch (error) {
    handleError(error, next);
  }
};

// ── Phase 9 — data entry mode, employee invite, remove employee ──────────
// These three endpoints operate on the caseRole=principal/employee/
// beneficiary child-Case architecture Phase 5 creates at case-creation
// time. See PHASE_9_COMPLETION_REPORT.md for how this coexists with the
// older employerUser/employeeUser/employment-workflow architecture that
// Documents.jsx historically used.

const PHASE9_STAFF_ROLES = new Set(["super_admin", "admin", "team_lead"]);

/**
 * PATCH /api/cases/:principalId/data-entry-mode
 * INVARIANT 3: the client may set this exactly once (not_set -> fill_self|
 * invite). Only staff may reset it back to not_set afterward.
 */
exports.setDataEntryMode = async (req, res, next) => {
  try {
    const { principalId } = req.params;
    const { mode, reset } = req.body || {};

    const caseDoc = await Case.findById(principalId);
    if (!caseDoc) return res.status(404).json({ success: false, message: "Case not found" });

    const isStaff = PHASE9_STAFF_ROLES.has(req.user.role);

    // Single-person visas never need a data entry mode selection.
    if (caseDoc.dataEntryMode === "not_required") {
      return res.status(403).json({
        success: false,
        code: "NOT_APPLICABLE",
        message: "Single-person visas do not require a data entry mode selection",
      });
    }

    if (reset) {
      if (!isStaff) return res.status(403).json({ success: false, message: "Only staff may reset the data entry mode" });
      caseDoc.dataEntryMode = "not_set";
      await caseDoc.save();
      return res.status(200).json({ success: true, message: "Data entry mode reset to not_set", dataEntryMode: "not_set" });
    }

    if (!isStaff && String(caseDoc.user) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "Not authorized to set data entry mode for this case" });
    }

    if (caseDoc.dataEntryMode !== "not_set") {
      return res.status(409).json({
        success: false,
        code: "DATA_ENTRY_MODE_ALREADY_SET",
        message: `Data entry mode is already set to '${caseDoc.dataEntryMode}'. Contact your case manager to change this.`,
        currentMode: caseDoc.dataEntryMode,
      });
    }

    if (!["fill_self", "invite"].includes(mode)) {
      return res.status(400).json({ success: false, code: "INVALID_MODE", message: "mode must be 'fill_self' or 'invite'" });
    }

    caseDoc.dataEntryMode = mode;
    await caseDoc.save();
    await caseService.writeAuditLog("set_data_entry_mode", caseDoc, req.user, { mode }, req);

    return res.status(200).json({ success: true, message: `Data entry mode set to '${mode}'`, dataEntryMode: mode });
  } catch (err) {
    handleError(err, next);
  }
};

/**
 * POST /api/cases/:principalId/invite-employee
 *
 * INVARIANT 4: the child Case already exists (created in Phase 5) — this
 * endpoint creates a stub User for it and sends the setup email, exactly
 * like the Phase 5/8 principal-account flow, but never creates a Case.
 * Reuses the same token mechanism (generateOpaqueToken/hashToken,
 * mustSetPassword/inviteTokenHash/inviteTokenExpiresAt) and the same
 * shared /accept-invite acceptance endpoint from Phase 8 — nothing new is
 * built for token issuance or acceptance.
 */
exports.inviteEmployee = async (req, res, next) => {
  try {
    const { principalId } = req.params;
    const { childCaseId, employeeEmail, employeeName } = req.body || {};

    if (!childCaseId || !employeeEmail || !employeeName) {
      return res.status(400).json({ success: false, message: "childCaseId, employeeEmail, and employeeName are required" });
    }

    const principal = await Case.findById(principalId);
    if (!principal) return res.status(404).json({ success: false, message: "Principal case not found" });

    const isStaff = PHASE9_STAFF_ROLES.has(req.user.role);
    if (!isStaff && String(principal.user) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "Not authorized to invite employees for this case" });
    }

    // Never parse caseNumber — resolve the child strictly via parentCase.
    const childCase = await Case.findOne({ _id: childCaseId, parentCase: principal._id });
    if (!childCase) {
      return res.status(404).json({ success: false, message: "Child case not found or does not belong to this principal case" });
    }
    if (!["employee", "beneficiary"].includes(childCase.caseRole)) {
      return res.status(400).json({ success: false, message: "This case is not a child (employee/beneficiary) case" });
    }

    if (principal.dataEntryMode !== "invite") {
      return res.status(409).json({
        success: false,
        code: "WRONG_DATA_ENTRY_MODE",
        message: `Cannot send invite — data entry mode is '${principal.dataEntryMode}'. Must be 'invite'.`,
      });
    }

    // Already invited: the child case's `user` no longer matches the
    // employer's own account, meaning ownership was already transferred.
    if (childCase.user && String(childCase.user) !== String(principal.user)) {
      return res.status(409).json({ success: false, code: "ALREADY_INVITED", message: "This employee has already been invited." });
    }

    const normalizedEmail = String(employeeEmail).trim().toLowerCase();
    const trimmedName = String(employeeName).trim();
    if (normalizedEmail === cleanEmail(principal.clientEmail)) {
      return res.status(409).json({
        success: false,
        code: "EMPLOYEE_EMAIL_MATCHES_EMPLOYER",
        message: "Use a separate employee email. The employer principal account and employee self-service account must remain separate.",
      });
    }
    const setupToken = generateOpaqueToken();

    const [employeeUser] = await User.create([{
      email: normalizedEmail,
      name: trimmedName,
      displayName: trimmedName,
      role: childCase.caseRole, // 'employee' | 'beneficiary'
      isActive: false,
      isEmailVerified: false,
      mustSetPassword: true,
      inviteTokenHash: hashToken(setupToken),
      inviteTokenExpiresAt: new Date(Date.now() + CLIENT_SETUP_TOKEN_EXPIRY_MS),
      primaryCaseId: childCase._id,
      caseIds: [childCase._id],
      caseRole: childCase.caseRole,
      principalCaseId: principal._id,
    }]);

    // Transfer the child case off the employer's account onto the new
    // employee account. From this point the employer has no access path
    // to this child's EmployeeProfile — canAccess() in
    // employee-profile.service.js checks the requester's own caseIds,
    // which no longer includes this case.
    const previousOwnerId = childCase.user;
    childCase.user = employeeUser._id;
    childCase.clientName = trimmedName;
    childCase.clientEmail = normalizedEmail;
    await childCase.save();
    if (previousOwnerId) {
      await User.updateOne({ _id: previousOwnerId }, { $pull: { caseIds: childCase._id } });
    }

    const now = new Date();
    await EmployeeProfile.updateOne(
      { caseId: childCase._id },
      {
        $set: {
          "canonicalData.firstName.value": trimmedName.split(" ")[0] || trimmedName,
          "canonicalData.firstName.source": "import",
          "canonicalData.firstName.updatedAt": now,
          "canonicalData.firstName.updatedBy": req.user._id,
          "canonicalData.email.value": normalizedEmail,
          "canonicalData.email.source": "import",
          "canonicalData.email.updatedAt": now,
          "canonicalData.email.updatedBy": req.user._id,
          updatedAt: now,
        },
      }
    );

    await caseService.writeAuditLog("invite_employee", childCase, req.user, { employeeEmail: normalizedEmail }, req);

    await notificationService.createNotification({
      userId: employeeUser._id,
      type: "case_created",
      category: "case",
      title: "You've Been Invited to Complete Your Immigration Case",
      message: `${childCase.caseNumber} - ${childCase.visaType}`,
      caseId: childCase._id,
      link: "/accept-invite",
      priority: "medium",
      source: "shared",
      emailTemplate: "employee-case-invitation",
      emailTo: normalizedEmail,
      emailData: {
        employeeName: trimmedName,
        employerName: principal.clientName,
        caseNumber: childCase.caseNumber,
        token: setupToken,
      },
    }, req.user, req).catch(() => null);

    return res.status(200).json({
      success: true,
      message: `Invitation sent to ${normalizedEmail}`,
      childCaseId: childCase._id,
      childCaseNumber: childCase.caseNumber,
      inviteStatus: "pending",
    });
  } catch (err) {
    handleError(err, next);
  }
};

/**
 * PATCH /api/cases/:caseId/remove-employee
 * INVARIANT 5: soft-delete only. status -> 'removed'; EmployeeProfile,
 * documents, and the invited User account (if any) are left untouched.
 */
exports.removeEmployee = async (req, res, next) => {
  try {
    const { caseId } = req.params;
    const childCase = await Case.findById(caseId);
    if (!childCase) return res.status(404).json({ success: false, message: "Case not found" });

    if (!["employee", "beneficiary"].includes(childCase.caseRole)) {
      return res.status(400).json({
        success: false,
        code: "CANNOT_REMOVE_PRINCIPAL",
        message: "Only child cases (employee or beneficiary) can be removed",
      });
    }
    if (childCase.status === "removed") {
      return res.status(409).json({ success: false, code: "ALREADY_REMOVED", message: "This case has already been removed" });
    }

    const isStaff = PHASE9_STAFF_ROLES.has(req.user.role);
    if (!isStaff) {
      const principal = childCase.parentCase ? await Case.findById(childCase.parentCase).select("user") : null;
      if (!principal || String(principal.user) !== String(req.user._id)) {
        return res.status(403).json({ success: false, message: "Not authorized to remove this employee" });
      }
    }

    childCase.previousStatus = childCase.status;
    childCase.status = "removed";
    await childCase.save();
    await caseService.writeAuditLog("remove_employee", childCase, req.user, {}, req);

    return res.status(200).json({
      success: true,
      message: "Employee removed. All data has been preserved.",
      caseId: childCase._id,
      status: "removed",
    });
  } catch (err) {
    handleError(err, next);
  }
};

exports.getTeamLeadDashboard = async (req, res, next) => {
  try {
    const teamFilter = req.user.role === "team_lead"
      ? { $or: [{ assignedTeamLead: req.user._id }, ...(req.user.teamId ? [{ teamId: req.user.teamId }] : [])] }
      : {};
    // Phase 7: the pending-assignment queue (unassignedCases/agingCases) must
    // only ever surface principal/single cases — a child case (caseRole
    // employee/beneficiary) is assigned by cascade from its principal, never
    // independently, so it must never appear here as its own queue item.
    const queueRoleFilter = { caseRole: { $in: ["principal", "single"] } };
    const [unassignedCases, assignedCases, priorityCases, agingCases, workload] = await Promise.all([
      Case.find({ ...teamFilter, ...queueRoleFilter, assignedCaseManager: { $exists: false }, status: { $nin: ["closed", "archived"] } })
        .populate("companyId", "name legalName")
        .populate("beneficiary", "firstName lastName fullName email")
        .select("caseNumber clientName clientEmail visaType visaCategory priority status package plan companyId beneficiary journeyProgress createdAt questionnaireData")
        .sort({ createdAt: -1 })
        .limit(25),
      Case.countDocuments({ ...teamFilter, assignedCaseManager: { $exists: true }, status: { $nin: ["closed", "archived"] } }),
      Case.find({ ...teamFilter, priority: { $in: ["high", "urgent", "Premium Processing"] }, status: { $nin: ["closed", "archived"] } }).sort({ updatedAt: -1 }).limit(25),
      Case.countDocuments({ ...teamFilter, ...queueRoleFilter, assignedCaseManager: { $exists: false }, status: { $nin: ["closed", "archived"] }, createdAt: { $lte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }),
      Case.aggregate([
        { $match: { ...teamFilter, assignedCaseManager: { $exists: true }, status: { $nin: ["closed", "archived"] } } },
        { $group: { _id: "$assignedCaseManager", totalCases: { $sum: 1 }, activeCases: { $sum: { $cond: [{ $ne: ["$status", "pending_assignment"] }, 1, 0] } }, pendingCases: { $sum: { $cond: [{ $eq: ["$status", "pending_assignment"] }, 1, 0] } } } },
        { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "caseManager" } },
        { $unwind: { path: "$caseManager", preserveNullAndEmptyArrays: true } },
        { $project: { _id: 0, caseManagerId: "$_id", caseManagerName: { $ifNull: ["$caseManager.name", "$caseManager.email"] }, totalCases: 1, activeCases: 1, pendingCases: 1 } },
        { $sort: { activeCases: -1 } },
      ]),
    ]);
    const payload = {
      newCases: unassignedCases.length,
      unassignedCases: unassignedCases.length,
      assignedCases,
      priorityCases: priorityCases.length,
      agingCases,
      caseQueue: unassignedCases,
      unassignedCaseList: unassignedCases,
      priorityCaseList: priorityCases,
      caseManagerWorkload: workload,
    };
    res.json({ success: true, ...payload, dashboard: payload });
  } catch (error) {
    handleError(error, next);
  }
};

exports.getCaseWorkflow = async (req, res, next) => {
  try {
    const workflow = await lifecycleOrchestrator.get(req.params.id, req.user, req);
    res.json({ success: true, workflow, data: workflow });
  } catch (error) {
    handleError(error, next);
  }
};

exports.recalculateCaseWorkflow = async (req, res, next) => {
  try {
    const workflow = await lifecycleOrchestrator.recalculate(req.params.id, req.user, req, req.body.reason || "manual_recalculation");
    res.json({ success: true, workflow, data: workflow });
  } catch (error) {
    handleError(error, next);
  }
};

exports.getKnowledgePlan = async (req, res, next) => {
  try {
    const caseData = await caseService.getAccessibleCaseOrThrow(req.params.id, req.user);
    res.json({ success: true, knowledgePlan: caseData.knowledgePlan, data: caseData.knowledgePlan });
  } catch (error) {
    handleError(error, next);
  }
};

exports.refreshKnowledgePlan = async (req, res, next) => {
  try {
    const result = await require("./immigration-knowledge-engine.service").orchestrate(req.params.id, req.user, req, {
      reason: req.body?.reason || "manual_orchestration",
    });
    res.json({ success: true, ...result, data: result });
  } catch (error) {
    handleError(error, next);
  }
};

exports.generateCaseForms = async (req, res, next) => {
  try {
    const result = await lifecycleOrchestrator.generateForms(req.params.id, req.user, req);
    res.json({ success: true, ...result, data: result });
  } catch (error) {
    handleError(error, next);
  }
};

exports.generateCasePackage = async (req, res, next) => {
  try {
    const result = await lifecycleOrchestrator.generatePackage(req.params.id, req.user, req, req.body || {});
    res.status(201).json({ success: true, ...result, data: result });
  } catch (error) {
    handleError(error, next);
  }
};

exports.generateCaseWordPackage = async (req, res, next) => {
  try {
    const result = await require("../form-generation/services/PetitionWordPackageService").generate(req.params.id, req.user, req, req.body?.reason || "manual_regeneration");
    res.status(201).json({ success: true, ...result, data: result });
  } catch (error) {
    handleError(error, next);
  }
};

exports.assignBeneficiary = async (req, res, next) => {
  try {
    const caseData = await getCaseOr404(req.params.id, res);
    if (!caseData) return;
    if (!caseService.canAccessCase(req.user, caseData)) return res.status(403).json({ success: false, message: "Not authorized to modify this case" });
    caseData.beneficiary = req.body.beneficiaryId || req.body.beneficiary;
    await caseService.hydrateCaseRelationships(caseData, req.user, req);
    caseService.addTimelineEvent(caseData, "assignment", "Beneficiary Assigned", "Beneficiary assigned to case", req.user, { beneficiary: caseData.beneficiary });
    caseService.addAuditEntry(caseData, "assign_beneficiary", "Beneficiary assigned", req.user, { beneficiary: caseData.beneficiary }, req);
    await caseData.save();
    await caseService.writeAuditLog("assign_beneficiary", caseData, req.user, { beneficiary: caseData.beneficiary }, req);
    res.json({ success: true, case: caseData });
  } catch (error) {
    handleError(error, next);
  }
};

exports.assignCompany = async (req, res, next) => {
  try {
    const caseData = await getCaseOr404(req.params.id, res);
    if (!caseData) return;
    if (!caseService.canAccessCase(req.user, caseData)) return res.status(403).json({ success: false, message: "Not authorized to modify this case" });
    caseData.companyId = req.body.companyId;
    await caseService.hydrateCaseRelationships(caseData, req.user, req);
    caseService.addTimelineEvent(caseData, "assignment", "Company Assigned", "Company assigned to case", req.user, { companyId: caseData.companyId });
    caseService.addAuditEntry(caseData, "assign_company", "Company assigned", req.user, { companyId: caseData.companyId }, req);
    await caseData.save();
    await caseService.writeAuditLog("assign_company", caseData, req.user, { companyId: caseData.companyId }, req);
    res.json({ success: true, case: caseData });
  } catch (error) {
    handleError(error, next);
  }
};

exports.assignClient = async (req, res, next) => {
  try {
    const caseData = await getCaseOr404(req.params.id, res);
    if (!caseData) return;
    if (!caseService.canAccessCase(req.user, caseData)) return res.status(403).json({ success: false, message: "Not authorized to modify this case" });
    caseData.clientProfile = req.body.clientId || req.body.clientProfile;
    await caseService.hydrateCaseRelationships(caseData, req.user, req);
    caseService.addTimelineEvent(caseData, "assignment", "Client Assigned", "Client assigned to case", req.user, { clientProfile: caseData.clientProfile });
    caseService.addAuditEntry(caseData, "assign_client", "Client assigned", req.user, { clientProfile: caseData.clientProfile }, req);
    await caseData.save();
    await caseService.writeAuditLog("assign_client", caseData, req.user, { clientProfile: caseData.clientProfile }, req);
    res.json({ success: true, case: caseData });
  } catch (error) {
    handleError(error, next);
  }
};

exports.linkCase = async (req, res, next) => {
  try {
    const caseData = await getCaseOr404(req.params.id, res);
    if (!caseData) return;
    if (!caseService.canAccessCase(req.user, caseData)) return res.status(403).json({ success: false, message: "Not authorized to modify this case" });
    const updated = await caseService.linkCases(caseData, req.body.linkedCaseId || req.body.caseId, req.body.relationship, req.user, req.body.notes, req);
    res.json({ success: true, case: updated });
  } catch (error) {
    handleError(error, next);
  }
};

exports.getRelated = async (req, res, next) => {
  try {
    const caseData = await caseService.getAccessibleCaseOrThrow(req.params.id, req.user);
    const related = await caseService.getRelatedRecords(caseData);
    if (caseService.isRestrictedPortalRole(req.user?.role)) {
      return res.json({
        success: true,
        case: caseService.serializeCaseForUser(caseData, req.user),
        documents: (related.documents || []).map((document) => documentService.sanitizeDocumentForUser(document, req.user)),
        messages: related.messages || [],
        notifications: related.notifications || [],
        appointments: related.appointments || [],
        payments: [],
        tasks: [],
        workflows: [],
        parentCase: null,
        childCases: [],
      });
    }
    res.json({ success: true, case: caseData, ...related });
  } catch (error) {
    handleError(error, next);
  }
};

exports.getTimeline = async (req, res, next) => {
  try {
    const caseData = await caseService.getAccessibleCaseOrThrow(req.params.id, req.user);
    if (caseService.isRestrictedPortalRole(req.user?.role)) {
      const serialized = caseService.serializeCaseForUser(caseData, req.user);
      return res.json({ success: true, timeline: serialized.timeline || [], activityLog: [], stageHistory: caseData.stageHistory || [], auditHistory: [] });
    }
    res.json({ success: true, timeline: caseData.timeline, activityLog: caseData.activityLog, stageHistory: caseData.stageHistory, auditHistory: caseData.auditHistory });
  } catch (error) {
    handleError(error, next);
  }
};

exports.bulkActions = async (req, res, next) => {
  try {
    const result = await caseService.bulkUpdateCases(req.body.caseIds || req.body.ids, req.body.action, req.body, req.user, req);
    res.json({ success: true, ...result });
  } catch (error) {
    handleError(error, next);
  }
};

exports.sendQuestionnaire = async (req, res, next) => {
  try {
    const caseData = await getCaseOr404(req.params.id, res);
    if (!caseData) return;
    if (!caseService.canAccessCase(req.user, caseData)) return res.status(403).json({ success: false, message: "Not authorized to modify this case" });
    if (req.body.questionnaireId) {
      const questionnaire = await Questionnaire.findById(req.body.questionnaireId);
      if (questionnaire) {
        const result = await questionnaireService.assignQuestionnaire(questionnaire, { ...req.body, caseId: caseData._id }, req.user, req);
        return res.json({ success: true, message: "Questionnaire sent", data: result, questionnaireReferences: result.case.questionnaireReferences });
      }
    }

    const reference = {
      questionnaireId: req.body.questionnaireId,
      title: req.body.title || "Case Questionnaire",
      status: "not_started",
      sentAt: new Date(),
      dueDate: req.body.dueDate,
      assignedTo: req.body.assignedTo || caseData.user || caseData.clientProfile,
      sentBy: req.user._id,
      notes: req.body.message,
    };
    caseData.questionnaireReferences.push(reference);
    await workflowService.questionnaireSent(caseData, req.user, reference);
    caseService.addAuditEntry(caseData, "send_questionnaire", "Questionnaire sent", req.user, reference, req);
    await caseData.save();
    await caseService.writeAuditLog("send_questionnaire", caseData, req.user, reference, req);

    res.json({ success: true, message: "Questionnaire sent", questionnaireReferences: caseData.questionnaireReferences });
  } catch (error) {
    handleError(error, next);
  }
};

exports.submitQuestionnaire = async (req, res, next) => {
  try {
    const caseData = await getCaseOr404(req.params.id, res);
    if (!caseData) return;
    if (!caseService.canAccessCase(req.user, caseData)) return res.status(403).json({ success: false, message: "Not authorized to access this case" });
    if (req.body.questionnaireId && Array.isArray(req.body.answers)) {
      const result = await questionnaireService.submitResponse({ ...req.body, caseId: caseData._id }, req.user, req);
      return res.json({ success: true, message: "Questionnaire submitted", data: result });
    }

    const questionnaire = caseData.questionnaireReferences.id(req.body.referenceId)
      || caseData.questionnaireReferences.find((item) => item.questionnaireId?.toString() === req.body.questionnaireId);
    if (questionnaire) {
      questionnaire.status = "submitted";
      questionnaire.submittedAt = new Date();
    }
    caseService.addTimelineEvent(caseData, "questionnaire", "Questionnaire Submitted", "Questionnaire submitted", req.user);
    caseService.addAuditEntry(caseData, "submit_questionnaire", "Questionnaire submitted", req.user, req.body, req);
    await caseData.save();
    await caseService.writeAuditLog("submit_questionnaire", caseData, req.user, req.body, req);
    res.json({ success: true, message: "Questionnaire submitted" });
  } catch (error) {
    handleError(error, next);
  }
};

exports.approveQuestionnaire = async (req, res, next) => {
  try {
    const caseData = await getCaseOr404(req.params.id, res);
    if (!caseData) return;
    if (req.body.responseId) {
      const answers = await questionnaireService.approveResponse(req.body.responseId, req.body, req.user, req);
      return res.json({ success: true, message: "Questionnaire reviewed", answers });
    }
    const questionnaire = caseData.questionnaireReferences.id(req.body.referenceId)
      || caseData.questionnaireReferences.find((item) => item.questionnaireId?.toString() === req.body.questionnaireId);
    if (questionnaire) {
      questionnaire.status = "approved";
      questionnaire.approvedAt = new Date();
    }
    caseService.addTimelineEvent(caseData, "questionnaire", "Questionnaire Approved", "Questionnaire approved", req.user);
    caseService.addAuditEntry(caseData, "approve_questionnaire", "Questionnaire approved", req.user, req.body, req);
    await caseData.save();
    await caseService.writeAuditLog("approve_questionnaire", caseData, req.user, req.body, req);
    res.json({ success: true, message: "Questionnaire approved" });
  } catch (error) {
    handleError(error, next);
  }
};

exports.requestDocuments = async (req, res, next) => {
  try {
    const caseData = await getCaseOr404(req.params.id, res);
    if (!caseData) return;
    if (!caseService.canAccessCase(req.user, caseData)) return res.status(403).json({ success: false, message: "Not authorized to modify this case" });

    const requiredDocuments = req.body.requiredDocuments || [];
    const existingDocumentTypes = new Set(
      [...(caseData.documentChecklist || []), ...(caseData.checklistItems || [])].map((item) => item.documentType).filter(Boolean)
    );
    requiredDocuments.forEach((documentType) => {
      const resolvedType = documentType.documentType || documentType.name || documentType;
      // Dedup by documentType against BOTH mirrored arrays, and push into
      // both — this previously had no dedup at all and pushed into
      // documentChecklist only, so re-requesting or repeating a document
      // duplicated it and diverged the two arrays.
      if (existingDocumentTypes.has(resolvedType)) return;
      const next = {
        name: documentType.name || documentType,
        documentType: resolvedType,
        description: documentType.description,
        required: documentType.required !== false,
        status: "requested",
        requestedDate: new Date(),
        dueDate: documentType.dueDate || req.body.dueDate,
        notes: req.body.message,
      };
      caseData.documentChecklist.push(next);
      caseData.checklistItems.push(next);
      existingDocumentTypes.add(resolvedType);
    });
    await workflowService.documentsRequested(caseData, req.user, { requiredDocuments, dueDate: req.body.dueDate });
    caseService.addAuditEntry(caseData, "request_documents", "Documents requested", req.user, req.body, req);
    await caseData.save();
    await caseService.writeAuditLog("request_documents", caseData, req.user, req.body, req);

    res.json({ success: true, message: "Document request sent", case: caseData });
  } catch (error) {
    handleError(error, next);
  }
};

exports.addDocumentReference = async (req, res, next) => {
  try {
    const caseData = await getCaseOr404(req.params.id, res);
    if (!caseData) return;
    if (!caseService.canAccessCase(req.user, caseData)) return res.status(403).json({ success: false, message: "Not authorized to modify this case" });
    caseData.documentReferences.addToSet(req.body.documentId);
    caseService.addTimelineEvent(caseData, "document_reference", "Document Reference Added", "Document linked to case", req.user, { documentId: req.body.documentId });
    caseService.addAuditEntry(caseData, "add_document_reference", "Document reference added", req.user, { documentId: req.body.documentId }, req);
    await caseData.save();
    await caseService.writeAuditLog("add_document_reference", caseData, req.user, { documentId: req.body.documentId }, req);
    res.json({ success: true, documentReferences: caseData.documentReferences });
  } catch (error) {
    handleError(error, next);
  }
};

exports.addUSCISFormReference = async (req, res, next) => {
  try {
    const caseData = await getCaseOr404(req.params.id, res);
    if (!caseData) return;
    const reference = { refId: req.body.refId, refModel: req.body.refModel || "CaseForm", label: req.body.label, status: req.body.status, addedBy: req.user._id };
    caseData.uscisFormReferences.push(reference);
    caseService.addTimelineEvent(caseData, "uscis_form", "USCIS Form Linked", reference.label || "USCIS form linked", req.user, reference);
    caseService.addAuditEntry(caseData, "add_uscis_form_reference", "USCIS form reference added", req.user, reference, req);
    await caseData.save();
    await caseService.writeAuditLog("add_uscis_form_reference", caseData, req.user, reference, req);
    res.json({ success: true, uscisFormReferences: caseData.uscisFormReferences });
  } catch (error) {
    handleError(error, next);
  }
};

exports.addQuestionnaireReference = async (req, res, next) => {
  try {
    const caseData = await getCaseOr404(req.params.id, res);
    if (!caseData) return;
    if (!caseService.canAccessCase(req.user, caseData)) return res.status(403).json({ success: false, message: "Not authorized to modify this case" });
    const reference = {
      questionnaireId: req.body.questionnaireId,
      title: req.body.title || "Case Questionnaire",
      status: req.body.status || "not_started",
      dueDate: req.body.dueDate,
      assignedTo: req.body.assignedTo || caseData.user,
      sentBy: req.user._id,
      notes: req.body.notes,
    };
    caseData.questionnaireReferences.push(reference);
    caseService.addTimelineEvent(caseData, "questionnaire", "Questionnaire Linked", reference.title, req.user, reference);
    caseService.addAuditEntry(caseData, "add_questionnaire_reference", "Questionnaire reference added", req.user, reference, req);
    await caseData.save();
    await caseService.writeAuditLog("add_questionnaire_reference", caseData, req.user, reference, req);
    res.json({ success: true, questionnaireReferences: caseData.questionnaireReferences });
  } catch (error) {
    handleError(error, next);
  }
};

exports.uploadChecklistFile = async (req, res, next) => {
  try {
    const caseData = await getCaseOr404(req.params.id, res);
    if (!caseData) return;
    if (!caseService.canAccessCase(req.user, caseData)) return res.status(403).json({ success: false, message: "Not authorized to modify this case" });
    const idx = parseInt(req.params.idx, 10);
    const item = caseData.checklistItems[idx] || caseData.documentChecklist[idx];
    if (!item) return res.status(404).json({ success: false, message: "Checklist item not found" });
    const newFiles = await Promise.all((req.files || []).map(async (file) => {
      const storageKey = storageService.generateDocumentKey({
        caseId: caseData._id,
        userId: req.user._id,
        originalName: file.originalname,
      });
      const stored = await storageService.storeBuffer(storageKey, file.buffer);
      return {
        originalName: file.originalname,
        storedName: path.basename(stored.key),
        storageProvider: stored.provider,
        storageKey: stored.key,
        filePath: stored.path,
        documentUrl: stored.url,
        checksum: stored.checksum,
        size: stored.size,
        mimeType: file.mimetype,
        uploadedAt: new Date(),
      };
    }));
    item.uploadedFiles.push(...newFiles);
    if (["pending", "requested"].includes(item.status)) item.status = "submitted";
    item.submittedAt = item.submittedAt || new Date();
    item.uploadedDate = item.uploadedDate || new Date();
    caseData.documentChecklist = caseData.checklistItems;
    caseService.addActivity(caseData, "Checklist File Uploaded", `"${item.name}" uploaded`, req.user);
    caseService.addTimelineEvent(caseData, "checklist", "Checklist File Uploaded", `"${item.name}" uploaded`, req.user, { files: newFiles.length });
    caseService.addAuditEntry(caseData, "upload_checklist_file", "Checklist file uploaded", req.user, { idx, files: newFiles.length }, req);
    await caseData.save();
    await caseService.writeAuditLog("upload_checklist_file", caseData, req.user, { idx, files: newFiles.length }, req);
    res.json({ success: true, message: "File uploaded", item });
  } catch (error) {
    handleError(error, next);
  }
};

exports.updateChecklistItem = async (req, res, next) => {
  try {
    const caseData = await getCaseOr404(req.params.id, res);
    if (!caseData) return;
    const idx = parseInt(req.params.idx, 10);
    const item = caseData.checklistItems[idx] || caseData.documentChecklist[idx];
    if (!item) return res.status(404).json({ success: false, message: "Checklist item not found" });
    if (req.body.status) item.status = req.body.status;
    if (req.body.adminNotes !== undefined) item.adminNotes = req.body.adminNotes;
    if (req.body.notes !== undefined) item.notes = req.body.notes;
    if (["approved", "rejected"].includes(req.body.status)) item.reviewedAt = new Date();
    caseData.documentChecklist = caseData.checklistItems;
    caseService.addActivity(caseData, "Checklist Item Reviewed", `"${item.name}" marked as ${item.status}`, req.user);
    caseService.addAuditEntry(caseData, "review_checklist_item", "Checklist item reviewed", req.user, { idx, status: item.status }, req);
    await caseData.save();
    await caseService.writeAuditLog("review_checklist_item", caseData, req.user, { idx, status: item.status }, req);
    res.json({ success: true, message: "Checklist item updated", item });
  } catch (error) {
    handleError(error, next);
  }
};

exports.generateCaseChecklist = async (req, res, next) => {
  try {
    const caseData = await getCaseOr404(req.params.id, res);
    if (!caseData) return;
    const visaType = req.body.visaType || caseData.visaType;
    const checklist = await resolveDocumentRequirements(visaType);
    caseData.checklistItems = checklist;
    caseData.documentChecklist = checklist;
    if (req.body.visaType) caseData.visaType = req.body.visaType;
    caseService.addAuditEntry(caseData, "generate_checklist", "Checklist regenerated", req.user, { visaType }, req);
    await caseData.save();
    await caseService.writeAuditLog("generate_checklist", caseData, req.user, { visaType }, req);
    res.json({ success: true, message: "Checklist regenerated", checklistItems: caseData.checklistItems, documentChecklist: caseData.documentChecklist });
  } catch (error) {
    handleError(error, next);
  }
};

exports.updatePlan = async (req, res, next) => {
  try {
    if (caseService.isRestrictedPortalRole(req.user?.role)) {
      return res.status(403).json({ success: false, message: "Not authorized to modify case plan" });
    }
    const caseData = await getCaseOr404(req.params.id, res);
    if (!caseData) return;
    if (!caseService.canAccessCase(req.user, caseData)) {
      return res.status(403).json({ success: false, message: "Not authorized to modify this case" });
    }
    ["tier", "currency"].forEach((field) => {
      if (req.body[field] !== undefined) caseData.plan[field] = req.body[field];
    });
    if (req.body.amount !== undefined) {
      const rawAmount = Number(req.body.amount || 0);
      caseData.plan.amount = rawAmount > 0 && rawAmount < 10000 ? Math.round(rawAmount * 100) : Math.round(rawAmount);
    }
    if (req.body.paymentStatus !== undefined) {
      if (!CASE_PLAN_STATUSES.has(req.body.paymentStatus)) {
        return res.status(400).json({
          success: false,
          message: "Plan payment status can only be completed by a verified payment event.",
        });
      }
      caseData.plan.paymentStatus = req.body.paymentStatus;
      if (req.body.paymentStatus !== "paid") caseData.plan.paidAt = undefined;
    }
    if (req.body.tier) caseData.plan.selectedAt = new Date();
    caseService.addActivity(caseData, "Plan Updated", `Plan set to ${caseData.plan.tier}`, req.user);
    await caseData.save();
    await caseService.writeAuditLog("update_plan", caseData, req.user, req.body, req);
    res.json({ success: true, message: "Plan updated", plan: caseData.plan });
  } catch (error) {
    handleError(error, next);
  }
};

exports.saveAssessment = async (req, res, next) => {
  try {
    const caseData = await getCaseOr404(req.params.id, res);
    if (!caseData) return;
    if (!caseService.canAccessCase(req.user, caseData)) {
      return res.status(403).json({ success: false, message: "Not authorized to modify this case" });
    }
    if (caseService.isRestrictedPortalRole(req.user?.role)) {
      return res.status(403).json({ success: false, message: "Not authorized to modify case assessment" });
    }
    caseData.assessmentAnswers = req.body.assessmentAnswers || {};
    if (req.body.assessmentMatchPercentage !== undefined) caseData.assessmentMatchPercentage = req.body.assessmentMatchPercentage;
    await caseData.save();
    await caseService.writeAuditLog("save_assessment", caseData, req.user, req.body, req);
    res.json({ success: true, message: "Assessment saved" });
  } catch (error) {
    handleError(error, next);
  }
};

exports.archiveCase = async (req, res, next) => {
  try {
    const caseData = await getCaseOr404(req.params.id, res);
    if (!caseData) return;
    const archived = await caseService.archiveCase(caseData, req.user, req);
    res.json({ success: true, message: "Case archived successfully", case: archived });
  } catch (error) {
    handleError(error, next);
  }
};

exports.reopenCase = async (req, res, next) => {
  try {
    const caseData = await getCaseOr404(req.params.id, res);
    if (!caseData) return;
    const reopened = await caseService.reopenCase(caseData, req.user, req);
    res.json({ success: true, message: "Case reopened successfully", case: reopened });
  } catch (error) {
    handleError(error, next);
  }
};

// Staff-initiated case creation from the INSZoom portal (case managers and
// team leads only) — creates the client User/Client records and sends a
// portal-activation invite instead of going through client self-registration.
exports.createCaseWithClient = async (req, res, next) => {
  try {
    const {
      clientName,
      clientEmail,
      clientPhone,
      visaType,
      packageName,
      assignedCaseManager,
      employerName,
      employerEmail,
      employerCompletionMode,
      caseDetails,
    } = req.body;

    if (!clientName || !clientName.trim()) {
      return res.status(400).json({ success: false, message: "Client name is required" });
    }
    if (!clientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
      return res.status(400).json({ success: false, message: "A valid client email is required" });
    }
    if (!visaType) {
      return res.status(400).json({ success: false, message: "Visa type is required" });
    }
    const normalizedPackage = packageName ? normalizePackageName(packageName) : "";
    if (packageName && !normalizedPackage) {
      return res.status(400).json({
        success: false,
        message: `Package must be one of: ${PACKAGE_NAMES.join(", ")}`,
      });
    }

    const email = clientEmail.toLowerCase().trim();

    const existingUser = await User.findOne({ email }).select("+password");
    if (existingUser && existingUser.password) {
      return res.status(409).json({
        success: false,
        message: "An active account already exists for this email address. The client can log in directly.",
        code: "CLIENT_ALREADY_REGISTERED",
      });
    }
    if (existingUser && clientInviteService.isPendingClientInvite(existingUser)) {
      return res.status(409).json({
        success: false,
        message: "A pending invitation already exists for this email. Resend the invite instead.",
        code: "PENDING_CLIENT_INVITE",
      });
    }

    const referralCode = await generateUniqueReferralCode(User);
    const nameParts = clientName.trim().split(/\s+/);
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";

    const newUser = await User.create({
      email,
      name: clientName.trim(),
      displayName: clientName.trim(),
      phone: clientPhone || undefined,
      role: "client",
      referralCode,
      isActive: false,
      isEmailVerified: false,
    });

    const caseNumber = generateCaseNumber("INS");
    const selectedAt = normalizedPackage ? new Date() : undefined;
    const checklist = await resolveDocumentRequirements(visaType);
    const clientProfile = await Client.findOneAndUpdate(
      { user: newUser._id },
      {
        user: newUser._id,
        clientPortalId: caseNumber,
        email,
        fullName: clientName.trim(),
        firstName,
        lastName,
        primaryPhone: clientPhone || undefined,
        visaType,
        visaCategory: visaType,
        selectedPlan: normalizedPackage,
        planSelectedAt: selectedAt,
        completed: true,
        lastStep: 100,
        assessmentCompleted: true,
        intakeSubmission: {
          status: "locked",
          submittedAt: new Date(),
          submittedBy: req.user._id,
          lockedAt: new Date(),
          lockedBy: req.user._id,
        },
        source: "INSZoom",
        createdBy: req.user._id,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const teamLead = await caseService.resolveTeamLeadForCase(req.body);
    const assignmentMode = employerCompletionMode === "invite_employees" ? "invite_employees" : employerCompletionMode === "employer_completes" ? "employer_completes" : "";
    const trimmedEmployerName = String(employerName || "").trim();
    const trimmedEmployerEmail = String(employerEmail || "").trim().toLowerCase();
    const trimmedCaseDetails = String(caseDetails || "").trim();
    const questionnaireMasterData = {};
    if (assignmentMode) {
      questionnaireMasterData.employeeQuestionnaireAssignment = {
        mode: assignmentMode,
        selectedAt: new Date(),
        selectedBy: req.user._id,
      };
    }
    if (trimmedEmployerName || trimmedEmployerEmail) {
      questionnaireMasterData.employer = {
        company: {
          fullName: trimmedEmployerName,
          email: trimmedEmployerEmail,
        },
      };
    }

    const newCase = await Case.create({
      isDemoData: false,
      caseId: caseNumber,
      caseNumber,
      clientPortalId: caseNumber,
      user: newUser._id,
      clientProfile: clientProfile._id,
      createdBy: req.user._id,
      lastModifiedBy: req.user._id,
      clientName: clientName.trim(),
      clientEmail: email,
      visaType,
      visaCategory: visaType,
      // Case has no top-level "packageName" field — only the enum-constrained
      // "package" and free-text "primaryPackage" (both hold the same
      // canonical string; see Backend/src/config/packages.js).
      package: normalizedPackage,
      primaryPackage: normalizedPackage || undefined,
      plan: {
        tier: normalizedPackage,
        selectedAt,
        paymentStatus: "not_started",
        currency: "USD",
      },
      documentChecklist: checklist,
      checklistItems: checklist,
      questionnaireData: {
        masterData: questionnaireMasterData,
      },
      petitionerName: trimmedEmployerName || undefined,
      employeeInvite: assignmentMode === "invite_employees" ? {
        status: "not_sent",
        invitedBy: req.user._id,
      } : undefined,
      employerEmployeeWorkflow: assignmentMode ? {
        employerStatus: "not_started",
        employeeStatus: assignmentMode === "invite_employees" ? "not_invited" : "in_progress",
        caseManagerStatus: assignmentMode === "invite_employees" ? "waiting_for_employee" : "waiting_for_employer",
      } : undefined,
      status: assignedCaseManager ? "assigned" : "pending_assignment",
      assignedTeamLead: teamLead?._id,
      teamId: teamLead?.teamId,
      assignedAgent: assignedCaseManager ? (req.user.displayName || req.user.name) : "Team Lead Queue",
      agentEmail: assignedCaseManager ? req.user.email : undefined,
      primaryOwner: assignedCaseManager,
      assignedCaseManager: assignedCaseManager || undefined,
      internalNotes: trimmedCaseDetails ? [{
        author: req.user._id,
        note: trimmedCaseDetails,
        category: "general",
        visibility: "team",
      }] : [],
      legacySource: "INSZoom",
    });

    await caseService.hydrateCaseRelationships(newCase, req.user, req);
    caseService.setStage(newCase, "intake", req.user, "Case created by staff");
    await workflowService.caseCreated(newCase, req.user);
    caseService.addAuditEntry(newCase, "create", "Case created by staff via INSZoom portal", req.user, { caseNumber }, req);
    await newCase.save();
    await caseService.writeAuditLog("create", newCase, req.user, req.body, req);

    const lifecycle = await lifecycleOrchestrator.initializeCase(newCase, req.user, req);

    const inviteToken = await clientInviteService.createClientInviteToken(newUser);
    await emailService.sendTemplateEmail("client-portal-invitation", {
      to: email,
      data: { clientName: clientName.trim(), caseNumber, token: inviteToken },
      caseId: lifecycle.case._id,
      userId: newUser._id,
      source: "shared",
    });

    res.status(201).json({
      success: true,
      message: "Case created and client invitation sent",
      case: lifecycle.case,
      caseSummary: caseService.summarizeCase(lifecycle.case),
      clientUserId: newUser._id,
      inviteSent: true,
    });
  } catch (error) {
    handleError(error, next);
  }
};
