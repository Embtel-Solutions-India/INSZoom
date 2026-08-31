const Answer = require("../../models/Answer");
const Case = require("../../models/Case");
const CaseForm = require("../../models/CaseForm");
const Client = require("../../models/Client");
const Document = require("../../models/Document");
const Task = require("../../models/Task");
const User = require("../../models/User");
const caseService = require("./case.service");
const beneficiaryService = require("../beneficiaries/beneficiary.service");
const notificationService = require("../notifications/notification.service");
const realtimeGateway = require("../realtime/realtime.gateway");
const { isDatabaseUnavailableError } = require("../../middleware/errorHandler");

const TERMINAL_STATUSES = new Set(["closed", "archived", "cancelled", "rejected"]);
const FORM_GENERATED_STATUSES = new Set(["ai_filled", "draft", "in_review", "under_review", "needs_revision", "approved", "ready_for_pdf", "generated", "locked", "filed"]);
const FORM_APPROVED_STATUSES = new Set(["approved", "ready_for_pdf", "generated", "locked", "filed"]);
const DOCUMENT_COMPLETE_STATUSES = new Set(["submitted", "uploaded", "approved", "accepted", "complete", "completed"]);

const MILESTONE_DEFINITIONS = [
  { key: "case_created", label: "Case Created", weight: 5, role: "client", route: "/dashboard" },
  { key: "case_assigned", label: "Case Assigned", weight: 10, role: "team_lead", route: "/crm-cases" },
  { key: "questionnaire_completed", label: "Questionnaire Completed", weight: 25, role: "client", route: "/dashboard/profile" },
  { key: "documents_completed", label: "Documents Uploaded", weight: 25, role: "client", route: "/dashboard/documents" },
  { key: "case_manager_review", label: "Case Manager Review", weight: 25, role: "case_manager", route: "/crm-cases" },
  { key: "filed", label: "Filed", weight: 10, role: "case_manager", route: "/crm-cases" },
];

function idOf(value) {
  return value?._id?.toString?.() || value?.toString?.();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeDocumentKey(value) {
  const normalized = normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
  const aliases = [
    [["passport", "passportcopy"], "passport"],
    [["resume", "cv", "resumecv"], "resume"],
    [["degree", "degreecertificate", "diploma"], "degree"],
    [["transcript", "transcripts", "academictranscripts"], "transcript"],
    [["employmentletter", "employmentverificationletter", "experienceletter", "experienceletters"], "employmentletter"],
    [["marriagecertificate"], "marriagecertificate"],
    [["birthcertificate", "birthcertificates"], "birthcertificate"],
    [["taxreturn", "taxreturns"], "taxreturn"],
    [["i94", "formi94"], "i94"],
    [["i20", "formi20"], "i20"],
  ];
  return aliases.find(([values]) => values.includes(normalized))?.[1] || normalized;
}

function personName(value, fallback = "Client") {
  const parts = normalizeText(value || fallback).split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || fallback,
    lastName: parts.slice(1).join(" ") || "Client",
    fullName: parts.join(" ") || fallback,
  };
}

class CaseLifecycleOrchestrator {
  static userId(user) {
    return user?._id || user?.id || user;
  }

  static calculateProgress(metrics = {}) {
    const completedByKey = {
      case_created: true,
      case_assigned: Boolean(metrics.assigned),
      questionnaire_completed: Boolean(metrics.questionnaireComplete),
      documents_completed: Boolean(metrics.documentsComplete),
      case_manager_review: Boolean(metrics.caseManagerReviewComplete),
      filed: Boolean(metrics.filed),
    };
    let percent = 0;
    const milestones = MILESTONE_DEFINITIONS.map((definition) => {
      const completed = completedByKey[definition.key];
      if (completed) percent += definition.weight;
      return {
        ...definition,
        completed,
        status: completed ? "completed" : "pending",
        completedAt: metrics.completedAt?.[definition.key],
      };
    });
    const current = milestones.find((milestone) => !milestone.completed) || milestones[milestones.length - 1];
    return {
      percent: Math.min(percent, 100),
      currentMilestone: current?.key || "filed",
      nextAction: current ? { key: current.key, label: current.label, route: current.route, role: current.role } : null,
      milestones,
    };
  }

  static async metrics(caseData) {
    const [answers, documents, forms, tasks, packageDocuments] = await Promise.all([
      Answer.find({ caseId: caseData._id }).select("status completion submittedAt approvedAt").lean(),
      Document.find({ caseId: caseData._id, deletedAt: { $exists: false } }).select("documentType reviewStatus requestStatus createdAt metadata tags").lean(),
      CaseForm.find({ caseId: caseData._id }).select("status completion reviewState generatedPdfDocument filingPackages updatedAt").lean(),
      Task.find({ caseId: caseData._id }).select("status category tags").lean(),
      Document.find({ caseId: caseData._id, tags: "filing-package", deletedAt: { $exists: false } }).select("_id createdAt").lean(),
    ]);
    const checklistMap = new Map();
    [...(caseData.documentChecklist || []), ...(caseData.checklistItems || [])].forEach((item) => {
      const key = normalizeDocumentKey(item.documentType || item.name);
      if (key && !checklistMap.has(key)) checklistMap.set(key, item);
    });
    const requiredItems = [...checklistMap.values()].filter((item) => item.required !== false);
    const completedChecklist = requiredItems.filter((item) => DOCUMENT_COMPLETE_STATUSES.has(String(item.status || "").toLowerCase()));
    const completedDocumentTypes = new Set(documents.map((document) => normalizeDocumentKey(document.documentType)).filter(Boolean));
    const satisfiedRequirements = requiredItems.filter((item) => {
      const key = normalizeDocumentKey(item.documentType || item.name);
      return DOCUMENT_COMPLETE_STATUSES.has(String(item.status || "").toLowerCase()) || completedDocumentTypes.has(key);
    });
    // Overall questionnaire progress is a rollup across every actively-assigned
    // checklist (not just "did any one of them get submitted") - a case with
    // an Employer + Employee + Business Plan checklist is only "questionnaire
    // complete" once all three are, and the percent reflects how many of them
    // are (falls back to the old any-submitted-answer heuristic for legacy
    // cases with no tracked references yet).
    const activeQuestionnaireReferences = (caseData.questionnaireReferences || []).filter((reference) => reference.active !== false);
    const CHECKLIST_DONE_STATUSES = new Set(["completed", "submitted", "approved"]);
    const profileBasedQuestionnaireComplete = Boolean(
      caseData.caseStructure === "employer_employee"
      && caseData.caseRole === "principal"
      && caseData.employerProfileId
      && caseData.questionnaireData?.lastSubmittedAt
    );
    const questionnaireComplete = profileBasedQuestionnaireComplete || (activeQuestionnaireReferences.length
      ? activeQuestionnaireReferences.every((reference) => CHECKLIST_DONE_STATUSES.has(reference.status))
      : answers.some((answer) => ["submitted", "approved"].includes(answer.status)));
    const questionnaireChecklistPercent = activeQuestionnaireReferences.length
      ? (profileBasedQuestionnaireComplete
        ? 100
        : Math.round((activeQuestionnaireReferences.filter((reference) => CHECKLIST_DONE_STATUSES.has(reference.status)).length / activeQuestionnaireReferences.length) * 100))
      : (questionnaireComplete ? 100 : 0);
    const documentsComplete = requiredItems.length
      ? satisfiedRequirements.length >= requiredItems.length
      : documents.length > 0;
    const reviewedDocuments = documents.filter((document) => ["approved", "accepted"].includes(document.reviewStatus));
    const reviewedDocumentTypes = new Set(reviewedDocuments.map((document) => normalizeDocumentKey(document.documentType)).filter(Boolean));
    const documentsReviewed = documentsComplete && (requiredItems.length
      ? requiredItems.every((item) => reviewedDocumentTypes.has(normalizeDocumentKey(item.documentType || item.name)))
      : reviewedDocuments.length === documents.length);
    const canonicalValidation = caseData.canonicalProfile?.validation || {};
    const canonicalReady = Number(caseData.canonicalProfile?.version || 0) > 0
      && !(canonicalValidation.errors || []).length
      && !(caseData.canonicalProfile?.conflicts || []).filter((conflict) => conflict.status === "pending_review").length;
    const formsGenerated = forms.length > 0 && forms.every((form) => FORM_GENERATED_STATUSES.has(form.status));
    const formsApproved = forms.length > 0 && forms.every((form) => FORM_APPROVED_STATUSES.has(form.status));
    const pdfGenerated = forms.length > 0 && forms.every((form) => Boolean(form.generatedPdfDocument) || ["generated", "filed"].includes(form.status));
    const packageGenerated = packageDocuments.length > 0 || forms.some((form) => form.filingPackages?.length);
    const filed = caseData.status === "filed"
      || caseData.immigrationLifecycle?.filingStatus === "filed"
      || (caseData.immigrationLifecycle?.filings || []).some((filing) => filing.status === "filed");
    return {
      assigned: Boolean(caseData.primaryOwner || caseData.assignedCaseManager),
      questionnaireComplete,
      documentsComplete,
      caseManagerReviewComplete: Boolean(canonicalReady && questionnaireComplete && documentsReviewed),
      formsGenerated,
      formsApproved,
      pdfGenerated,
      packageGenerated,
      filed,
      questionnaire: {
        totalAnswers: answers.length,
        submitted: questionnaireComplete,
        percent: questionnaireChecklistPercent,
        checklists: {
          total: activeQuestionnaireReferences.length,
          completed: activeQuestionnaireReferences.filter((reference) => CHECKLIST_DONE_STATUSES.has(reference.status)).length,
        },
      },
      documents: {
        uploaded: documents.length,
        required: requiredItems.length,
        completed: Math.max(completedChecklist.length, satisfiedRequirements.length),
        pending: Math.max(requiredItems.length - satisfiedRequirements.length, 0),
        reviewed: reviewedDocuments.length,
        reviewComplete: documentsReviewed,
      },
      forms: {
        total: forms.length,
        generated: forms.filter((form) => FORM_GENERATED_STATUSES.has(form.status)).length,
        approved: forms.filter((form) => FORM_APPROVED_STATUSES.has(form.status)).length,
        pdfGenerated: forms.filter((form) => Boolean(form.generatedPdfDocument) || form.status === "generated").length,
      },
      tasks: {
        open: tasks.filter((task) => !["completed", "cancelled"].includes(task.status)).length,
      },
      canonical: {
        version: caseData.canonicalProfile?.version || 0,
        status: caseData.canonicalProfile?.status || "not_built",
        conflicts: (caseData.canonicalProfile?.conflicts || []).filter((conflict) => conflict.status === "pending_review").length,
        errors: (canonicalValidation.errors || []).length,
        completeness: canonicalValidation.completeness || 0,
      },
      packageGenerated,
    };
  }

  static deriveOperationalState(metrics) {
    if (metrics.filed) return { status: "filed", stage: "processing" };
    if (metrics.packageGenerated || metrics.pdfGenerated) return { status: "ready_to_file", stage: "filing" };
    if (metrics.formsGenerated) return { status: "form_preparation", stage: "form_preparation" };
    if (metrics.caseManagerReviewComplete) return { status: "under_review", stage: "legal_review" };
    if (metrics.questionnaireComplete) return { status: "document_collection", stage: "evidence" };
    if (metrics.assigned) return { status: "assigned", stage: "intake" };
    return { status: "pending_assignment", stage: "intake" };
  }

  static async recalculate(caseIdOrRecord, user, req, reason = "workflow_recalculated") {
    // caseIdOrRecord may be a full Mongoose document OR just an id/ObjectId.
    // A bare ObjectId also has a truthy `._id` property (it refers to itself),
    // so that alone can't distinguish the two cases — check for `.save`
    // instead, which only a real Mongoose document has.
    const caseData = typeof caseIdOrRecord?.save === "function" ? caseIdOrRecord : await Case.findById(caseIdOrRecord);
    if (!caseData) throw Object.assign(new Error("Case not found"), { status: 404 });
    if (user && !caseService.canAccessCase(user, caseData)) throw Object.assign(new Error("Not authorized to access this case workflow"), { status: 403 });
    const metrics = await this.metrics(caseData);
    const calculated = this.calculateProgress(metrics);
    const previousMilestones = new Map((caseData.journeyProgress?.milestones || []).map((milestone) => [milestone.key, milestone.completed]));
    const state = this.deriveOperationalState(metrics);
    if (!TERMINAL_STATUSES.has(caseData.status) && caseData.status !== "approved") caseData.status = state.status;
    if (caseData.stage !== state.stage && !TERMINAL_STATUSES.has(caseData.status)) caseService.setStage(caseData, state.stage, user, `Lifecycle synchronized: ${reason}`);
    caseData.filingReadinessScore = calculated.percent;
    caseData.workflow.filingReadinessScore = calculated.percent;
    caseData.workflow.status = caseData.status;
    caseData.journeyProgress = {
      ...calculated,
      metrics,
      lastCalculatedAt: new Date(),
      lastCalculatedBy: this.userId(user),
    };
    calculated.milestones.forEach((milestone) => {
      if (milestone.completed && previousMilestones.get(milestone.key) !== true) {
        caseService.addTimelineEvent(caseData, "milestone", milestone.label, `${milestone.label} completed`, user, { milestone: milestone.key, progress: calculated.percent });
      }
    });
    caseData.lastSyncedAt = new Date();
    caseService.addAuditEntry(caseData, "lifecycle_sync", "Case lifecycle synchronized", user, { reason, progress: calculated.percent, state }, req);
    await caseData.save();
    await caseService.writeAuditLog("lifecycle_sync", caseData, user || { _id: caseData.user }, { reason, progress: calculated.percent, state }, req);
    return { case: caseData, progress: caseData.journeyProgress, metrics };
  }

  static async ensureBeneficiary(caseData, user, req) {
    if (caseData.beneficiary) return caseData.beneficiary;
    const client = caseData.clientProfile
      ? await Client.findById(caseData.clientProfile)
      : caseData.user ? await Client.findOne({ user: caseData.user }) : null;
    let beneficiary;
    if (client) beneficiary = await beneficiaryService.syncFromClient(client, user, req);
    else if (idOf(caseData.user) === idOf(this.userId(user))) beneficiary = await beneficiaryService.getMyBeneficiary(user, req);
    if (beneficiary) {
      caseData.beneficiary = beneficiary._id;
      caseData.clientProfile = caseData.clientProfile || beneficiary.client;
      await caseService.hydrateCaseRelationships(caseData, user, req);
      caseService.addTimelineEvent(caseData, "beneficiary", "Beneficiary Linked", "Beneficiary profile linked to the case", user, { beneficiaryId: beneficiary._id });
    }
    return beneficiary?._id;
  }

  static async ensureQuestionnaire(caseData, user, req) {
    if ((caseData.questionnaireReferences || []).some((reference) => reference.active !== false && reference.status !== "returned")) return caseData.questionnaireReferences[0];
    const questionnaireService = require("../questionnaires/questionnaire.service");
    try {
      const state = await questionnaireService.getQuestionnaireForCase(caseData._id, user);
      const assigned = await questionnaireService.assignQuestionnaire(state.questionnaire, {
        caseId: caseData._id,
        assignedTo: caseData.user,
        message: `Complete your ${caseData.visaType} immigration questionnaire.`,
      }, user, req);
      return assigned.case.questionnaireReferences[assigned.case.questionnaireReferences.length - 1];
    } catch (error) {
      if (error.status !== 404) throw error;
      caseService.addTimelineEvent(caseData, "questionnaire", "Questionnaire Configuration Required", `No active questionnaire is configured for ${caseData.visaType}`, user, { visaType: caseData.visaType });
      return null;
    }
  }

  static async initializeCase(caseData, user, req) {
    await this.ensureBeneficiary(caseData, user, req);
    await caseData.save();
    let knowledge = null;
    try {
      knowledge = await require("./immigration-knowledge-engine.service").orchestrate(caseData._id, user, req, {
        reason: "case_initialized",
      });
    } catch (error) {
      const current = await Case.findById(caseData._id);
      if (current) {
        current.knowledgePlan = {
          ...(current.knowledgePlan?.toObject?.() || current.knowledgePlan || {}),
          status: "error",
          configurationIssues: [{ type: "orchestration", message: error.message }],
          generatedAt: new Date(),
          generatedBy: this.userId(user),
        };
        caseService.addAuditEntry(current, "immigration_knowledge_orchestration_failed", "Immigration orchestration failed without rolling back case creation", user, { error: error.message }, req);
        await current.save();
      }
    }
    await this.provisionRequiredForms(caseData, user, req);
    const result = await this.recalculate(caseData._id, user, req, "case_initialized");
    await this.notifyCaseCreated(caseData, result, user, req);
    return { ...result, knowledgePlan: knowledge?.knowledgePlan || result.case?.knowledgePlan };
  }

  // Phase 13 - CaseForms belong to the case, not the questionnaire. As soon
  // as a case's required form set is determinable (its visaType/petitionType/
  // plan are known - true immediately at creation, before any client,
  // questionnaire, or document ever exists), the actual filing case(s)
  // should already have their USCIS forms assigned, so a case manager can
  // open and edit the real form right away. For an employer_employee/family
  // case structure, the principal is a container record (company/petitioner
  // info) - the real filing case per beneficiary is each child case, exactly
  // like every other caller of ensureAssignedForms in this codebase
  // (generateForms, listCaseForms) already treats it. For a "single"
  // structure, caseData itself is the only, and therefore the filing, case.
  // Reuses the existing, already-idempotent ensureAssignedForms() -
  // deliberately not a second/parallel provisioning implementation - and
  // never throws: a template-configuration problem must not block case
  // creation or assignment, exactly like the knowledge-engine orchestration
  // above it, which follows the same catch-and-record-not-rethrow pattern.
  static async provisionRequiredForms(caseData, user, req) {
    const uscisFormService = require("../uscis-forms/uscis-form.service");
    const logger = require("../../utils/logger");
    const targets = caseData.childCases?.length
      ? await Case.find({ _id: { $in: caseData.childCases } })
      : [caseData];
    for (const target of targets) {
      try {
        await uscisFormService.ensureAssignedForms(target, user, req);
      } catch (error) {
        logger.error("uscis_form_provisioning_failed", { caseId: String(target._id), error: error.message });
      }
    }
  }

  // Fires the "case created" notifications required immediately after a case
  // is opened: a notification (+ email) to the client, a notification
  // (+ email) to the Team Lead responsible for assignment, and a realtime
  // push so the Team Lead dashboard's "New Cases Queue" updates without a
  // page refresh. All email dispatch is delegated to notificationService —
  // this method never talks to EmailService directly.
  static async notifyCaseCreated(caseData, result, user, req) {
    const caseNumber = caseData.caseNumber || caseData.caseId;
    const clientEmail = caseData.clientEmail || user?.email;
    if (caseData.user || clientEmail) {
      await notificationService.createNotification({
        userId: caseData.user,
        type: "case_created",
        category: "case",
        title: "Your Immigration Case Has Been Created",
        message: `${caseNumber} · ${caseData.visaType}`,
        caseId: caseData._id,
        link: "/dashboard",
        priority: "medium",
        source: caseData.legacySource === "BAIS" ? "BAIS" : "shared",
        emailTemplate: "case-created-client",
        emailTo: clientEmail,
        emailData: { clientName: caseData.clientName, caseNumber },
      }, user, req).catch(() => null);
    }

    if (caseData.assignedTeamLead) {
      const teamLead = await User.findById(caseData.assignedTeamLead).select("name displayName email").catch(() => null);
      await notificationService.createNotification({
        userId: caseData.assignedTeamLead,
        type: "team_case_created",
        category: "case",
        title: "New Case Awaiting Assignment",
        message: `${caseNumber} · ${caseData.clientName || "Client"} · ${caseData.visaType}`,
        caseId: caseData._id,
        link: `/crm-cases/${caseData._id}?assign=case_manager`,
        priority: caseData.priority === "urgent" ? "urgent" : "high",
        source: "shared",
        metadata: { visaType: caseData.visaType, companyId: caseData.companyId, package: caseData.package, progress: result.progress.percent },
        emailTemplate: "case-created-team-lead",
        emailTo: teamLead?.email,
        emailData: { teamLeadName: teamLead?.name || teamLead?.displayName, caseNumber, clientName: caseData.clientName },
      }, user, req).catch(() => null);

      const caseSummary = {
        _id: caseData._id,
        caseNumber: caseData.caseNumber,
        clientName: caseData.clientName,
        clientEmail: caseData.clientEmail,
        visaType: caseData.visaType,
        package: caseData.package,
        plan: caseData.plan,
        priority: caseData.priority,
        status: caseData.status,
        createdAt: caseData.createdAt,
      };
      realtimeGateway.emitToUser(caseData.assignedTeamLead, "case:created", caseSummary);
      realtimeGateway.emitToRole("team_lead", "case:created", caseSummary);
    }
  }

  static async onAssignment(caseData, user, req) {
    // Note: the in-app notification, email, and realtime push for the newly
    // assigned case manager are handled by case.controller.js's
    // notifyAssignee(), which always runs immediately before onAssignment()
    // is called. Keeping that as the single source of truth avoids sending
    // duplicate "case assigned" notifications for the same event.
    // Recovery/safety-net provisioning: normally a no-op, since
    // initializeCase() already provisioned this case's forms at creation -
    // this only does real work for a case created before that existed, or if
    // a template newly applies to this case (e.g. assignmentRules changed)
    // since then. caseData can be EITHER the principal (assignment cascades
    // to its children, see case.controller.js's cascadeAssignmentToChildren)
    // or a child assigned directly (assignmentOverridden) - reuses the same
    // provisionRequiredForms() helper as initializeCase so both shapes
    // resolve to the correct filing case(s), never the principal itself for
    // an employer_employee/family case.
    await this.provisionRequiredForms(caseData, user, req);
    const result = await this.recalculate(caseData._id, user, req, "case_assigned");
    return result;
  }

  static async generateForms(caseId, user, req) {
    const startedAt = Date.now();
    let caseData;
    let primaryReadError = null;
    try {
      caseData = await Case.findById(caseId).maxTimeMS(Number(process.env.GENERATE_FORMS_CASE_READ_TIMEOUT_MS || 5000));
    } catch (error) {
      primaryReadError = error;
      if (!isDatabaseUnavailableError(error)) throw error;
      caseData = await Case.findById(caseId).read("secondaryPreferred");
    }
    if (!caseData) throw Object.assign(new Error("Case not found"), { status: 404 });
    if (!caseService.canAccessCase(user, caseData)) throw Object.assign(new Error("Not authorized to generate forms for this case"), { status: 403 });
    if (!caseData.assignedCaseManager && !["super_admin", "admin"].includes(user?.role)) throw Object.assign(new Error("Assign a primary case manager before generating forms"), { status: 409 });
    const CanonicalProfileService = require("../canonical/services/CanonicalProfileService");
    const uscisFormService = require("../uscis-forms/uscis-form.service");
    const AutoFillService = require("../form-mapping/services/AutoFillService");
    const existingForms = await CaseForm.find({ caseId })
      .populate({ path: "formTemplateId", select: "_id formCode version status activeFlag" })
      .read("secondaryPreferred");
    const usableExistingForms = existingForms.filter((form) => form.formTemplateId && form.status !== "archived");
    // CaseForms are provisioned as soon as the case's required form set is
    // determinable (case creation / assignment - see
    // CaseLifecycleOrchestrator.provisionRequiredForms), not by this
    // endpoint. This is exclusively the autofill step now: ensure any
    // still-missing form (e.g. a newly-conditional one) exists, then
    // populate every form from whatever canonical data currently exists.
    // Deliberately not gated on questionnaire/document completion anymore -
    // AutoFillService leaves any field with no resolvable value untouched
    // (missingFields) and never overwrites a manually-reviewed/overridden
    // field, so running this against a partially-answered case is always
    // safe to repeat once more data arrives. A degraded primary is only
    // fatal here when there are no usable forms already available to fall
    // back to acting on.
    if (!usableExistingForms.length && primaryReadError) throw primaryReadError;
    const readiness = await this.metrics(caseData);
    const blockingIssues = [];
    const canonical = await CanonicalProfileService.validate(caseId, user, req, { reason: "generate_uscis_forms" });
    // hasCanonicalErrors (missing-required-field validation errors from
    // CanonicalSectionValidators) is a completeness measure - exactly what
    // this endpoint must no longer gate on now that it can run long before
    // the questionnaire is finished. hasUnresolvedConflicts is a different,
    // narrower thing - multiple sources actively disagreeing on the same
    // field's value (canonicalProfile.conflicts, pending_review) - and stays
    // blocking: autofilling a form from a value known to conflict with
    // another source would write bad data into it, unlike simply leaving a
    // not-yet-answered field blank (which AutoFillService already handles
    // safely via missingFields).
    const hasUnresolvedConflicts = readiness.canonical.conflicts > 0;
    const hasCanonicalErrors = Array.isArray(canonical.errors) && canonical.errors.length > 0 && readiness.canonical.version > 0;
    if (hasCanonicalErrors) blockingIssues.push({ code: "CANONICAL_INCOMPLETE", message: "The canonical profile is still missing required fields.", validation: canonical });
    if (hasUnresolvedConflicts) {
      blockingIssues.push({ code: "CANONICAL_NEEDS_REVIEW", message: "Resolve canonical profile conflicts before filing.", validation: canonical });
      throw Object.assign(new Error("Resolve canonical profile conflicts before filing."), { status: 422, code: "CANONICAL_NEEDS_REVIEW", details: { readiness, validation: canonical, blockingIssues } });
    }
    const created = await uscisFormService.ensureAssignedForms(caseData, user, req);
    const forms = await CaseForm.find({ caseId });
    if (!forms.length) throw Object.assign(new Error(`No active USCIS form templates are configured for ${caseData.visaType}`), { status: 422 });
    const generated = [];
    const failed = [];
    for (const form of forms) {
      try {
        generated.push(await AutoFillService.generate(caseId, form.formCode, user, req, { regenerate: form.versionNumber > 0 }));
      } catch (error) {
        failed.push({
          caseFormId: form._id,
          formCode: form.formCode,
          message: error.message,
          code: error.code,
          status: error.status || error.statusCode,
        });
      }
    }
    caseService.addTimelineEvent(caseData, "uscis_form", "USCIS Forms Generated", `${generated.length} USCIS form${generated.length === 1 ? "" : "s"} auto-filled from the canonical profile`, user, {
      caseFormIds: generated.map((item) => item.caseForm._id),
      canonicalReadiness: canonical.status,
      failedForms: failed,
      blockingIssues,
    });
    await caseData.save();
    const workflow = await this.recalculate(caseId, user, req, "uscis_forms_generated");
    require("../../utils/logger").info("uscis_form_generation_completed", {
      caseId,
      createdCount: created.length,
      generatedCount: generated.length,
      failedCount: failed.length,
      durationMs: Date.now() - startedAt,
      requestId: req?.requestId,
    });
    return {
      created,
      existing: usableExistingForms,
      generated,
      failed,
      blockingIssues,
      canonicalValidation: canonical,
      readiness,
      workflow,
      message: failed.length
        ? `${generated.length} USCIS form(s) auto-filled; ${failed.length} form(s) need attention.`
        : "USCIS forms assigned and auto-filled from the canonical profile.",
    };
  }

  static async generatePackage(caseId, user, req, payload = {}) {
    const caseData = await Case.findById(caseId);
    if (!caseData) throw Object.assign(new Error("Case not found"), { status: 404 });
    if (!caseService.canAccessCase(user, caseData)) throw Object.assign(new Error("Not authorized to generate a filing package for this case"), { status: 403 });
    const forms = await CaseForm.find({ caseId });
    if (!forms.length || forms.some((form) => !form.generatedPdfDocument)) {
      throw Object.assign(new Error("Generate the approved USCIS PDFs before assembling the filing package"), { status: 409 });
    }
    const FilingPackageService = require("../form-generation/services/FilingPackageService");
    const packageResult = await FilingPackageService.assemble({
      caseId,
      packageType: payload.packageType || "uscis_filing_package",
      metadata: {
        title: payload.title || `${caseData.caseNumber} USCIS Filing Package`,
        description: payload.description || `${caseData.visaType} filing package`,
      },
      watermark: payload.watermark,
      items: payload.items || [],
    }, user, req);
    caseService.addTimelineEvent(caseData, "filing_package", "Filing Package Generated", "USCIS forms and supporting evidence were assembled into a filing package", user, { documentId: packageResult.document._id });
    await caseData.save();
    const workflow = await this.recalculate(caseId, user, req, "filing_package_generated");
    return { ...packageResult, workflow };
  }

  static async get(caseId, user, req) {
    const result = await this.recalculate(caseId, user, req, "workflow_requested");
    return {
      case: {
        _id: result.case._id,
        caseNumber: result.case.caseNumber,
        status: result.case.status,
        stage: result.case.stage,
        visaType: result.case.visaType,
        clientName: result.case.clientName,
        assignedCaseManager: result.case.assignedCaseManager,
        assignedTeamLead: result.case.assignedTeamLead,
      },
      progress: result.progress,
      metrics: result.metrics,
      timeline: (result.case.timeline || []).slice().sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt)),
    };
  }
}

module.exports = CaseLifecycleOrchestrator;
