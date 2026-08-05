const path = require("path");
const multer = require("multer");
const Case = require("../../models/Case");
const CaseAssignmentEvent = require("../../models/CaseAssignmentEvent");
const Conversation = require("../../models/Conversation");
const Questionnaire = require("../../models/Questionnaire");
const User = require("../../models/User");
const { resolveDocumentRequirements } = require("../document-requirements/document-requirement.resolver");
const generateCaseNumber = require("./caseId");
const caseService = require("./case.service");
const workflowService = require("./case.workflow.service");
const lifecycleOrchestrator = require("./case-lifecycle-orchestrator.service");
const { evaluateStageGate } = require("./case-gating.config");
const questionnaireService = require("../questionnaires/questionnaire.service");
const messageService = require("../messages/message.service");
const paymentGateway = require("../payments/payment.gateway");
const paymentService = require("../payments/payment.service");
const notificationService = require("../notifications/notification.service");
const realtimeGateway = require("../realtime/realtime.gateway");
const storageService = require("../uploads/storage.service");
const { normalizeRole } = require("../authorization/roleHierarchy");

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

async function notifyAssignee(userId, caseData, role, actor, req) {
  if (!userId) return;
  const packageName = caseData.plan?.packageName || caseData.plan?.tier || caseData.packageName || caseData.package;
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
  try {
    const filter = caseService.buildCaseFilter({}, req.user);
    const caseData = await caseService.populateCaseQuery(Case.findOne(filter).sort({ createdAt: -1 }));
    if (!caseData) return res.json(null);
    const payload = caseService.serializeCaseForUser(caseData, req.user);
    payload.caseSummary = caseService.summarizeCase(caseData);
    res.json(payload);
  } catch (error) {
    handleError(error, next);
  }
};

exports.getAvailableAddons = async (req, res, next) => {
  try {
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
      const exists = (caseData.documentChecklist || []).some((item) => item.documentType === document.documentType);
      if (!exists) caseData.documentChecklist.push({ ...document, category: "immigration", requestedDate: new Date() });
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
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const filter = await caseService.resolveCaseSearchFilter(req.query, req.user);
    const sort = caseService.buildCaseSort(req.query);
    const skip = (page - 1) * limit;

    const [total, cases] = await Promise.all([
      Case.countDocuments(filter),
      caseService.populateCaseQuery(Case.find(filter).sort(sort).skip(skip).limit(limit)),
    ]);

    const summaries = cases.map((caseData) => caseService.summarizeCase(caseData));
    const serializedCases = cases.map((caseData) => caseService.serializeCaseForUser(caseData, req.user));
    res.json({ success: true, count: serializedCases.length, total, page, pages: Math.ceil(total / limit), cases: serializedCases, summaries, data: serializedCases });
  } catch (error) {
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

exports.createCase = async (req, res, next) => {
  try {
    const caseNumber = req.body.caseNumber || req.body.caseId || generateCaseNumber(req.body.legacySource === "BAIS" ? "BAIS" : "INS");
    // Document/questionnaire requirements are no longer hardcoded per visa type here:
    // ImmigrationKnowledgeEngineService.orchestrate() (invoked below via
    // lifecycleOrchestrator.initializeCase) derives them generically from each
    // active Questionnaire's assignmentRules.visaTypes, for every visa type.
    const checklist = [...(req.body.checklistItems || req.body.documentChecklist || [])];
    const requesterRole = normalizeRole(req.user.role);
    const primaryApplicant = req.body.primaryApplicant || req.body.assessmentAnswers?.primaryApplicant;
    const teamLead = await caseService.resolveTeamLeadForCase(req.body);
    const newCase = await Case.create({
      ...req.body,
      caseId: req.body.caseId || caseNumber,
      caseNumber,
      clientPortalId: req.body.clientPortalId || caseNumber,
      user: req.body.user || req.body.userId || (["client", "user"].includes(requesterRole) ? req.user._id : undefined),
      employerUser: req.body.employerUser || req.body.employerUserId || (requesterRole === "employer" || primaryApplicant === "employer" ? req.user._id : undefined),
      employeeUser: req.body.employeeUser || req.body.employeeUserId || (requesterRole === "employee" || primaryApplicant === "employee" ? req.user._id : undefined),
      createdBy: req.user._id,
      lastModifiedBy: req.user._id,
      clientProfile: req.body.clientProfile || req.body.clientId,
      beneficiary: req.body.beneficiary || req.body.beneficiaryId,
      petitioner: req.body.petitioner || req.body.petitionerId,
      petitionerModel: req.body.petitionerModel || (req.body.petitioner || req.body.petitionerId ? "User" : ""),
      employer: req.body.employer || req.body.employerId || req.body.companyId,
      organization: req.body.organization || req.body.organizationId || req.body.companyId,
      parentCase: req.body.parentCase || req.body.parentCaseId,
      clientName: req.body.clientName || req.user.displayName || req.user.name,
      clientEmail: req.body.clientEmail || req.user.email,
      checklistItems: checklist,
      documentChecklist: checklist,
      status: req.body.status || (req.body.assignedCaseManager ? "assigned" : "pending_assignment"),
      assignedTeamLead: req.body.assignedTeamLead || teamLead?._id,
      teamId: req.body.teamId || teamLead?.teamId,
      assignedAgent: req.body.assignedCaseManager ? (req.user.displayName || req.user.name || "Immigration CRM") : "Team Lead Queue",
      agentEmail: req.body.assignedCaseManager ? req.user.email : undefined,
      assignedAgentUser: req.body.assignedCaseManager ? req.user._id : undefined,
      primaryOwner: req.body.primaryOwner || req.body.assignedCaseManager,
      assignedCaseManager: req.body.assignedCaseManager,
      legacySource: req.body.legacySource || "shared",
    });

    await caseService.hydrateCaseRelationships(newCase, req.user, req);
    caseService.setStage(newCase, req.body.stage || "intake", req.user, "Case created");
    await workflowService.caseCreated(newCase, req.user);
    caseService.addAuditEntry(newCase, "create", "Case created", req.user, { caseNumber }, req);
    await newCase.save();
    await caseService.writeAuditLog("create", newCase, req.user, req.body, req);
    const lifecycle = await lifecycleOrchestrator.initializeCase(newCase, req.user, req);
    res.status(201).json({
      success: true,
      message: "Case created",
      case: lifecycle.case,
      caseSummary: caseService.summarizeCase(lifecycle.case),
      workflow: lifecycle.progress,
      knowledgePlan: lifecycle.knowledgePlan,
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
    const lifecycle = await lifecycleOrchestrator.onAssignment(caseData, req.user, req);
    res.json({ success: true, case: lifecycle.case, workflow: lifecycle.progress });
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
    await caseData.save();
    await syncCaseMessagingAssignment(caseData);
    await recordReassignment(caseData, "team_lead", previousTeamLeadId, teamLeadId, req.user, req);
    await caseService.writeAuditLog("assign_team_lead", caseData, req.user, { teamLeadId }, req);
    await notifyAssignee(teamLeadId, caseData, "team_lead", req.user, req);
    res.json({ success: true, case: caseData });
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

exports.getTeamLeadDashboard = async (req, res, next) => {
  try {
    const teamFilter = req.user.role === "team_lead"
      ? { $or: [{ assignedTeamLead: req.user._id }, ...(req.user.teamId ? [{ teamId: req.user.teamId }] : [])] }
      : {};
    const [unassignedCases, assignedCases, priorityCases, agingCases, workload] = await Promise.all([
      Case.find({ ...teamFilter, assignedCaseManager: { $exists: false }, status: { $nin: ["closed", "archived"] } })
        .populate("companyId", "name legalName")
        .populate("beneficiary", "firstName lastName fullName email")
        .select("caseNumber clientName clientEmail visaType visaCategory priority status package plan companyId beneficiary journeyProgress createdAt questionnaireData")
        .sort({ createdAt: -1 })
        .limit(25),
      Case.countDocuments({ ...teamFilter, assignedCaseManager: { $exists: true }, status: { $nin: ["closed", "archived"] } }),
      Case.find({ ...teamFilter, priority: { $in: ["high", "urgent", "Premium Processing"] }, status: { $nin: ["closed", "archived"] } }).sort({ updatedAt: -1 }).limit(25),
      Case.countDocuments({ ...teamFilter, assignedCaseManager: { $exists: false }, status: { $nin: ["closed", "archived"] }, createdAt: { $lte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }),
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
    res.json({ success: true, case: caseData, ...related });
  } catch (error) {
    handleError(error, next);
  }
};

exports.getTimeline = async (req, res, next) => {
  try {
    const caseData = await caseService.getAccessibleCaseOrThrow(req.params.id, req.user);
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
    requiredDocuments.forEach((documentType) => {
      caseData.documentChecklist.push({
        name: documentType.name || documentType,
        documentType: documentType.documentType || documentType.name || documentType,
        description: documentType.description,
        required: documentType.required !== false,
        status: "requested",
        requestedDate: new Date(),
        dueDate: documentType.dueDate || req.body.dueDate,
        notes: req.body.message,
      });
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
