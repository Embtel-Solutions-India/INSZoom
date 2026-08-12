const Case = require("../../models/Case");
const CaseForm = require("../../models/CaseForm");
const logger = require("../../utils/logger");
const USCISFormTemplate = require("../../models/USCISFormTemplate");
const { createCrudController } = require("../../utils/crudFactory");
const uscisFormService = require("./uscis-form.service");
const uscisFormImporterService = require("./uscis-form-importer.service");
const interactiveFormReviewService = require("./interactive-form-review.service");
const USCISScannerService = require("../uscis-lifecycle/services/USCISScannerService");
const VersionManagementService = require("../uscis-lifecycle/services/VersionManagementService");
const storageService = require("../uploads/storage.service");

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
    const buffer = await storageService.readBuffer(key);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${template.formCode}-${template.version}.pdf"`);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(buffer);
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
