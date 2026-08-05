const AuditLog = require("../../../models/AuditLog");
const CaseForm = require("../../../models/CaseForm");
const CanonicalDataService = require("./CanonicalDataService");
const FormMappingService = require("./FormMappingService");
const MappingResolver = require("./MappingResolver");
const ValidationService = require("./ValidationService");

class AutoFillService {
  static getUserId(user) {
    return user?._id || user?.id || user;
  }

  static requestMeta(req = {}) {
    return { ipAddress: req.ip, userAgent: req.get?.("user-agent") || req.headers?.["user-agent"] };
  }

  static async audit(action, caseForm, user, req, changes = {}) {
    const userId = this.getUserId(user);
    await AuditLog.create({
      userId,
      userRole: user?.role,
      action,
      entityType: "CaseForm",
      entityId: String(caseForm._id),
      changes,
      ipAddress: req?.ip,
      userAgent: req?.get?.("user-agent") || req?.headers?.["user-agent"],
      description: `USCIS form ${action.replace(/_/g, " ").toLowerCase()}`,
    }).catch(() => null);
  }

  static snapshotVersion(caseForm) {
    return {
      versionNumber: caseForm.versionNumber || 1,
      generatedAt: caseForm.generatedAt,
      generatedBy: caseForm.generatedBy,
      changeSummary: caseForm.changeSummary,
      filledData: caseForm.filledData,
      fieldValues: caseForm.fieldValues,
      sourceAttribution: caseForm.sourceAttribution,
      validationErrors: caseForm.validationErrors,
      completion: caseForm.completion,
      status: caseForm.status,
      archivedAt: new Date(),
    };
  }

  static buildChangeSummary(previousValues = {}, nextValues = {}) {
    const changedFields = new Set([...Object.keys(previousValues || {}), ...Object.keys(nextValues || {})]);
    const changed = [];
    changedFields.forEach((fieldId) => {
      if (JSON.stringify(previousValues[fieldId]) !== JSON.stringify(nextValues[fieldId])) changed.push(fieldId);
    });
    return { changedFields: changed, changedFieldCount: changed.length };
  }

  static clone(value, fallback) {
    if (value === undefined || value === null) return fallback;
    return JSON.parse(JSON.stringify(value));
  }

  static getMeta(container = {}, fieldId) {
    return container[fieldId] || MappingResolver.resolvePath(container, fieldId);
  }

  static getFieldValue(container = {}, fieldId) {
    if (Object.prototype.hasOwnProperty.call(container, fieldId)) return container[fieldId];
    return MappingResolver.resolvePath(container, fieldId);
  }

  static deletePath(target, path) {
    if (!target || !path) return target;
    if (Object.prototype.hasOwnProperty.call(target, path)) delete target[path];
    const segments = MappingResolver.normalizePath(path).split(".").filter(Boolean);
    let cursor = target;
    for (let index = 0; index < segments.length - 1; index += 1) {
      cursor = cursor?.[segments[index]];
      if (!cursor || typeof cursor !== "object") return target;
    }
    if (cursor && Object.prototype.hasOwnProperty.call(cursor, segments[segments.length - 1])) delete cursor[segments[segments.length - 1]];
    return target;
  }

  static templateFieldMap(template = {}) {
    const map = new Map();
    (template.formFields || []).forEach((field) => {
      const fieldId = field.fieldId || field.id || field.fieldName;
      if (fieldId) map.set(fieldId, field);
    });
    return map;
  }

  static mappingUsed(field = {}) {
    const mappings = FormMappingService.normalizeMappings(field);
    if (!mappings.length) return null;
    const mapping = mappings[0];
    return {
      mappingId: mapping.mappingId,
      source: mapping.source,
      sourceField: MappingResolver.getSourcePath(mapping),
      mappingType: mapping.mappingType || mapping.transform?.type || mapping.derived || "direct",
      transform: mapping.transform,
      condition: mapping.condition,
      confidence: mapping.confidence,
      status: mapping.status,
    };
  }

  static isReviewedOrManual(caseForm, fieldId) {
    const manualOverride = this.getMeta(caseForm.manualOverrides || {}, fieldId);
    if (manualOverride) return true;
    const review = this.getMeta(caseForm.fieldReviews || {}, fieldId);
    if (["approved", "edited"].includes(review?.status)) return true;
    const attribution = this.getMeta(caseForm.sourceAttribution || {}, fieldId);
    return ["manual_override", "approved", "attorney_verified", "case_manager_verified"].includes(attribution?.verificationStatus || attribution?.validationStatus);
  }

  static mergeMappedFields(caseForm, template, mapped, canonicalData, options = {}) {
    const selected = options.fieldIds?.length ? new Set(options.fieldIds) : null;
    const fieldMap = this.templateFieldMap(template);
    const filledData = this.clone(caseForm.filledData, {});
    const fieldValues = this.clone(caseForm.fieldValues, {});
    const sourceAttribution = this.clone(caseForm.sourceAttribution, {});
    const updatedFields = [];
    const skippedFields = [];
    const missingFields = [];

    Object.entries(mapped.fieldValues || {}).forEach(([fieldId, value]) => {
      if (selected && !selected.has(fieldId)) return;
      if (MappingResolver.isEmpty(value)) {
        missingFields.push(fieldId);
        return;
      }
      if (!options.overwriteReviewed && this.isReviewedOrManual(caseForm, fieldId)) {
        skippedFields.push({ fieldId, reason: "manual_or_reviewed_field" });
        return;
      }
      const previousValue = this.getFieldValue(filledData, fieldId);
      const attribution = mapped.sourceAttribution?.[fieldId] || {};
      const field = fieldMap.get(fieldId) || {};
      MappingResolver.setPath(filledData, fieldId, value);
      fieldValues[fieldId] = value;
      sourceAttribution[fieldId] = {
        ...attribution,
        value,
        originalValue: previousValue,
        canonicalSource: attribution.sourceField,
        mappingUsed: this.mappingUsed(field),
        populatedAt: new Date(),
        populationTimestamp: new Date(),
        verificationStatus: "auto_filled",
        validationStatus: attribution.validationStatus || "not_validated",
        confidence: attribution.confidence ?? this.mappingUsed(field)?.confidence ?? 100,
      };
      updatedFields.push({ fieldId, previousValue, value, sourceField: attribution.sourceField, confidence: sourceAttribution[fieldId].confidence });
    });

    const completion = FormMappingService.calculateCompletion(template, filledData, canonicalData);
    return {
      filledData,
      fieldValues,
      sourceAttribution,
      completion,
      updatedFields,
      skippedFields,
      missingFields,
    };
  }

  static buildPopulationReport(mapped, merged, readiness, options = {}) {
    return {
      mode: options.selectedFieldIds?.length || options.fieldIds?.length ? "selected_fields" : options.regenerate ? "regenerate" : "generate",
      generatedAt: new Date(),
      canonicalReadiness: readiness,
      mappingValidation: mapped.template?.mappingGraph?.validation || {},
      updatedFieldCount: merged.updatedFields.length,
      skippedFieldCount: merged.skippedFields.length,
      missingFieldCount: merged.missingFields.length,
      updatedFields: merged.updatedFields,
      skippedFields: merged.skippedFields,
      missingFields: merged.missingFields,
      completion: merged.completion,
    };
  }

  static async findCaseForm(caseId, formType) {
    const normalizedFormType = FormMappingService.normalizeFormType(formType);
    return CaseForm.findOne({ caseId, formCode: normalizedFormType }).sort({ updatedAt: -1 });
  }

  static async generate(caseId, formType, user, req, options = {}) {
    const existingCaseForm = await this.findCaseForm(caseId, formType);
    let template;
    if (existingCaseForm?.formTemplateId) {
      template = await existingCaseForm.populate("formTemplateId").then((item) => item.formTemplateId.toObject());
      const lockedMapping = await FormMappingService.loadMappingVersion(
        template,
        existingCaseForm.formVersionLock?.mappingVersionId || existingCaseForm.mappingVersionId,
      );
      template = FormMappingService.applyMappingGraph(template, lockedMapping);
    } else {
      template = await FormMappingService.loadTemplate(formType, options.version);
    }
    const canonicalData = await CanonicalDataService.build(caseId, user, req);
    const readiness = canonicalData.validation || {};
    const startedAt = new Date();
    await this.audit("AUTO_FILL_STARTED", existingCaseForm || { _id: caseId }, user, req, { formType, templateId: template._id, canonicalStatus: readiness.status });
    const mapped = FormMappingService.mapTemplate(template, canonicalData);
    const now = new Date();
    const userId = this.getUserId(user);
    const caseForm = existingCaseForm || new CaseForm({
      caseId,
      formTemplateId: template._id,
      formCode: template.formCode || template.formNumber,
      formVersion: template.version,
      formEditionDate: template.editionDate,
      formVersionLock: {
        formType: template.formCode || template.formNumber,
        editionDate: template.editionDate,
        version: template.version,
        mappingVersion: template.mappingVersion || 0,
        mappingVersionId: template.mappingVersionId || template.activeMappingVersionId || template.latestMappingVersionId,
        validationVersion: template.validationVersion || 0,
        renderingVersion: template.renderingVersion || 0,
        formTemplateId: template._id,
        lockedAt: new Date(),
        lockedBy: userId,
      },
      versionNumber: 0,
    });

    if (caseForm.filledData && (options.regenerate || caseForm.versionNumber > 0)) {
      caseForm.versions = [...(caseForm.versions || []), this.snapshotVersion(caseForm)];
    }

    const previousFieldValues = caseForm.fieldValues || {};
    const fieldIds = options.fieldIds || options.selectedFieldIds;
    const merged = this.mergeMappedFields(caseForm, template, mapped, canonicalData, { ...options, fieldIds });
    const populationReport = this.buildPopulationReport(mapped, merged, readiness, { ...options, fieldIds });
    const nextVersion = (caseForm.versionNumber || 0) + 1;
    caseForm.set("formTemplateId", template._id);
    caseForm.set("formCode", template.formCode || template.formNumber);
    caseForm.set("formVersion", template.version);
    caseForm.set("formEditionDate", template.editionDate);
    caseForm.set("mappingVersion", template.mappingVersion || 0);
    caseForm.set("mappingVersionId", template.mappingVersionId || template.activeMappingVersionId || template.latestMappingVersionId);
    caseForm.set("validationVersion", template.validationVersion || 0);
    caseForm.set("renderingVersion", template.renderingVersion || 0);
    caseForm.set("filledData", merged.filledData);
    caseForm.set("fieldValues", merged.fieldValues);
    caseForm.set("sourceAttribution", merged.sourceAttribution);
    caseForm.set("validationErrors", { populationWarnings: mapped.validation?.warnings || [], populationErrors: mapped.validation?.errors || [], canonicalReadiness: readiness });
    caseForm.set("completion", merged.completion);
    caseForm.set("autoFillReport", populationReport);
    caseForm.set("versionNumber", nextVersion);
    caseForm.set("generatedBy", userId);
    caseForm.set("generatedAt", now);
    caseForm.set("lastModifiedBy", userId);
    caseForm.set("lastModifiedAt", now);
    caseForm.set("status", "ai_filled");
    caseForm.set("changeSummary", this.buildChangeSummary(previousFieldValues, merged.fieldValues));
    caseForm.set("syncState", {
      canonicalVersion: canonicalData.metadata?.canonicalVersion,
      autoFillVersion: nextVersion,
      lastSyncedAt: now,
      stale: false,
      requiresRegeneration: false,
      staleReason: "",
      changedFields: merged.updatedFields.map((field) => field.fieldId),
    });
    caseForm.auditHistory.push({
      action: options.regenerate ? "FORM_REGENERATED" : "FORM_GENERATED",
      changes: { formType, versionNumber: nextVersion, completion: merged.completion, populationReport },
      performedBy: userId,
      performedAt: now,
      ...this.requestMeta(req),
    });
    await caseForm.save();
    await this.audit(options.regenerate ? "FORM_REGENERATED" : "FORM_GENERATED", caseForm, user, req, { formType, versionNumber: nextVersion, completion: merged.completion });
    await this.audit("FIELDS_UPDATED", caseForm, user, req, { count: merged.updatedFields.length, fields: merged.updatedFields.map((field) => field.fieldId) });
    await this.audit("AUTO_FILL_COMPLETED", caseForm, user, req, { formType, durationMs: Date.now() - startedAt.getTime(), report: populationReport });
    await require("../../cases/case-lifecycle-orchestrator.service").recalculate(caseId, user, req, "uscis_form_autofilled").catch(() => null);

    return {
      caseForm,
      report: {
        formType,
        versionNumber: caseForm.versionNumber,
        completion: merged.completion,
        readiness,
        population: populationReport,
        generatedAt: now,
      },
    };
  }

  static async preview(caseId, formType, version) {
    const canonicalData = await CanonicalDataService.build(caseId);
    const template = await FormMappingService.loadTemplate(formType, version);
    return FormMappingService.mapTemplate(template, canonicalData);
  }

  static async validation(caseId, formType) {
    const caseForm = await this.findCaseForm(caseId, formType);
    if (caseForm) return caseForm.validationErrors || ValidationService.validateTemplateOutput(await FormMappingService.loadTemplate(formType, caseForm.formVersion), caseForm.filledData, caseForm.sourceAttribution);
    const preview = await this.preview(caseId, formType);
    return preview.validation;
  }

  static async overrideField(caseId, formType, fieldId, value, user, req, reason) {
    const caseForm = await this.findCaseForm(caseId, formType);
    if (!caseForm) {
      const error = new Error("Case form not found");
      error.status = 404;
      throw error;
    }
    const previousValue = MappingResolver.resolvePath(caseForm.filledData || {}, fieldId);
    const filledData = caseForm.filledData || {};
    MappingResolver.setPath(filledData, fieldId, value);
    caseForm.set("filledData", filledData);
    // fieldValues/sourceAttribution/manualOverrides are FLAT maps keyed by
    // the exact fieldId string (see mergeMappedFields' `fieldValues[fieldId]
    // = value` above) - fieldId is very often a raw AcroForm name like
    // "form1[0].#subform[2].Line8a_StreetNumberName[0]", which contains
    // literal dots/brackets/hashes. Mongoose's `.set("prefix.<fieldId>",
    // value)` string-path API splits on "." and tries to walk it as a
    // NESTED path, which breaks on a key like that (confirmed: throws
    // "Cannot read properties of undefined" reading a bracketed segment).
    // Mutate a plain-object copy with a single bracket assignment instead,
    // then re-set the whole top-level Mixed field - the same safe pattern
    // already used for filledData just above.
    const fieldValues = { ...(caseForm.fieldValues || {}) };
    fieldValues[fieldId] = value;
    caseForm.set("fieldValues", fieldValues);

    const sourceAttribution = { ...(caseForm.sourceAttribution || {}) };
    sourceAttribution[fieldId] = {
      value,
      source: "AttorneyOverride",
      sourceField: fieldId,
      confidence: 100,
      generatedAt: new Date(),
      validationStatus: "manual_override",
    };
    caseForm.set("sourceAttribution", sourceAttribution);

    const manualOverrides = { ...(caseForm.manualOverrides || {}) };
    manualOverrides[fieldId] = {
      previousValue,
      value,
      reason,
      overriddenBy: this.getUserId(user),
      overriddenAt: new Date(),
    };
    caseForm.set("manualOverrides", manualOverrides);
    caseForm.auditHistory.push({
      action: "FIELD_OVERRIDDEN",
      changes: { fieldId, previousValue, value, reason },
      performedBy: this.getUserId(user),
      ...this.requestMeta(req),
    });
    await caseForm.save();
    await this.audit("FIELD_OVERRIDDEN", caseForm, user, req, { fieldId, previousValue, value, reason });
    return caseForm;
  }

  static async repopulateFields(caseId, formType, fieldIds = [], user, req) {
    if (!Array.isArray(fieldIds) || !fieldIds.length) {
      const error = new Error("At least one fieldId is required");
      error.status = 400;
      throw error;
    }
    return this.generate(caseId, formType, user, req, { regenerate: true, selectedFieldIds: fieldIds });
  }

  static async resetAutoFilledFields(caseId, formType, user, req) {
    const caseForm = await this.findCaseForm(caseId, formType);
    if (!caseForm) {
      const error = new Error("Case form not found");
      error.status = 404;
      throw error;
    }
    const template = await caseForm.populate("formTemplateId").then((item) => item.formTemplateId.toObject());
    caseForm.versions = [...(caseForm.versions || []), this.snapshotVersion(caseForm)];
    const filledData = this.clone(caseForm.filledData, {});
    const fieldValues = this.clone(caseForm.fieldValues, {});
    const sourceAttribution = this.clone(caseForm.sourceAttribution, {});
    const removedFields = [];
    Object.keys(sourceAttribution || {}).forEach((fieldId) => {
      if (this.isReviewedOrManual(caseForm, fieldId)) return;
      const source = sourceAttribution[fieldId]?.source;
      if (["AttorneyOverride", "Manual", "manual"].includes(source)) return;
      this.deletePath(filledData, fieldId);
      this.deletePath(fieldValues, fieldId);
      delete fieldValues[fieldId];
      delete sourceAttribution[fieldId];
      removedFields.push(fieldId);
    });
    const canonicalData = await CanonicalDataService.build(caseId, user, req);
    const completion = FormMappingService.calculateCompletion(template, filledData, canonicalData);
    caseForm.set("filledData", filledData);
    caseForm.set("fieldValues", fieldValues);
    caseForm.set("sourceAttribution", sourceAttribution);
    caseForm.set("completion", completion);
    caseForm.set("autoFillReport", {
      action: "reset_auto_filled_fields",
      resetAt: new Date(),
      removedFields,
      completion,
    });
    caseForm.set("lastModifiedBy", this.getUserId(user));
    caseForm.set("lastModifiedAt", new Date());
    caseForm.auditHistory.push({
      action: "AUTO_FILLED_FIELDS_RESET",
      changes: { removedFields, completion },
      performedBy: this.getUserId(user),
      ...this.requestMeta(req),
    });
    await caseForm.save();
    await this.audit("AUTO_FILLED_FIELDS_RESET", caseForm, user, req, { removedFields, completion });
    return caseForm;
  }

  static async reviewField(caseId, formType, fieldId, status, comment, user, req) {
    const caseForm = await this.findCaseForm(caseId, formType);
    if (!caseForm) {
      const error = new Error("Case form not found");
      error.status = 404;
      throw error;
    }
    // Same fix as overrideField above - fieldId can be a raw AcroForm name
    // containing literal dots, which breaks Mongoose's dotted-string
    // `.set()` path API. Flat bracket assignment on a plain-object copy
    // instead.
    const fieldReviews = { ...(caseForm.fieldReviews || {}) };
    fieldReviews[fieldId] = {
      status,
      comment,
      reviewedBy: this.getUserId(user),
      reviewedAt: new Date(),
    };
    caseForm.set("fieldReviews", fieldReviews);
    caseForm.auditHistory.push({
      action: status === "approved" ? "FIELD_APPROVED" : "FIELD_REJECTED",
      changes: { fieldId, status, comment },
      performedBy: this.getUserId(user),
      ...this.requestMeta(req),
    });
    await caseForm.save();
    await this.audit(status === "approved" ? "FIELD_APPROVED" : "FIELD_REJECTED", caseForm, user, req, { fieldId, status, comment });
    return caseForm;
  }

  static async rollback(caseId, formType, versionNumber, user, req) {
    const caseForm = await this.findCaseForm(caseId, formType);
    const version = caseForm?.versions?.find((item) => Number(item.versionNumber) === Number(versionNumber));
    if (!version) {
      const error = new Error("Case form version not found");
      error.status = 404;
      throw error;
    }
    caseForm.versions.push(this.snapshotVersion(caseForm));
    caseForm.set("versionNumber", version.versionNumber);
    caseForm.set("filledData", version.filledData);
    caseForm.set("fieldValues", version.fieldValues);
    caseForm.set("sourceAttribution", version.sourceAttribution);
    caseForm.set("validationErrors", version.validationErrors);
    caseForm.set("completion", version.completion);
    caseForm.set("status", version.status || "draft");
    caseForm.auditHistory.push({
      action: "FORM_ROLLED_BACK",
      changes: { versionNumber },
      performedBy: this.getUserId(user),
      ...this.requestMeta(req),
    });
    await caseForm.save();
    await this.audit("FORM_ROLLED_BACK", caseForm, user, req, { versionNumber });
    return caseForm;
  }
}

module.exports = AutoFillService;
