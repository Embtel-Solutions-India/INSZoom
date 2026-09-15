const AuditLog = require("../../models/AuditLog");
const Case = require("../../models/Case");
const CaseForm = require("../../models/CaseForm");
const logger = require("../../utils/logger");
const USCISFormTemplate = require("../../models/USCISFormTemplate");
const VisaFormMapping = require("../../models/VisaFormMapping");
// Canonical visa registry (§32/§33) — the single source of visa identity for
// mapping creation; never a second hardcoded visa list.
const { VISA_CATEGORIES } = require("../../config/visaCategories");
const { createCrudController } = require("../../utils/crudFactory");
const uscisFormService = require("./uscis-form.service");
const uscisFormImporterService = require("./uscis-form-importer.service");
const interactiveFormReviewService = require("./interactive-form-review.service");
const accessService = require("./uscis-form-access.service");
const healthService = require("./uscis-form-health.service");
const USCISScannerService = require("../uscis-lifecycle/services/USCISScannerService");
const VersionManagementService = require("../uscis-lifecycle/services/VersionManagementService");
const storageService = require("../uploads/storage.service");

// Spec §29 — registry-level audit events, on the same immutable AuditLog
// collection the case-form side already writes to (uscis-form.service.js's
// writeAuditLog), never a parallel audit store. Non-blocking by design: an
// audit write must never fail a registry operation.
async function writeRegistryAudit(action, template, req, metadata = {}) {
  await AuditLog.create({
    userId: req?.user?._id,
    userRole: req?.user?.role,
    action,
    entityType: "uscis_form_template",
    entityId: template?._id || template?.id || null,
    changes: metadata,
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
    source: "api",
    description: `${action} ${template?.formCode || ""} ${template?.version || ""}`.trim(),
  }).catch(() => {});
}

const templates = createCrudController(USCISFormTemplate, {
  label: "USCIS form template",
  searchFields: ["formCode", "title", "description", "visaTypes"],
  filterFields: ["formCode", "status", "version"],
});

async function checkUpdates(req, res, next) {
  try {
    const result = await USCISScannerService.sync(req.body || {}, req.user, req);
    res.json({ success: true, ...result, data: result });
  } catch (error) {
    next(error);
  }
}

async function syncForms(req, res, next) {
  try {
    const result = await USCISScannerService.sync({ ...(req.body || {}), force: true }, req.user, req);
    res.json({ success: true, ...result, data: result });
  } catch (error) {
    next(error);
  }
}

async function getSyncHistory(req, res, next) {
  try {
    const result = await USCISScannerService.syncHistory(req.query);
    res.json({ success: true, ...result, data: result.events });
  } catch (error) {
    next(error);
  }
}

async function listActiveEditions(req, res, next) {
  try {
    const result = await uscisFormService.listRegistry({ ...req.query, status: "active" });
    res.json({ success: true, ...result, data: result.forms });
  } catch (error) {
    next(error);
  }
}

async function listArchivedEditions(req, res, next) {
  try {
    const filter = {};
    if (req.query.formCode || req.query.formNumber) filter.formCode = String(req.query.formCode || req.query.formNumber).trim().toUpperCase();
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    filter.status = { $in: ["retired", "archived"] };
    const [total, forms] = await Promise.all([
      USCISFormTemplate.countDocuments(filter),
      USCISFormTemplate.find(filter).sort({ formCode: 1, editionDate: -1, version: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);
    res.json({ success: true, total, page, pages: Math.ceil(total / limit), forms, data: forms });
  } catch (error) {
    next(error);
  }
}

async function listRegistry(req, res, next) {
  try {
    const result = await uscisFormService.listRegistry(req.query);
    res.json({ success: true, ...result, data: result.forms });
  } catch (error) {
    next(error);
  }
}

async function getVersions(req, res, next) {
  try {
    const result = await uscisFormService.getVersions(req.params.formCode);
    res.json({ success: true, ...result, data: result.versions });
  } catch (error) {
    next(error);
  }
}

async function approveTemplate(req, res, next) {
  try {
    const item = await VersionManagementService.approve(req.params.id, req.user, req);
    res.json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
}

async function activateTemplate(req, res, next) {
  try {
    const item = await uscisFormService.activateTemplate(req.params.id, req.user, req);
    res.json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
}

async function archiveTemplate(req, res, next) {
  try {
    const item = await uscisFormService.retireTemplate(req.params.id, req.user, req);
    res.json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
}

async function rollbackTemplate(req, res, next) {
  try {
    const item = await uscisFormService.activateTemplate(req.params.id, req.user, req);
    res.json({ success: true, data: item, rollback: true });
  } catch (error) {
    next(error);
  }
}

async function validateDefinition(req, res, next) {
  try {
    const validation = uscisFormImporterService.validateDefinition(req.body.definition || req.body);
    res.status(validation.valid ? 200 : 400).json({ success: validation.valid, validation: validation.summary, errors: validation.errors });
  } catch (error) {
    next(error);
  }
}

async function importDefinition(req, res, next) {
  try {
    const result = await uscisFormImporterService.importDefinition(req.body.definition || req.body, req.user, req);
    res.status(result.updatedExisting ? 200 : 201).json({ success: true, ...result, data: result.template });
  } catch (error) {
    next(error);
  }
}

async function getCaseForms(req, res, next) {
  // TEMPORARY diagnostic logging - added to catch the actual browser-
  // triggered failure behind a reported intermittent 503 on this endpoint
  // (list-endpoint 503, see plan doc / ISSUE-001). Logs only requestId, PID,
  // caseId, user id/role, and elapsed ms - never tokens, passwords, or any
  // case PII. Remove once the browser reproduction is resolved either way.
  const startedAt = Date.now();
  logger.info("uscis_forms_list_request_start", {
    requestId: req.requestId, pid: process.pid, caseId: req.params.caseId, userId: req.user?._id, role: req.user?.role,
  });
  try {
    const forms = await uscisFormService.listCaseForms(req.params.caseId, req.user, req);
    logger.info("uscis_forms_list_request_success", {
      requestId: req.requestId, pid: process.pid, caseId: req.params.caseId, elapsedMs: Date.now() - startedAt, formCount: forms.length,
    });
    res.json({ success: true, forms, data: forms });
  } catch (error) {
    logger.error("uscis_forms_list_request_failed", {
      requestId: req.requestId, pid: process.pid, caseId: req.params.caseId, elapsedMs: Date.now() - startedAt,
      errorName: error.name, errorCode: error.code, errorCodeName: error.codeName, errorMessage: error.message,
    });
    next(error);
  }
}

async function getAllCaseForms(req, res, next) {
  try {
    const query = {};
    if (req.query.caseId) query.caseId = req.query.caseId;
    // Unfiltered, this lists every CaseForm in the DB. A full
    // `.populate("formTemplateId")` embeds each template's entire
    // formFields array (~1000 entries with coordinates/mapping/history for
    // a form like I-129) into every single row - across ~100 rows that
    // response body's JSON.stringify exceeded V8's max string length and
    // crashed the request with a 500 (confirmed live). This list view only
    // needs enough to identify the template, not its full field schema.
    const forms = await CaseForm.find(query)
      .populate({ path: "formTemplateId", select: "formCode title version status activeFlag officialStatus" })
      .sort({ updatedAt: -1 })
      .lean();
    res.json({ success: true, data: forms });
  } catch (error) {
    next(error);
  }
}

async function createCaseForm(req, res, next) {
  try {
    const form = await uscisFormService.createCaseForm(req.params.caseId, req.body, req.user, req);
    res.status(201).json({ success: true, data: form, form });
  } catch (error) {
    next(error);
  }
}

// Serves the template's own blank source PDF bytes (not a case's filled
// copy) - Task 2's page-image rendering needs the REAL blank USCIS page to
// rasterize as the visual background each field overlay sits on top of.
// Mirrors documents/document.controller.js's previewDocument pattern: read
// the stored bytes, send inline with the right content-type, no
// transformation here (react-pdf/pdf.js does the actual rendering
// client-side).
async function getTemplatePdf(req, res, next) {
  try {
    // Two ways in: a normal authenticated session (authenticate middleware
    // already ran), or a short-lived signed grant from getTemplatePdfUrl
    // below — the latter exists so a PDF viewer/iframe can load the bytes
    // without replaying the caller's bearer token in a URL.
    if (req.query.token) {
      accessService.verifyFormAccessToken(String(req.query.token), req.params.id);
    }
    const template = await USCISFormTemplate.findById(req.params.id).select("formCode version artifacts pdfStorageKey").lean();
    if (!template) {
      const error = new Error("USCIS form template not found");
      error.statusCode = 404;
      throw error;
    }
    const key = template.artifacts?.form?.storageKey || template.pdfStorageKey;
    if (!key) {
      const error = new Error("This template has no stored PDF artifact");
      error.statusCode = 404;
      throw error;
    }
    let buffer;
    try {
      buffer = await storageService.readBuffer(key);
    } catch (storageError) {
      // Spec §25/§41: never silently fall back to a repository-local PDF,
      // and never surface a raw S3/SDK error to the client.
      logger.error?.("uscis_template_pdf_unavailable", { templateId: req.params.id, code: storageError?.code });
      const error = new Error("The official PDF for this form could not be retrieved from secure storage. Please try again or contact an administrator.");
      error.statusCode = 502;
      throw error;
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${template.formCode}-${template.version}.pdf"`);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(buffer);
  } catch (error) {
    next(error);
  }
}

// Spec §40 GET /:id/url — mints a short-lived signed link to the official
// PDF. See uscis-form-access.service.js for why this is a backend-signed
// grant rather than a raw S3 presigned URL (objects are app-encrypted at
// rest, so a direct-to-S3 URL would return ciphertext).
async function getTemplatePdfUrl(req, res, next) {
  try {
    const template = await USCISFormTemplate.findById(req.params.id)
      .select("formCode version artifacts.form.storageKey pdfStorageKey")
      .lean();
    if (!template) {
      const error = new Error("USCIS form template not found");
      error.statusCode = 404;
      throw error;
    }
    if (!(template.artifacts?.form?.storageKey || template.pdfStorageKey)) {
      const error = new Error("This template has no stored PDF artifact");
      error.statusCode = 404;
      throw error;
    }
    const grant = accessService.createFormAccessToken({
      templateId: req.params.id,
      user: req.user,
      ttlSeconds: req.query.ttl,
    });
    await writeRegistryAudit("FORM_DOWNLOADED", template, req, { via: "signed_url", jti: grant.jti });
    res.json({
      success: true,
      url: `/api/uscis-forms/${req.params.id}/pdf?token=${encodeURIComponent(grant.token)}`,
      expiresAt: grant.expiresAt,
      expiresInSeconds: grant.expiresInSeconds,
    });
  } catch (error) {
    next(error);
  }
}

// Spec §30 — per-template health. `?deep=true` additionally downloads the
// object and verifies its SHA-256 against the registry (admin-only cost).
async function getTemplateHealth(req, res, next) {
  try {
    const template = await USCISFormTemplate.findById(req.params.id)
      .select("formCode version status activeFlag editionDate pdfStorageKey artifacts.form formFields")
      .lean();
    if (!template) {
      const error = new Error("USCIS form template not found");
      error.statusCode = 404;
      throw error;
    }
    const result = await healthService.checkTemplate(template, { deep: req.query.deep === "true" });
    res.json({ success: true, health: result, data: result });
  } catch (error) {
    next(error);
  }
}

// Registry-wide health sweep for the list page's S3/health column —
// metadata-only probes, bounded concurrency (see checkRegistry).
async function getRegistryHealth(req, res, next) {
  try {
    const health = await healthService.checkRegistry({
      deep: req.query.deep === "true",
      force: req.query.force === "true",
    });
    res.json({ success: true, health, data: health });
  } catch (error) {
    next(error);
  }
}

// §32/§33 — the canonical visa vocabulary the mapping editor must pick from,
// served straight off config/visaCategories.js (the same source case creation
// validates against) so the UI can never introduce a second visa list.
async function getVisaRegistry(req, res, next) {
  try {
    const visaTypes = Object.entries(VISA_CATEGORIES)
      .map(([value, config]) => ({
        value,
        label: config.label || value,
        caseStructure: config.caseStructure || null,
      }))
      .sort((a, b) => a.value.localeCompare(b.value));
    res.json({
      success: true,
      visaTypes,
      provisioningTypes: VisaFormMapping.PROVISIONING_TYPES,
      componentTypes: VisaFormMapping.COMPONENT_TYPES,
      agencies: VisaFormMapping.AGENCIES,
      triggerFields: VisaFormMapping.TRIGGER_FIELD_WHITELIST,
      data: visaTypes,
    });
  } catch (error) {
    next(error);
  }
}

/* ── Visa mapping management (spec §32) ─────────────────────────────────────
   Reads/writes the EXISTING VisaFormMapping collection — deliberately not a
   second mapping model (§18/§44). A mapping is linked to a registry template
   by formTemplateFormCode (lowercased formCode), exactly as
   visaFormMappings.seed.js does it, so mappings created here and mappings
   created by the seed are indistinguishable to the provisioning resolver. */

// VisaFormMapping.immigrationNature is required, and getting it wrong
// mislabels the nature of a filing. Derived from the canonical visa registry
// (never a second visa list): an admin can always state it explicitly, this
// only supplies a sane default when they don't.
function inferImmigrationNature(visaType) {
  const value = String(visaType || "");
  if (/^EB-|Adjustment of Status|Green Card|Permanent Resident|^F[1-4]|^IR-|^CR-/i.test(value)) {
    return "PERMANENT_IMMIGRANT";
  }
  if (/Naturalization|Citizenship|^N-/i.test(value)) return "CITIZENSHIP";
  if (/^F-1|^M-1|^J-1|Student|Exchange/i.test(value)) return "STUDENT_EXCHANGE";
  if (/Asylum|Refugee|^U-|^T-|VAWA|Humanitarian/i.test(value)) return "HUMANITARIAN";
  return "TEMPORARY_NONIMMIGRANT";
}

async function loadTemplateOr404(id) {
  const template = await USCISFormTemplate.findById(id).select("formCode formNumber title version").lean();
  if (!template) {
    const error = new Error("USCIS form template not found");
    error.statusCode = 404;
    throw error;
  }
  return template;
}

async function listFormMappings(req, res, next) {
  try {
    const template = await loadTemplateOr404(req.params.id);
    const mappings = await VisaFormMapping.find({
      formTemplateFormCode: String(template.formCode).toLowerCase(),
    })
      .sort({ visaType: 1, displayOrder: 1 })
      .lean();
    res.json({ success: true, formCode: template.formCode, mappings, data: mappings });
  } catch (error) {
    next(error);
  }
}

async function createFormMapping(req, res, next) {
  try {
    const template = await loadTemplateOr404(req.params.id);
    const { visaType, provisioningType, componentType, triggerCondition, agency, displayOrder, notes, immigrationNature } = req.body || {};

    // §32/§33: visa must come from the canonical registry — never free text.
    if (!visaType || !VISA_CATEGORIES[visaType]) {
      const error = new Error("Select a visa type from the canonical visa registry.");
      error.statusCode = 400;
      throw error;
    }
    if (!VisaFormMapping.PROVISIONING_TYPES.includes(provisioningType)) {
      const error = new Error(`Assignment type must be one of: ${VisaFormMapping.PROVISIONING_TYPES.join(", ")}`);
      error.statusCode = 400;
      throw error;
    }
    if (immigrationNature && !VisaFormMapping.IMMIGRATION_NATURE.includes(immigrationNature)) {
      const error = new Error(`Immigration nature must be one of: ${VisaFormMapping.IMMIGRATION_NATURE.join(", ")}`);
      error.statusCode = 400;
      throw error;
    }
    // Required by the mapping schema. Derive it from the canonical visa's own
    // case structure when the caller doesn't state it, rather than defaulting
    // every new mapping to "nonimmigrant" — an EB/green-card visa mapped as
    // temporary would misreport the nature of the filing.
    const resolvedNature = immigrationNature || inferImmigrationNature(visaType);
    // Mirror the trigger-condition whitelist check the schema validator
    // enforces, so a bad condition returns a clean 400 instead of a
    // ValidationError surfacing through the generic error handler (§41).
    if (triggerCondition) {
      const conditionError = VisaFormMapping.validateTriggerNode(triggerCondition, "triggerCondition");
      if (conditionError) {
        const error = new Error(conditionError);
        error.statusCode = 400;
        throw error;
      }
    }

    const existing = await VisaFormMapping.findOne({
      visaType,
      formNumber: template.formNumber || template.formCode,
      componentType: componentType || "STANDALONE_FORM",
    });
    if (existing) {
      const error = new Error(`${visaType} is already mapped to ${template.formCode}.`);
      error.statusCode = 409;
      throw error;
    }

    const mapping = await VisaFormMapping.create({
      visaType,
      formNumber: template.formNumber || template.formCode,
      formName: template.title || template.formCode,
      agency: agency || "USCIS",
      immigrationNature: resolvedNature,
      provisioningType,
      componentType: componentType || "STANDALONE_FORM",
      // Conditions go through the existing trigger DSL (validated by the
      // model's own TRIGGER_FIELD_WHITELIST) — never React-side logic (§19).
      triggerCondition: triggerCondition || undefined,
      formTemplateFormCode: String(template.formCode).toLowerCase(),
      displayOrder: displayOrder ?? 0,
      notes,
      active: true,
    });

    uscisFormService.invalidateTemplateCache();
    await writeRegistryAudit("FORM_MAPPING_CREATED", template, req, { visaType, provisioningType, mappingId: mapping._id });
    res.status(201).json({ success: true, mapping, data: mapping });
  } catch (error) {
    next(error);
  }
}

async function updateFormMapping(req, res, next) {
  try {
    const template = await loadTemplateOr404(req.params.id);
    const mapping = await VisaFormMapping.findById(req.params.mappingId);
    if (!mapping || mapping.formTemplateFormCode !== String(template.formCode).toLowerCase()) {
      const error = new Error("Mapping not found for this form");
      error.statusCode = 404;
      throw error;
    }
    const { provisioningType, triggerCondition, active, displayOrder, notes } = req.body || {};
    if (provisioningType !== undefined) {
      if (!VisaFormMapping.PROVISIONING_TYPES.includes(provisioningType)) {
        const error = new Error(`Assignment type must be one of: ${VisaFormMapping.PROVISIONING_TYPES.join(", ")}`);
        error.statusCode = 400;
        throw error;
      }
      mapping.provisioningType = provisioningType;
    }
    if (triggerCondition !== undefined) mapping.triggerCondition = triggerCondition;
    if (active !== undefined) mapping.active = Boolean(active);
    if (displayOrder !== undefined) mapping.displayOrder = displayOrder;
    if (notes !== undefined) mapping.notes = notes;
    await mapping.save();

    uscisFormService.invalidateTemplateCache();
    await writeRegistryAudit("FORM_MAPPING_UPDATED", template, req, { mappingId: mapping._id, visaType: mapping.visaType });
    res.json({ success: true, mapping, data: mapping });
  } catch (error) {
    next(error);
  }
}

async function deleteFormMapping(req, res, next) {
  try {
    const template = await loadTemplateOr404(req.params.id);
    const mapping = await VisaFormMapping.findById(req.params.mappingId);
    if (!mapping || mapping.formTemplateFormCode !== String(template.formCode).toLowerCase()) {
      const error = new Error("Mapping not found for this form");
      error.statusCode = 404;
      throw error;
    }
    // Deactivate rather than destroy: existing CaseForms carry
    // provisioning.mappingId, and an audit trail that dead-ends at a deleted
    // document can't explain why a form was assigned (§13/§27 spirit).
    mapping.active = false;
    await mapping.save();

    uscisFormService.invalidateTemplateCache();
    await writeRegistryAudit("FORM_MAPPING_REMOVED", template, req, { mappingId: mapping._id, visaType: mapping.visaType });
    res.json({ success: true, mapping, data: mapping });
  } catch (error) {
    next(error);
  }
}

async function renderCaseForm(req, res, next) {
  try {
    const result = await uscisFormService.renderCaseForm(req.params.caseId, req.params.formId, req.user, req);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

async function saveDraft(req, res, next) {
  try {
    const form = await uscisFormService.saveCaseForm(req.params.caseId, req.params.formId, req.body, req.user, req, "save_draft");
    res.json({ success: true, form, data: form });
  } catch (error) {
    next(error);
  }
}

async function autoSave(req, res, next) {
  try {
    const form = await uscisFormService.saveCaseForm(req.params.caseId, req.params.formId, req.body, req.user, req, "auto_save");
    res.json({ success: true, form, data: form });
  } catch (error) {
    next(error);
  }
}

async function saveSection(req, res, next) {
  try {
    const form = await uscisFormService.saveCaseForm(req.params.caseId, req.params.formId, req.body, req.user, req, "save_section");
    res.json({ success: true, form, data: form });
  } catch (error) {
    next(error);
  }
}

async function reviewCaseForm(req, res, next) {
  try {
    const form = await uscisFormService.reviewCaseForm(req.params.caseId, req.params.formId, req.body, req.user, req);
    res.json({ success: true, form, data: form });
  } catch (error) {
    next(error);
  }
}

async function validateCaseForm(req, res, next) {
  try {
    const result = await uscisFormService.validateCaseForm(req.params.caseId, req.params.formId, req.user);
    res.status(result.valid ? 200 : 422).json({ success: result.valid, ...result, data: result });
  } catch (error) {
    next(error);
  }
}

async function compareCaseForm(req, res, next) {
  try {
    const result = await uscisFormService.compareCaseForm(req.params.caseId, req.params.formId, req.user);
    res.json({ success: true, ...result, data: result });
  } catch (error) {
    next(error);
  }
}

async function openInteractiveForm(req, res, next) {
  try {
    const workspace = await interactiveFormReviewService.open(req.params.caseId, req.params.formId, req.user, req, { track: false, readOnlyOpen: true });
    res.json({ success: true, ...workspace });
  } catch (error) {
    next(error);
  }
}

async function saveInteractiveField(req, res, next) {
  try {
    const form = await interactiveFormReviewService.saveField(req.params.caseId, req.params.formId, req.body, req.user, req);
    res.json({ success: true, form, data: form });
  } catch (error) {
    next(error);
  }
}

async function saveInteractiveSection(req, res, next) {
  try {
    const form = await interactiveFormReviewService.saveSection(req.params.caseId, req.params.formId, req.body, req.user, req);
    res.json({ success: true, form, data: form });
  } catch (error) {
    next(error);
  }
}

async function reviewInteractiveField(req, res, next) {
  try {
    const form = await interactiveFormReviewService.reviewField(req.params.caseId, req.params.formId, req.body, req.user, req);
    res.json({ success: true, form, data: form });
  } catch (error) {
    next(error);
  }
}

async function reviewInteractiveSection(req, res, next) {
  try {
    const form = await interactiveFormReviewService.reviewSection(req.params.caseId, req.params.formId, req.body, req.user, req);
    res.json({ success: true, form, data: form });
  } catch (error) {
    next(error);
  }
}

async function decideInteractiveForm(req, res, next) {
  try {
    const form = await interactiveFormReviewService.formDecision(req.params.caseId, req.params.formId, req.body, req.user, req);
    res.json({ success: true, form, data: form });
  } catch (error) {
    next(error);
  }
}

async function lockInteractiveForm(req, res, next) {
  try {
    const form = await interactiveFormReviewService.setLock(req.params.caseId, req.params.formId, req.body.locked !== false, req.body, req.user, req);
    res.json({ success: true, form, data: form });
  } catch (error) {
    next(error);
  }
}

async function refreshInteractiveForm(req, res, next) {
  try {
    const result = await interactiveFormReviewService.refresh(req.params.caseId, req.params.formId, req.body, req.user, req);
    res.json({ success: true, ...result, data: result.caseForm });
  } catch (error) {
    next(error);
  }
}

async function resetInteractiveForm(req, res, next) {
  try {
    const result = await interactiveFormReviewService.reset(req.params.caseId, req.params.formId, req.body, req.user, req);
    res.json({ success: true, ...result, data: result.caseForm });
  } catch (error) {
    next(error);
  }
}

async function rollbackInteractiveField(req, res, next) {
  try {
    const form = await interactiveFormReviewService.rollbackField(req.params.caseId, req.params.formId, req.params.historyId, req.user, req);
    res.json({ success: true, form, data: form });
  } catch (error) {
    next(error);
  }
}

async function resolveInteractiveConflict(req, res, next) {
  try {
    const form = await interactiveFormReviewService.resolveConflict(req.params.caseId, req.params.formId, req.body, req.user, req);
    res.json({ success: true, form, data: form });
  } catch (error) {
    next(error);
  }
}

async function resolveInteractiveFieldConflict(req, res, next) {
  try {
    const form = await interactiveFormReviewService.resolveFieldConflict(req.params.caseId, req.params.formId, req.body, req.user, req);
    res.json({ success: true, form, data: form });
  } catch (error) {
    next(error);
  }
}

async function addInteractiveComment(req, res, next) {
  try {
    const comment = await interactiveFormReviewService.addComment(req.params.caseId, req.params.formId, req.body, req.user, req);
    res.status(201).json({ success: true, comment, data: comment });
  } catch (error) {
    next(error);
  }
}

async function resolveInteractiveComment(req, res, next) {
  try {
    const comment = await interactiveFormReviewService.resolveComment(req.params.caseId, req.params.formId, req.params.commentId, req.user, req);
    res.json({ success: true, comment, data: comment });
  } catch (error) {
    next(error);
  }
}

async function createInteractiveTask(req, res, next) {
  try {
    const task = await interactiveFormReviewService.createReviewTask(req.params.caseId, req.params.formId, req.body, req.user, req);
    res.status(201).json({ success: true, task, data: task });
  } catch (error) {
    next(error);
  }
}

function reviewDetails(type) {
  return async (req, res, next) => {
    try {
      const result = await interactiveFormReviewService.details(req.params.caseId, req.params.formId, type, req.query, req.user, req);
      res.json({ success: true, ...result, data: result });
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  ...templates,
  addInteractiveComment,
  activateTemplate,
  approveTemplate,
  archiveTemplate,
  autoSave,
  checkUpdates,
  compareCaseForm,
  createCaseForm,
  createFormMapping,
  deleteFormMapping,
  getRegistryHealth,
  getTemplateHealth,
  getVisaRegistry,
  getTemplatePdfUrl,
  listFormMappings,
  updateFormMapping,
  createInteractiveTask,
  decideInteractiveForm,
  getAllCaseForms,
  getCaseForms,
  getSyncHistory,
  getTemplatePdf,
  getVersions,
  getInteractiveComments: reviewDetails("comments"),
  getInteractiveComparison: reviewDetails("comparison"),
  getInteractiveHistory: reviewDetails("history"),
  getInteractiveSources: reviewDetails("sources"),
  getInteractiveValidation: reviewDetails("validation"),
  importDefinition,
  listActiveEditions,
  listArchivedEditions,
  listRegistry,
  lockInteractiveForm,
  openInteractiveForm,
  refreshInteractiveForm,
  renderCaseForm,
  resetInteractiveForm,
  resolveInteractiveConflict,
  resolveInteractiveFieldConflict,
  resolveInteractiveComment,
  reviewCaseForm,
  reviewInteractiveField,
  reviewInteractiveSection,
  rollbackTemplate,
  rollbackInteractiveField,
  saveDraft,
  saveInteractiveField,
  saveInteractiveSection,
  saveSection,
  syncForms,
  validateCaseForm,
  searchInteractiveFields: reviewDetails("search"),
  validateDefinition,
};
