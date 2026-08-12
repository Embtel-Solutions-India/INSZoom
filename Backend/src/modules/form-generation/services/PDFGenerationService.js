const AuditLog = require("../../../models/AuditLog");
const CaseForm = require("../../../models/CaseForm");
const Document = require("../../../models/Document");
const storageService = require("../../uploads/storage.service");
const PDFRenderer = require("./PDFRenderer");
const PDFValidationService = require("./PDFValidationService");
const notificationService = require("../../notifications/notification.service");
const workflowService = require("../../workflows/workflow.service");
const logger = require("../../../utils/logger");

class PDFGenerationService {
  static userId(user) {
    return user?._id || user?.id || user;
  }

  static async audit(action, caseForm, user, req, changes = {}) {
    await AuditLog.create({
      userId: this.userId(user),
      userRole: user?.role,
      action,
      entityType: "CaseForm",
      entityId: String(caseForm._id),
      changes,
      ipAddress: req?.ip,
      userAgent: req?.headers?.["user-agent"],
      description: `${action} for ${caseForm.formCode}`,
    }).catch(() => null);
  }

  static async loadCaseForm(caseFormId, options = {}) {
    // Excludes the raw-import `definition` blob - 7.36MB of the 15.10MB live
    // I-129 template, duplicating data already held in the normalized
    // formFields/formStructure/formLayout fields, and read by nothing in the
    // render or generation path. See uscis-form.service.js's
    // TEMPLATE_RENDER_EXCLUDE for the measurements behind this.
    let query = CaseForm.findById(caseFormId).populate({ path: "formTemplateId", select: "-definition" });
    if (options.readOnly) query = query.read("secondaryPreferred");
    const caseForm = await query;
    if (!caseForm) {
      const error = new Error("Case form not found");
      error.status = 404;
      throw error;
    }
    if (!caseForm.formTemplateId) {
      const error = new Error("USCIS form template not found");
      error.status = 404;
      throw error;
    }
    return caseForm;
  }

  static role(user) {
    return String(user?.role || "").toLowerCase();
  }

  static assertCanGenerate(caseForm, user, options = {}) {
    const role = this.role(user);
    if (!["super_admin", "admin", "team_lead", "case_manager"].includes(role)) {
      const error = new Error("Not authorized to generate official USCIS PDFs");
      error.status = 403;
      throw error;
    }
    if (options.regenerate && caseForm.isLocked && !["super_admin", "admin", "team_lead"].includes(role)) {
      const error = new Error("Only an administrator or team lead can regenerate a locked USCIS form");
      error.status = 403;
      throw error;
    }
  }

  static async notify(caseForm, user, req, payload) {
    const Case = require("../../../models/Case");
    const caseData = await Case.findById(caseForm.caseId).select("assignedCaseManager assignedTeamLead user clientProfile caseNumber caseId").lean().catch(() => null);
    const recipients = [
      caseData?.assignedCaseManager,
      caseData?.assignedTeamLead,
    ].filter(Boolean).map(String).filter((id) => id !== String(this.userId(user)));
    await Promise.all([...new Set(recipients)].map((userId) => notificationService.createNotification({
      userId,
      type: "general",
      category: "case",
      title: payload.title,
      message: payload.message,
      priority: payload.priority || "medium",
      caseId: caseForm.caseId,
      link: `/crm-cases/${caseForm.caseId}?tab=forms&formId=${caseForm._id}`,
      internalOnly: true,
      source: "shared",
      metadata: { caseFormId: caseForm._id, formCode: caseForm.formCode, ...payload.metadata },
    }, user, req).catch((error) => logger.warn("pdf_generation_notification_failed", { caseFormId: caseForm._id, userId, action: payload.title, error }))));
  }

  static async validate(caseFormId, user, req) {
    const caseForm = await this.loadCaseForm(caseFormId);
    const documents = await Document.find({ caseId: caseForm.caseId }).select("documentType category documentCategory reviewStatus status").lean();
    const validationResults = PDFValidationService.validate(caseForm, caseForm.formTemplateId.toObject(), { documents });
    caseForm.validationErrors = {
      ...(caseForm.validationErrors?.toObject?.() || caseForm.validationErrors || {}),
      pdf: validationResults,
    };
    caseForm.auditHistory.push({
      action: "PDF_VALIDATION_EXECUTED",
      changes: { status: validationResults.status, errors: validationResults.errors.length, warnings: validationResults.warnings.length },
      performedBy: this.userId(user),
      ipAddress: req?.ip,
      userAgent: req?.headers?.["user-agent"],
    });
    await caseForm.save();
    await this.audit(validationResults.valid ? "PDF_VALIDATION_COMPLETED" : "PDF_VALIDATION_FAILED", caseForm, user, req, validationResults);
    if (!validationResults.valid) {
      await this.notify(caseForm, user, req, {
        title: "USCIS PDF validation failed",
        message: `${caseForm.formCode} has ${validationResults.errors.length} blocking issue(s) before PDF generation.`,
        priority: "high",
        metadata: { validationStatus: validationResults.status },
      });
    }
    return { caseForm, validationResults };
  }

  static async createGeneratedDocument(caseForm, buffer, user, validationResults, renderReport, watermark) {
    const originalName = `${caseForm.formCode}-${caseForm.caseId}-v${(caseForm.generatedPdfVersions?.length || 0) + 1}.pdf`;
    const key = storageService.generateDocumentKey({ caseId: caseForm.caseId, userId: this.userId(user), originalName });
    const stored = await storageService.storeBuffer(key, buffer);
    const version = {
      version: 1,
      originalName,
      storedName: key.split("/").pop(),
      storageProvider: stored.provider,
      storageKey: stored.key,
      filePath: stored.path,
      documentUrl: stored.url,
      mimeType: "application/pdf",
      fileType: "application/pdf",
      size: buffer.length,
      checksum: stored.checksum,
      uploadedByUser: this.userId(user),
      uploadedByRole: user?.role,
    };
    return Document.create({
      user: user?._id,
      caseId: caseForm.caseId,
      category: "forms",
      documentType: "uscis_form",
      description: `Generated USCIS ${caseForm.formCode} PDF`,
      folderPath: `/cases/${caseForm.caseId}/forms`,
      folderName: "Forms",
      tags: ["uscis", "generated", caseForm.formCode].filter(Boolean),
      originalName,
      originalFileName: originalName,
      storedName: version.storedName,
      fileName: version.storedName,
      mimeType: "application/pdf",
      fileType: "application/pdf",
      size: buffer.length,
      fileSize: buffer.length,
      filePath: stored.path,
      documentUrl: stored.url,
      storageProvider: stored.provider,
      storageKey: stored.key,
      checksum: stored.checksum,
      uploadedBy: "system",
      uploadedByUser: this.userId(user),
      metadata: { caseFormId: caseForm._id, validationResults, renderReport, watermark },
      versions: [version],
      legacySource: "shared",
    });
  }

  static async generate(caseFormId, user, req, options = {}) {
    const caseForm = await this.loadCaseForm(caseFormId);
    this.assertCanGenerate(caseForm, user, options);
    if (!["approved", "ready_for_pdf", "locked", "generated"].includes(caseForm.status)) {
      const error = new Error("Complete form review before generating the USCIS PDF");
      error.status = 422;
      error.statusCode = 422;
      throw error;
    }
    if ((caseForm.syncState?.stale || caseForm.syncState?.requiresRegeneration) && !options.regenerate) {
      const error = new Error("This USCIS form is out of date. Regenerate it intentionally before producing an official PDF.");
      error.status = 409;
      error.statusCode = 409;
      throw error;
    }
    const template = caseForm.formTemplateId.toObject();
    const documents = await Document.find({ caseId: caseForm.caseId }).select("documentType category documentCategory reviewStatus status").lean();
    // A physical signature can't exist until the actual human filing act -
    // draft (pre-lock) generation must not block on it, only a post-lock
    // "FINAL" render should (same status this file already keys the
    // watermark text off of).
    const validationResults = PDFValidationService.validate(caseForm, template, { documents, draft: caseForm.status !== "locked" });
    if (!validationResults.valid) {
      const error = new Error("PDF generation blocked by validation errors");
      error.status = 422;
      error.statusCode = 422;
      error.validationResults = validationResults;
      await this.audit("PDF_GENERATION_BLOCKED", caseForm, user, req, validationResults);
      throw error;
    }

    if (options.regenerate) {
      caseForm.versions.push({
        versionNumber: caseForm.versionNumber || 0,
        generatedBy: this.userId(user),
        generatedAt: new Date(),
        changeSummary: { reason: options.reason || "PDF regeneration", previousStatus: caseForm.status },
        filledData: caseForm.filledData,
        fieldValues: caseForm.fieldValues,
        sourceAttribution: caseForm.sourceAttribution,
        validationErrors: caseForm.validationErrors,
        completion: caseForm.completion,
        status: caseForm.status,
      });
      caseForm.comparisonBaseline = {
        versionNumber: caseForm.versionNumber || 0,
        capturedAt: new Date(),
        fieldValues: caseForm.fieldValues,
        filledData: caseForm.filledData,
      };
    }
    const rendered = await PDFRenderer.render({
      caseForm,
      template,
      watermark: options.watermark || (caseForm.status === "locked" || caseForm.status === "ready_for_pdf" ? "FINAL" : "ATTORNEY REVIEW"),
      flatten: options.flatten === true,
    });
    // A field whose value can't be applied (unknown checkbox on-state, a
    // dropdown option not in the field's own option list, a malformed date,
    // or a mapped PDF field name that isn't on this particular template) is a
    // data-quality issue on ONE field, not a reason to refuse the whole
    // render - the rest of the form is still correct and a case manager
    // needs the draft to fix the flagged field. Recorded as fillWarnings on
    // the CaseForm rather than dropped silently or thrown as a blocking error.
    const fillWarnings = [
      ...(rendered.renderReport.failedFieldWrites || []).map((item) => ({ pdfField: item.pdfField, caseField: item.caseField, message: item.message })),
      ...(rendered.renderReport.unmappedPdfFields || [])
        .filter((pdfField) => !(rendered.renderReport.failedFieldWrites || []).some((item) => item.pdfField === pdfField))
        .map((pdfField) => ({ pdfField, caseField: null, message: `PDF field ${pdfField} was not found on this template and could not be written` })),
    ];
    const document = await this.createGeneratedDocument(caseForm, rendered.buffer, user, validationResults, rendered.renderReport, options.watermark || (caseForm.status === "locked" || caseForm.status === "ready_for_pdf" ? "FINAL" : "ATTORNEY REVIEW"));
    await require("../../integrations/google-drive.service").syncDocument(document).catch(async (error) => {
      logger.warn("pdf_generation_drive_sync_failed", { caseFormId: caseForm._id, documentId: document._id, error });
      document.googleDrive = { ...(document.googleDrive || {}), syncStatus: "failed", lastError: error.message, lastAttemptAt: new Date() };
      await document.save();
    });
    const versionNumber = (caseForm.generatedPdfVersions?.length || 0) + 1;
    caseForm.filledPdfPath = document.storageKey;
    caseForm.filledPdfUrl = document.documentUrl;
    caseForm.generatedPdfDocument = document._id;
    caseForm.generatedPdfVersions.push({
      versionNumber,
      generatedAt: new Date(),
      generatedBy: this.userId(user),
      pdfPath: document.storageKey,
      pdfUrl: document.documentUrl,
      document: document._id,
      validationResults,
      watermark: options.watermark || (caseForm.status === "locked" || caseForm.status === "ready_for_pdf" ? "FINAL" : "ATTORNEY REVIEW"),
      status: "generated",
    });
    caseForm.status = "generated";
    caseForm.generatedAt = new Date();
    caseForm.fillWarnings = fillWarnings;
    caseForm.versionNumber = (caseForm.versionNumber || 0) + 1;
    caseForm.syncState = {
      ...(caseForm.syncState?.toObject?.() || caseForm.syncState || {}),
      stale: false,
      requiresRegeneration: false,
      lastSyncedAt: caseForm.syncState?.lastSyncedAt,
    };
    caseForm.auditHistory.push({
      action: "PDF_GENERATED",
      changes: { documentId: document._id, versionNumber, validationResults, fillWarningCount: fillWarnings.length },
      performedBy: this.userId(user),
      ipAddress: req?.ip,
      userAgent: req?.headers?.["user-agent"],
    });
    await caseForm.save();
    await this.audit(options.regenerate ? "PDF_REGENERATED" : "PDF_GENERATED", caseForm, user, req, { documentId: document._id, versionNumber });
    await this.notify(caseForm, user, req, {
      title: options.regenerate ? "USCIS PDF regenerated" : "USCIS PDF generated",
      message: `${caseForm.formCode} official PDF was generated successfully.`,
      metadata: { documentId: document._id, versionNumber },
    });
    await workflowService.triggerWorkflow("pdf.generated", {
      entityType: "case",
      entityId: caseForm.caseId,
      caseId: caseForm.caseId,
      caseFormId: caseForm._id,
      documentId: document._id,
      formCode: caseForm.formCode,
      versionNumber,
    }, user, req).catch((error) => logger.warn("pdf_generation_workflow_trigger_failed", { caseFormId: caseForm._id, documentId: document._id, error }));
    await require("../../cases/case-lifecycle-orchestrator.service").recalculate(caseForm.caseId, user, req, "uscis_pdf_generated").catch((error) => logger.warn("pdf_generation_lifecycle_recalculate_failed", { caseFormId: caseForm._id, caseId: caseForm.caseId, error }));
    return { caseForm, document, validationResults, renderReport: rendered.renderReport };
  }

  static async approve(caseFormId, user, req) {
    const caseForm = await this.loadCaseForm(caseFormId);
    if (!["super_admin", "admin", "team_lead"].includes(this.role(user))) {
      const error = new Error("Administrator or team lead approval is required");
      error.status = 403;
      throw error;
    }
    const latest = caseForm.generatedPdfVersions?.[caseForm.generatedPdfVersions.length - 1];
    if (!latest) {
      const error = new Error("Generate a PDF before approval");
      error.status = 422;
      throw error;
    }
    const validationResults = latest.validationResults || PDFValidationService.validate(caseForm, caseForm.formTemplateId.toObject());
    if (!validationResults.valid) {
      const error = new Error("Cannot approve a PDF with blocking validation errors");
      error.status = 422;
      error.validationResults = validationResults;
      throw error;
    }
    latest.approvedBy = this.userId(user);
    latest.approvedAt = new Date();
    latest.status = "approved";
    caseForm.status = "locked";
    caseForm.isLocked = true;
    caseForm.lockedAt = new Date();
    caseForm.lockedBy = this.userId(user);
    caseForm.approvedBy = this.userId(user);
    caseForm.approvalDate = new Date();
    caseForm.auditHistory.push({ action: "PDF_APPROVED", changes: { versionNumber: latest.versionNumber }, performedBy: this.userId(user), ipAddress: req?.ip, userAgent: req?.headers?.["user-agent"] });
    await caseForm.save();
    await this.audit("PDF_APPROVED", caseForm, user, req, { versionNumber: latest.versionNumber });
    await this.notify(caseForm, user, req, {
      title: "USCIS PDF approved",
      message: `${caseForm.formCode} was approved and locked for filing.`,
      metadata: { versionNumber: latest.versionNumber },
    });
    await workflowService.triggerWorkflow("pdf.approved", {
      entityType: "case",
      entityId: caseForm.caseId,
      caseId: caseForm.caseId,
      caseFormId: caseForm._id,
      formCode: caseForm.formCode,
      versionNumber: latest.versionNumber,
    }, user, req).catch(() => null);
    const caseAutomation = require("../../cases/case-workflow-automation.service");
    if (await caseAutomation.allFormsLocked(caseForm.caseId)) {
      await require("./PetitionWordPackageService").generate(caseForm.caseId, user, req, "all_forms_locked").catch((error) => {
        console.error("Petition Word package generation failed:", { caseId: caseForm.caseId, message: error.message });
      });
    }
    return caseForm;
  }

  static async getPdfDocument(caseFormId) {
    const caseForm = await CaseForm.findById(caseFormId);
    if (!caseForm?.generatedPdfDocument) {
      const error = new Error("Generated PDF not found");
      error.status = 404;
      throw error;
    }
    const document = await Document.findById(caseForm.generatedPdfDocument);
    if (!document) {
      const error = new Error("Generated PDF document not found");
      error.status = 404;
      throw error;
    }
    return { caseForm, document, buffer: await storageService.readBuffer(document.storageKey) };
  }
}

module.exports = PDFGenerationService;
