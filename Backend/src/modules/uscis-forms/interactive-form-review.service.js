const AuditLog = require("../../models/AuditLog");
const Case = require("../../models/Case");
const CaseForm = require("../../models/CaseForm");
const Document = require("../../models/Document");
const Task = require("../../models/Task");
const { normalizeRole } = require("../authorization/roleHierarchy");
const caseService = require("../cases/case.service");
const TaskManagementService = require("../case-collaboration/services/TaskManagementService");
const AutoFillService = require("../form-mapping/services/AutoFillService");
const FormMappingService = require("../form-mapping/services/FormMappingService");
const MappingResolver = require("../form-mapping/services/MappingResolver");
const CanonicalProfileService = require("../canonical/services/CanonicalProfileService");
const notificationService = require("../notifications/notification.service");
const uscisFormService = require("./uscis-form.service");

const EDIT_ROLES = new Set(["super_admin", "admin", "case_manager"]);
const REVIEW_ROLES = new Set(["super_admin", "admin", "team_lead", "case_manager"]);
const APPROVE_ROLES = new Set(["super_admin", "admin", "team_lead"]);
const UNLOCK_ROLES = new Set(["super_admin", "admin", "team_lead"]);

function clone(value, fallback = {}) {
  if (value === undefined || value === null) return fallback;
  return JSON.parse(JSON.stringify(value));
}

function idOf(value) {
  return value?._id?.toString?.() || value?.toString?.();
}

function sameId(left, right) {
  return idOf(left) && idOf(left) === idOf(right);
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0);
}

function flatten(value, prefix = "", output = {}) {
  if (value === null || value === undefined || typeof value !== "object" || value instanceof Date) {
    if (prefix) output[prefix] = value;
    return output;
  }
  if (Array.isArray(value)) {
    if (prefix) output[prefix] = value;
    return output;
  }
  Object.entries(value).forEach(([key, item]) => flatten(item, prefix ? `${prefix}.${key}` : key, output));
  return output;
}

function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function error(message, statusCode = 400, details) {
  return Object.assign(new Error(message), { statusCode, status: statusCode, details });
}

class InteractiveFormReviewService {
  static role(user) {
    return normalizeRole(user?.role);
  }

  static userId(user) {
    return user?._id || user?.id || user;
  }

  static permissions(user) {
    const role = this.role(user);
    return {
      role,
      mode: role === "case_manager" ? "case_manager" : role === "team_lead" ? "team_lead" : ["admin", "super_admin"].includes(role) ? "admin" : "read_only",
      canEdit: EDIT_ROLES.has(role),
      canReview: REVIEW_ROLES.has(role),
      canApprove: APPROVE_ROLES.has(role),
      canLock: APPROVE_ROLES.has(role),
      canUnlock: UNLOCK_ROLES.has(role),
      canComment: REVIEW_ROLES.has(role),
      canCreateTask: REVIEW_ROLES.has(role),
      readOnly: !EDIT_ROLES.has(role),
    };
  }

  static async audit(action, caseForm, user, req, changes = {}) {
    await AuditLog.create({
      userId: this.userId(user),
      userRole: user?.role,
      action,
      entityType: "case_form",
      entityId: idOf(caseForm),
      changes,
      ipAddress: req?.ip,
      userAgent: req?.headers?.["user-agent"],
      description: `${action} ${caseForm.formCode}`,
    }).catch(() => null);
  }

  static addAudit(caseForm, action, user, req, changes = {}) {
    caseForm.auditHistory.push({
      action,
      changes,
      performedBy: this.userId(user),
      performedAt: new Date(),
      ipAddress: req?.ip,
      userAgent: req?.headers?.["user-agent"],
    });
  }

  static async load(caseId, caseFormId, user) {
    const caseData = await Case.findById(caseId)
      .populate("user", "firstName lastName name email")
      .populate("clientProfile", "firstName lastName fullName email user")
      .populate("beneficiary", "firstName middleName lastName email")
      .populate("companyId", "name legalName")
      .populate("assignedCaseManager", "firstName lastName name email")
      .populate("assignedTeamLead", "firstName lastName name email");
    if (!caseData) throw error("Case not found", 404);
    if (!caseService.canAccessCase(user, caseData)) throw error("Not authorized to access this form", 403);
    const caseForm = await CaseForm.findOne({ _id: caseFormId, caseId }).populate("formTemplateId");
    if (!caseForm) throw error("Case form not found", 404);
    let template = caseForm.formTemplateId.toObject();
    const lockedMapping = await FormMappingService.loadMappingVersion(
      template,
      caseForm.formVersionLock?.mappingVersionId || caseForm.mappingVersionId,
    );
    template = FormMappingService.applyMappingGraph(template, lockedMapping);
    return { caseData, caseForm, template };
  }

  static assertEditable(caseForm, user) {
    const permissions = this.permissions(user);
    if (!permissions.canEdit) throw error("This review mode is read only", 403);
    if (caseForm.isLocked || caseForm.status === "locked" || caseForm.status === "filed") throw error("This form is locked and cannot be edited", 409);
    return permissions;
  }

  static async notifyCaseTeam(caseData, caseForm, user, req, event, title, message, options = {}) {
    const recipients = [
      caseData.assignedCaseManager,
      caseData.assignedTeamLead,
    ].map(idOf).filter(Boolean);
    const actorId = idOf(this.userId(user));
    const uniqueRecipients = [...new Set(recipients)].filter((recipient) => recipient !== actorId);
    await Promise.all(uniqueRecipients.map((userId) => notificationService.createNotification({
      userId,
      type: "general",
      category: "case",
      title,
      message,
      priority: options.priority || "medium",
      caseId: caseData._id,
      link: `/crm-cases/${caseData._id}?tab=forms&formId=${caseForm._id}`,
      internalOnly: true,
      clientVisible: false,
      source: "shared",
      channels: ["in_app", "socket"],
      eventName: event,
      eventId: `${caseForm._id}:${event}:${Date.now()}`,
      dedupeKey: options.dedupeKey,
      metadata: { caseFormId: caseForm._id, formCode: caseForm.formCode, ...options.metadata },
    }, user, req).catch(() => null)));
  }

  static fieldDefinition(template, fieldName) {
    return (template.formFields || []).find((field) => [field.fieldName, field.fieldId, field.name, field.key].filter(Boolean).includes(fieldName));
  }

  static sectionFieldNames(template, sectionKey) {
    return uscisFormService.buildSections(template).find((section) => section.key === sectionKey || section.sectionId === sectionKey)?.fields?.map((field) => field.fieldName) || [];
  }

  static updateProgress(caseForm, template) {
    const progress = uscisFormService.calculateCompletion(template, caseForm.fieldValues || caseForm.filledData || {});
    caseForm.completion = progress.completion;
    caseForm.sectionProgress = progress.sectionProgress;
    caseForm.validationErrors = {
      ...(caseForm.validationErrors || {}),
      fields: progress.validationErrors,
    };
    return progress;
  }

  static pushFieldHistory(caseForm, payload, user) {
    caseForm.fieldHistory.push({
      fieldName: payload.fieldName,
      sectionKey: payload.sectionKey,
      action: payload.action,
      previousValue: clone(payload.previousValue, payload.previousValue),
      newValue: clone(payload.newValue, payload.newValue),
      reason: payload.reason,
      source: payload.source,
      changedBy: this.userId(user),
      changedAt: new Date(),
      metadata: payload.metadata,
    });
    if (caseForm.fieldHistory.length > 5000) caseForm.fieldHistory = caseForm.fieldHistory.slice(-5000);
  }

  static reviewModeStatus(user) {
    return "in_progress";
  }

  static touchReview(caseForm, user) {
    const permissions = this.permissions(user);
    caseForm.reviewState = {
      ...(caseForm.reviewState?.toObject?.() || caseForm.reviewState || {}),
      mode: permissions.mode,
      status: caseForm.reviewState?.status === "not_started" ? this.reviewModeStatus(user) : caseForm.reviewState?.status || this.reviewModeStatus(user),
      startedBy: caseForm.reviewState?.startedBy || this.userId(user),
      startedAt: caseForm.reviewState?.startedAt || new Date(),
      lastActivityBy: this.userId(user),
      lastActivityAt: new Date(),
    };
  }

  static sourceDocumentsForField(fieldName, attribution, documents) {
    const ids = [attribution?.sourceDocumentId, attribution?.documentId].filter(Boolean).map(String);
    return documents.filter((document) => ids.includes(String(document._id)) || (document.tags || []).includes(fieldName));
  }

  static buildFieldView(field, caseForm, canonicalState, documents) {
    const fieldName = field.fieldName;
    const attribution = caseForm.sourceAttribution?.[fieldName] || MappingResolver.resolvePath(caseForm.sourceAttribution || {}, fieldName) || {};
    const sourcePath = attribution.sourceField || field.mapping?.source || field.mapping?.canonicalField || field.mappings?.[0]?.path;
    const canonicalValue = sourcePath ? MappingResolver.resolvePath(canonicalState?.profile || {}, String(sourcePath).replace(/^canonical\./, "")) : undefined;
    const history = (caseForm.fieldHistory || []).filter((entry) => entry.fieldName === fieldName).slice(-25).reverse();
    const conflicts = (canonicalState?.conflicts || []).filter((conflict) => [conflict.path, conflict.field, conflict.fieldName].includes(sourcePath) || [conflict.path, conflict.field, conflict.fieldName].includes(fieldName));
    return {
      ...field,
      value: MappingResolver.resolvePath(caseForm.fieldValues || caseForm.filledData || {}, fieldName),
      canonicalValue,
      source: attribution.source || attribution.canonicalSource || "Unmapped",
      sourceField: sourcePath,
      confidence: attribution.confidence ?? attribution.confidenceScore,
      verificationStatus: caseForm.fieldReviews?.[fieldName]?.status || attribution.verificationStatus || attribution.validationStatus || "unreviewed",
      lastUpdated: attribution.populationTimestamp || attribution.populatedAt || attribution.generatedAt || caseForm.lastModifiedAt,
      mapping: field.mapping || field.mappings || attribution.mappingUsed,
      manualOverride: caseForm.manualOverrides?.[fieldName],
      review: caseForm.fieldReviews?.[fieldName],
      history,
      conflicts,
      documents: this.sourceDocumentsForField(fieldName, attribution, documents),
    };
  }

  static async open(caseId, caseFormId, user, req, options = {}) {
    const rendered = await uscisFormService.renderCaseForm(caseId, caseFormId, user, req, { caseFormOnly: false });
    const { caseData, caseForm, template } = await this.load(caseId, caseFormId, user);
    const [canonicalState, documents, tasks] = await Promise.all([
      CanonicalProfileService.get(caseId, user, req),
      Document.find({ caseId }).select("_id originalName fileName documentType category documentUrl filePath reviewStatus extractionConfidence tags").lean(),
      Task.find({ caseId, tags: `case-form:${caseFormId}` }).populate("assignedTo", "firstName lastName name email").sort({ createdAt: -1 }).lean(),
    ]);
    const permissions = this.permissions(user);
    const canonicalVersion = Number(canonicalState.version || 0);
    const syncedVersion = Number(caseForm.syncState?.canonicalVersion || 0);
    const becameStale = canonicalVersion > syncedVersion && !caseForm.syncState?.stale;
    if (canonicalVersion > syncedVersion) {
      caseForm.syncState = {
        ...(caseForm.syncState?.toObject?.() || caseForm.syncState || {}),
        canonicalVersion: syncedVersion,
        stale: true,
      };
    }
    if (permissions.canReview && options.track !== false) {
      const wasNotStarted = !caseForm.reviewState?.startedAt;
      this.touchReview(caseForm, user);
      if (["pending", "draft", "ai_filled"].includes(caseForm.status)) caseForm.status = "in_review";
      this.addAudit(caseForm, "REVIEW_OPENED", user, req, { mode: permissions.mode });
      await caseForm.save();
      if (wasNotStarted) {
        await this.audit("REVIEW_STARTED", caseForm, user, req, { mode: permissions.mode });
        await this.notifyCaseTeam(caseData, caseForm, user, req, "form.review_started", "USCIS Form Review Started", `${caseForm.formCode} review has started.`);
      }
      if (becameStale) {
        await this.notifyCaseTeam(caseData, caseForm, user, req, "form.canonical_update_available", "USCIS Form Data Update Available", `${caseForm.formCode} has newer canonical profile data available. Manual overrides remain protected.`, {
          priority: "high",
          dedupeKey: `case-form:${caseForm._id}:canonical:${canonicalVersion}`,
          metadata: { canonicalVersion, syncedVersion },
        });
      }
    }
    const sections = rendered.template.sections.map((section) => ({
      ...section,
      review: caseForm.sectionReviews?.[section.key] || { status: "not_started" },
      fields: section.fields.map((field) => this.buildFieldView(field, caseForm, canonicalState, documents)),
    }));
    // template.layout (a field that doesn't exist on USCISFormTemplate's own
    // schema - it's `formLayout`) was always undefined here; Task 2's page
    // rendering needs the real per-page pixel dimensions
    // (formLayout.pages[].width/height, in PDF points) to scale the
    // rasterized page image and its field overlays correctly, so this now
    // reads the real field instead of silently sending nothing.
    const pageDimensions = (template.formLayout?.pages || template.formStructure?.pages || [])
      .map((page) => ({ pageNumber: page.pageNumber, width: page.width, height: page.height, rotation: page.rotation || 0 }));
    return {
      ...rendered,
      caseForm,
      template: { ...rendered.template, layout: template.formLayout || {}, pageDimensions, structure: template.formStructure || template.structure, sections },
      caseSummary: {
        _id: caseData._id,
        caseNumber: caseData.caseNumber || caseData.caseId,
        visaType: caseData.visaType,
        beneficiary: caseData.beneficiary,
        petitioner: caseData.companyId,
        clientName: caseData.clientName,
      },
      canonical: {
        version: canonicalState.version,
        status: canonicalState.status,
        validation: canonicalState.validation,
        conflicts: canonicalState.conflicts || [],
        missingFields: canonicalState.missingFields || [],
      },
      permissions,
      comments: (caseForm.comments || []).filter((comment) => permissions.canReview || !comment.internalOnly),
      tasks,
      documents,
    };
  }

  static async saveField(caseId, caseFormId, payload, user, req) {
    const { caseData, caseForm, template } = await this.load(caseId, caseFormId, user);
    this.assertEditable(caseForm, user);
    const fieldName = payload.fieldName || payload.fieldId;
    if (!fieldName || !this.fieldDefinition(template, fieldName)) throw error("Unknown USCIS form field", 400);
    const previousValue = MappingResolver.resolvePath(caseForm.fieldValues || caseForm.filledData || {}, fieldName);
    if (valuesEqual(previousValue, payload.value)) return caseForm;
    await AutoFillService.overrideField(caseId, caseForm.formCode, fieldName, payload.value, user, req, payload.reason || "Interactive form review");
    const updated = await CaseForm.findById(caseFormId).populate("formTemplateId");
    updated.status = "under_review";
    updated.lastModifiedBy = this.userId(user);
    updated.lastModifiedAt = new Date();
    this.touchReview(updated, user);
    this.pushFieldHistory(updated, {
      fieldName,
      sectionKey: payload.sectionKey,
      action: "manual_override",
      previousValue,
      newValue: payload.value,
      reason: payload.reason,
      source: "ManualOverride",
    }, user);
    this.updateProgress(updated, updated.formTemplateId);
    this.addAudit(updated, "FIELD_EDITED", user, req, { fieldName, previousValue, value: payload.value, reason: payload.reason });
    await updated.save();
    await this.audit("FIELD_EDITED", updated, user, req, { fieldName, previousValue, value: payload.value, reason: payload.reason });
    await this.notifyCaseTeam(caseData, updated, user, req, "form.field_updated", "USCIS Form Field Updated", `${fieldName} was updated in ${updated.formCode}.`, { metadata: { fieldName } });
    return updated;
  }

  static async saveSection(caseId, caseFormId, payload, user, req) {
    const { caseForm, template } = await this.load(caseId, caseFormId, user);
    this.assertEditable(caseForm, user);
    const allowedFields = new Set(this.sectionFieldNames(template, payload.sectionKey));
    const values = payload.fieldValues || {};
    const changed = [];
    for (const [fieldName, value] of Object.entries(values)) {
      if (!allowedFields.has(fieldName)) continue;
      const previousValue = MappingResolver.resolvePath(caseForm.fieldValues || caseForm.filledData || {}, fieldName);
      if (valuesEqual(previousValue, value)) continue;
      changed.push({ fieldName, previousValue, value });
      MappingResolver.setPath(caseForm.fieldValues, fieldName, value);
      MappingResolver.setPath(caseForm.filledData, fieldName, value);
      caseForm.sourceAttribution = caseForm.sourceAttribution || {};
      caseForm.sourceAttribution[fieldName] = {
        value,
        source: "ManualOverride",
        sourceField: fieldName,
        confidence: 100,
        verificationStatus: "manual_override",
        populatedAt: new Date(),
      };
      caseForm.manualOverrides = caseForm.manualOverrides || {};
      caseForm.manualOverrides[fieldName] = { previousValue, value, reason: payload.reason || "Section review", overriddenBy: this.userId(user), overriddenAt: new Date() };
      this.pushFieldHistory(caseForm, { fieldName, sectionKey: payload.sectionKey, action: "manual_override", previousValue, newValue: value, reason: payload.reason, source: caseForm.sourceAttribution[fieldName].source }, user);
    }
    caseForm.markModified("fieldValues");
    caseForm.markModified("filledData");
    caseForm.markModified("sourceAttribution");
    caseForm.markModified("manualOverrides");
    caseForm.status = "under_review";
    this.touchReview(caseForm, user);
    this.updateProgress(caseForm, template);
    this.addAudit(caseForm, "SECTION_SAVED", user, req, { sectionKey: payload.sectionKey, fields: changed.map((item) => item.fieldName) });
    await caseForm.save();
    await this.audit("SECTION_SAVED", caseForm, user, req, { sectionKey: payload.sectionKey, fields: changed.map((item) => item.fieldName) });
    return caseForm;
  }

  static async reviewField(caseId, caseFormId, payload, user, req) {
    const { caseForm } = await this.load(caseId, caseFormId, user);
    if (!this.permissions(user).canReview) throw error("Not authorized to review fields", 403);
    if (caseForm.isLocked) throw error("This form is locked", 409);
    const fieldName = payload.fieldName || payload.fieldId;
    const status = payload.status;
    if (!["approved", "rejected", "needs_review", "verified"].includes(status)) throw error("Invalid field review status", 400);
    const updated = await AutoFillService.reviewField(caseId, caseForm.formCode, fieldName, status, payload.comment, user, req);
    updated.sourceAttribution = updated.sourceAttribution || {};
    updated.sourceAttribution[fieldName] = {
      ...(updated.sourceAttribution[fieldName] || {}),
      verificationStatus: status,
      verifiedBy: this.userId(user),
      verificationDate: new Date(),
    };
    this.touchReview(updated, user);
    this.pushFieldHistory(updated, { fieldName, sectionKey: payload.sectionKey, action: `review_${status}`, previousValue: null, newValue: MappingResolver.resolvePath(updated.fieldValues || {}, fieldName), reason: payload.comment, source: "Review" }, user);
    updated.markModified("sourceAttribution");
    await updated.save();
    return updated;
  }

  static async reviewSection(caseId, caseFormId, payload, user, req) {
    const { caseData, caseForm, template } = await this.load(caseId, caseFormId, user);
    if (!this.permissions(user).canReview) throw error("Not authorized to review sections", 403);
    if (caseForm.isLocked) throw error("This form is locked", 409);
    if (!["in_progress", "needs_revision", "approved", "rejected", "complete"].includes(payload.status)) throw error("Invalid section review status", 400);
    if (!this.sectionFieldNames(template, payload.sectionKey).length) throw error("Unknown form section", 400);
    const sectionReviews = clone(caseForm.sectionReviews);
    sectionReviews[payload.sectionKey] = {
      status: payload.status,
      comment: payload.comment,
      reviewedBy: this.userId(user),
      reviewedAt: new Date(),
    };
    caseForm.sectionReviews = sectionReviews;
    if (payload.comment) caseForm.comments.push({ scope: "section", sectionKey: payload.sectionKey, comment: payload.comment, internalOnly: true, createdBy: this.userId(user) });
    this.touchReview(caseForm, user);
    this.addAudit(caseForm, payload.status === "approved" || payload.status === "complete" ? "SECTION_APPROVED" : "SECTION_REVIEWED", user, req, payload);
    await caseForm.save();
    await this.audit("SECTION_REVIEWED", caseForm, user, req, payload);
    if (["needs_revision", "rejected"].includes(payload.status)) await this.notifyCaseTeam(caseData, caseForm, user, req, "form.changes_requested", "USCIS Form Changes Requested", `Changes were requested for ${caseForm.formCode} ${payload.sectionKey}.`, { priority: "high" });
    return caseForm;
  }

  static async formDecision(caseId, caseFormId, payload, user, req) {
    const { caseData, caseForm, template } = await this.load(caseId, caseFormId, user);
    const permissions = this.permissions(user);
    if (!permissions.canApprove) throw error("Attorney or administrator approval is required", 403);
    const action = payload.action;
    if (!["approve", "reject", "request_changes", "return_to_case_manager"].includes(action)) throw error("Invalid form review action", 400);
    const progress = this.updateProgress(caseForm, template);
    const canonicalValidation = action === "approve" ? await CanonicalProfileService.validate(caseId, user, req, { reason: "uscis_form_approval" }) : null;
    if (action === "approve" && Object.keys(progress.validationErrors).length) throw error("Resolve all blocking validation errors before approval", 422, progress.validationErrors);
    if (action === "approve" && progress.completion.missingRequiredFields > 0) throw error("Required USCIS fields are missing", 422, progress.completion);
    if (action === "approve" && canonicalValidation?.errors?.length) throw error("Canonical profile has blocking validation errors", 422, canonicalValidation.errors);
    const now = new Date();
    caseForm.reviewState = caseForm.reviewState?.toObject?.() || caseForm.reviewState || {};
    if (action === "approve") {
      caseForm.status = payload.readyForPdf === false ? "approved" : "ready_for_pdf";
      caseForm.approvedBy = this.userId(user);
      caseForm.approvalDate = now;
      caseForm.reviewState.status = payload.readyForPdf === false ? "approved" : "ready_for_pdf";
      caseForm.reviewState.completedBy = this.userId(user);
      caseForm.reviewState.completedAt = now;
      caseForm.reviewState.electronicApproval = {
        approvedBy: this.userId(user),
        approvedAt: now,
        statement: payload.approvalStatement || "I reviewed and approve this USCIS form for PDF generation.",
        ipAddress: req?.ip,
        userAgent: req?.headers?.["user-agent"],
      };
    } else {
      caseForm.status = action === "reject" ? "rejected" : "needs_revision";
      caseForm.reviewState.status = action === "reject" ? "rejected" : "needs_revision";
      caseForm.reviewState.requestedChanges = [...(caseForm.reviewState.requestedChanges || []), {
        action,
        reason: payload.reason,
        requestedBy: this.userId(user),
        requestedAt: now,
      }];
    }
    caseForm.reviewComments = payload.reason || payload.comment || caseForm.reviewComments;
    this.touchReview(caseForm, user);
    this.addAudit(caseForm, action === "approve" ? "FORM_APPROVED" : action === "reject" ? "FORM_REJECTED" : "FORM_CHANGES_REQUESTED", user, req, payload);
    await caseForm.save();
    await this.audit(action === "approve" ? "FORM_APPROVED" : action === "reject" ? "FORM_REJECTED" : "FORM_CHANGES_REQUESTED", caseForm, user, req, payload);
    await this.notifyCaseTeam(caseData, caseForm, user, req, `form.${action}`, action === "approve" ? "USCIS Form Approved" : "USCIS Form Review Updated", `${caseForm.formCode} was ${action.replaceAll("_", " ")}.`, { priority: action === "approve" ? "medium" : "high" });
    await require("../cases/case-lifecycle-orchestrator.service").recalculate(caseId, user, req, `uscis_form_${action}`).catch(() => null);
    return caseForm;
  }

  static async setLock(caseId, caseFormId, locked, payload, user, req) {
    const { caseData, caseForm } = await this.load(caseId, caseFormId, user);
    const permissions = this.permissions(user);
    if ((locked && !permissions.canLock) || (!locked && !permissions.canUnlock)) throw error("Not authorized to change the form lock", 403);
    if (locked && !["approved", "ready_for_pdf", "generated"].includes(caseForm.status)) throw error("Only an approved form can be locked", 409);
    caseForm.reviewState = caseForm.reviewState?.toObject?.() || caseForm.reviewState || {};
    caseForm.isLocked = locked;
    caseForm.lockedAt = locked ? new Date() : undefined;
    caseForm.lockedBy = locked ? this.userId(user) : undefined;
    caseForm.status = locked ? "locked" : payload.status || "under_review";
    caseForm.reviewState.status = locked ? "locked" : "in_progress";
    this.touchReview(caseForm, user);
    this.addAudit(caseForm, locked ? "FORM_LOCKED" : "FORM_UNLOCKED", user, req, { reason: payload.reason });
    await caseForm.save();
    await this.audit(locked ? "FORM_LOCKED" : "FORM_UNLOCKED", caseForm, user, req, { reason: payload.reason });
    await this.notifyCaseTeam(caseData, caseForm, user, req, locked ? "form.locked" : "form.unlocked", locked ? "USCIS Form Locked" : "USCIS Form Unlocked", `${caseForm.formCode} was ${locked ? "locked" : "unlocked"}.`);
    return caseForm;
  }

  static async refresh(caseId, caseFormId, payload, user, req) {
    const { caseForm, template } = await this.load(caseId, caseFormId, user);
    this.assertEditable(caseForm, user);
    let fieldIds = payload.fieldIds || [];
    if (payload.sectionKey) fieldIds = this.sectionFieldNames(template, payload.sectionKey);
    const result = fieldIds.length
      ? await AutoFillService.repopulateFields(caseId, caseForm.formCode, fieldIds, user, req)
      : await AutoFillService.generate(caseId, caseForm.formCode, user, req, { regenerate: true });
    result.caseForm.syncState = {
      ...(result.caseForm.syncState || {}),
      autoFillVersion: result.caseForm.versionNumber,
      lastSyncedAt: new Date(),
      stale: false,
      changedFields: result.report?.population?.updatedFields?.map((item) => item.fieldId) || fieldIds,
    };
    this.touchReview(result.caseForm, user);
    this.addAudit(result.caseForm, "FORM_REFRESHED", user, req, { fieldIds, sectionKey: payload.sectionKey });
    await result.caseForm.save();
    return result;
  }

  static async reset(caseId, caseFormId, payload, user, req) {
    const { caseForm, template } = await this.load(caseId, caseFormId, user);
    this.assertEditable(caseForm, user);
    let fieldIds = payload.fieldIds || (payload.fieldName ? [payload.fieldName] : []);
    if (payload.sectionKey) fieldIds = this.sectionFieldNames(template, payload.sectionKey);
    if (!fieldIds.length) throw error("At least one field is required", 400);
    const manualOverrides = clone(caseForm.manualOverrides);
    const sourceAttribution = clone(caseForm.sourceAttribution);
    const fieldReviews = clone(caseForm.fieldReviews);
    fieldIds.forEach((fieldName) => {
      delete manualOverrides[fieldName];
      delete sourceAttribution[fieldName];
      delete fieldReviews[fieldName];
    });
    caseForm.manualOverrides = manualOverrides;
    caseForm.sourceAttribution = sourceAttribution;
    caseForm.fieldReviews = fieldReviews;
    caseForm.markModified("manualOverrides");
    caseForm.markModified("sourceAttribution");
    caseForm.markModified("fieldReviews");
    await caseForm.save();
    const result = await AutoFillService.repopulateFields(caseId, caseForm.formCode, fieldIds, user, req);
    fieldIds.forEach((fieldName) => this.pushFieldHistory(result.caseForm, {
      fieldName,
      action: "reset_to_autofill",
      previousValue: MappingResolver.resolvePath(caseForm.fieldValues || {}, fieldName),
      newValue: MappingResolver.resolvePath(result.caseForm.fieldValues || {}, fieldName),
      reason: payload.reason,
      source: "CanonicalProfile",
    }, user));
    this.touchReview(result.caseForm, user);
    await result.caseForm.save();
    return result;
  }

  static async rollbackField(caseId, caseFormId, historyId, user, req) {
    const { caseForm } = await this.load(caseId, caseFormId, user);
    const entry = caseForm.fieldHistory.id(historyId);
    if (!entry) throw error("Field history entry not found", 404);
    return this.saveField(caseId, caseFormId, {
      fieldName: entry.fieldName,
      sectionKey: entry.sectionKey,
      value: entry.previousValue,
      reason: `Rollback of ${entry.action}`,
    }, user, req);
  }

  static async resolveConflict(caseId, caseFormId, payload, user, req) {
    const { caseForm } = await this.load(caseId, caseFormId, user);
    this.assertEditable(caseForm, user);
    const fieldName = payload.fieldName || payload.fieldId;
    let value = payload.value;
    if (payload.resolution === "canonical") {
      const canonicalState = await CanonicalProfileService.get(caseId, user, req);
      const attribution = caseForm.sourceAttribution?.[fieldName] || MappingResolver.resolvePath(caseForm.sourceAttribution || {}, fieldName) || {};
      const sourcePath = payload.sourceField || attribution.sourceField || attribution.canonicalSource;
      value = MappingResolver.resolvePath(canonicalState.profile || {}, String(sourcePath || "").replace(/^canonical\./, ""));
      if (value === undefined) throw error("Canonical value is unavailable for this field", 422);
    } else if (payload.resolution === "current") {
      value = MappingResolver.resolvePath(caseForm.fieldValues || caseForm.filledData || {}, fieldName);
    }
    await this.saveField(caseId, caseFormId, {
      fieldName,
      sectionKey: payload.sectionKey,
      value,
      reason: payload.reason || `Conflict resolved using ${payload.resolution || "manual"} value`,
    }, user, req);
    const updated = await CaseForm.findById(caseFormId);
    updated.set(`fieldReviews.${fieldName}`, {
      status: "verified",
      comment: payload.reason,
      reviewedBy: this.userId(user),
      reviewedAt: new Date(),
    });
    this.addAudit(updated, "CONFLICT_RESOLVED", user, req, { fieldName, resolution: payload.resolution, value });
    await updated.save();
    await this.audit("CONFLICT_RESOLVED", updated, user, req, { fieldName, resolution: payload.resolution, value });
    return updated;
  }

  static async addComment(caseId, caseFormId, payload, user, req) {
    const { caseData, caseForm } = await this.load(caseId, caseFormId, user);
    if (!this.permissions(user).canComment) throw error("Not authorized to comment on this form", 403);
    if (!String(payload.comment || "").trim()) throw error("Comment is required", 400);
    caseForm.comments.push({
      scope: payload.scope || (payload.fieldName ? "field" : payload.sectionKey ? "section" : "form"),
      fieldName: payload.fieldName,
      sectionKey: payload.sectionKey,
      comment: String(payload.comment).trim(),
      parentCommentId: payload.parentCommentId,
      mentions: payload.mentions || [],
      internalOnly: payload.internalOnly !== false,
      createdBy: this.userId(user),
    });
    this.touchReview(caseForm, user);
    this.addAudit(caseForm, "COMMENT_ADDED", user, req, { scope: payload.scope, fieldName: payload.fieldName, sectionKey: payload.sectionKey });
    await caseForm.save();
    await this.audit("COMMENT_ADDED", caseForm, user, req, { scope: payload.scope, fieldName: payload.fieldName, sectionKey: payload.sectionKey });
    await this.notifyCaseTeam(caseData, caseForm, user, req, "form.comment_added", "USCIS Form Comment Added", `A review comment was added to ${caseForm.formCode}.`);
    return caseForm.comments[caseForm.comments.length - 1];
  }

  static async resolveComment(caseId, caseFormId, commentId, user, req) {
    const { caseForm } = await this.load(caseId, caseFormId, user);
    if (!this.permissions(user).canReview) throw error("Not authorized to resolve comments", 403);
    const comment = caseForm.comments.id(commentId);
    if (!comment) throw error("Comment not found", 404);
    comment.resolved = true;
    comment.resolvedBy = this.userId(user);
    comment.resolvedAt = new Date();
    this.addAudit(caseForm, "COMMENT_RESOLVED", user, req, { commentId });
    await caseForm.save();
    return comment;
  }

  static async createReviewTask(caseId, caseFormId, payload, user, req) {
    const { caseData, caseForm } = await this.load(caseId, caseFormId, user);
    if (!this.permissions(user).canCreateTask) throw error("Not authorized to create review tasks", 403);
    const task = await TaskManagementService.create(caseData, {
      ...payload,
      assignedTo: payload.assignedTo || caseData.assignedCaseManager || caseData.assignedTeamLead || this.userId(user),
      category: payload.category || "form_review",
      tags: [...new Set([...(payload.tags || []), "uscis-form-review", `case-form:${caseFormId}`, ...(payload.fieldName ? [`field:${payload.fieldName}`] : []), ...(payload.sectionKey ? [`section:${payload.sectionKey}`] : [])])],
    }, user, req);
    caseForm.reviewTasks.push(task._id);
    this.addAudit(caseForm, "REVIEW_TASK_CREATED", user, req, { taskId: task._id, fieldName: payload.fieldName, sectionKey: payload.sectionKey });
    await caseForm.save();
    return task;
  }

  static async details(caseId, caseFormId, type, query, user, req) {
    const workspace = await this.open(caseId, caseFormId, user, req, { track: false });
    const fields = workspace.template.sections.flatMap((section) => section.fields.map((field) => ({ ...field, sectionKey: section.key, sectionTitle: section.title })));
    if (type === "validation") return { validationErrors: workspace.caseForm.validationErrors, canonicalValidation: workspace.canonical.validation, completion: workspace.caseForm.completion };
    if (type === "comments") return { comments: workspace.comments };
    if (type === "history") return { fieldHistory: workspace.caseForm.fieldHistory, auditHistory: workspace.caseForm.auditHistory };
    if (type === "sources") return { sources: fields.map(({ fieldName, source, sourceField, confidence, verificationStatus, documents }) => ({ fieldName, source, sourceField, confidence, verificationStatus, documents })) };
    if (type === "comparison") return {
      differences: fields.filter((field) => field.canonicalValue !== undefined && !valuesEqual(field.value, field.canonicalValue)).map((field) => ({
        fieldName: field.fieldName,
        label: field.label || field.fieldLabel,
        currentValue: field.value,
        canonicalValue: field.canonicalValue,
        canonicalField: field.sourceField,
        protected: Boolean(field.manualOverride),
      })),
    };
    if (type === "search") {
      const term = String(query.q || "").trim().toLowerCase();
      return {
        results: fields.filter((field) => !term || [field.fieldName, field.fieldId, field.label, field.fieldLabel, field.sourceField, field.sectionTitle].some((value) => String(value || "").toLowerCase().includes(term))).slice(0, Math.min(Number(query.limit) || 100, 500)),
      };
    }
    throw error("Unsupported review detail", 400);
  }
}

module.exports = InteractiveFormReviewService;
