const MappingGraphService = require("../services/MappingGraphService");
const AutoFillService = require("../services/AutoFillService");
const ChecklistFieldTraceabilityService = require("../services/ChecklistFieldTraceabilityService");
const FormEditionComparisonService = require("../services/FormEditionComparisonService");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const Case = require("../../../models/Case");
const caseService = require("../../cases/case.service");

function send(res, payload) {
  res.json({ success: true, ...payload });
}

exports.generate = async (req, res, next) => {
  try {
    const result = await MappingGraphService.generate(req.params.templateId, req.body || {}, req.user, req);
    send(res, result);
  } catch (error) {
    next(error);
  }
};

exports.validate = async (req, res, next) => {
  try {
    const result = await MappingGraphService.validate(req.params.templateId, req.body || {});
    send(res, result);
  } catch (error) {
    next(error);
  }
};

exports.preview = async (req, res, next) => {
  try {
    const result = await MappingGraphService.preview(req.params.templateId);
    send(res, result);
  } catch (error) {
    next(error);
  }
};

exports.search = async (req, res, next) => {
  try {
    const result = await MappingGraphService.search(req.params.templateId, req.query || {});
    send(res, result);
  } catch (error) {
    next(error);
  }
};

exports.compare = async (req, res, next) => {
  try {
    const result = await MappingGraphService.compare(req.params.templateId, req.params.otherTemplateId);
    send(res, result);
  } catch (error) {
    next(error);
  }
};

exports.deleteMapping = async (req, res, next) => {
  try {
    const result = await MappingGraphService.deleteMapping(req.params.templateId, req.params.mappingId, req.user, req);
    send(res, result);
  } catch (error) {
    next(error);
  }
};

exports.upsertMapping = async (req, res, next) => {
  try {
    const result = await MappingGraphService.upsertMapping(req.params.templateId, req.body || {}, req.user, req);
    send(res, result);
  } catch (error) {
    next(error);
  }
};

exports.versions = async (req, res, next) => {
  try {
    const result = await MappingGraphService.versions(req.params.templateId);
    send(res, result);
  } catch (error) {
    next(error);
  }
};

exports.activate = async (req, res, next) => {
  try {
    const result = await MappingGraphService.activate(req.params.templateId, req.user, req);
    send(res, result);
  } catch (error) {
    next(error);
  }
};

// GET /form-mappings/templates/:templateId/autofill-preview?caseId=... - a
// read-only "what would this form's fields fill in for this real case"
// check, so a human can judge whether a mapping is actually correct before
// activating it. Reuses AutoFillService.preview (pure computation, no
// CaseForm write) - never the mutating generate() path. Passes the
// template's own version explicitly: FormMappingService.loadTemplate
// defaults to status:"active" when no version is given, which would 404 for
// exactly the draft/review templates this page exists to review.
exports.autofillPreview = async (req, res, next) => {
  try {
    const template = await USCISFormTemplate.findById(req.params.templateId).select("formCode version").lean();
    if (!template) throw Object.assign(new Error("USCIS form template not found"), { status: 404 });
    const caseId = req.query.caseId;
    if (!caseId) throw Object.assign(new Error("caseId is required"), { status: 400 });
    const caseData = await Case.findById(caseId).select("_id user assignedCaseManager assignedTeamLead companyId employerUser attorney assignedAttorney").lean();
    if (!caseData) throw Object.assign(new Error("Case not found"), { status: 404 });
    if (!caseService.canAccessCase(req.user, caseData)) throw Object.assign(new Error("Not authorized to access this case"), { status: 403 });
    const result = await AutoFillService.preview(caseId, template.formCode, template.version);
    send(res, { caseId, ...result });
  } catch (error) {
    next(error);
  }
};

// Checklist <-> field traceability (Visa-Form-Checklist intelligence
// layer, Phase 1) - governance/query endpoints only, read-only, no
// mutation and no mapping activation of any kind.

// GET /form-mappings/templates/:templateId/checklist-trace/field/:targetFieldId
// Direction B: USCIS Form Field -> Canonical -> Checklist Question(s).
exports.traceFieldToQuestions = async (req, res, next) => {
  try {
    const result = await ChecklistFieldTraceabilityService.traceFieldToQuestions(req.params.templateId, req.params.targetFieldId);
    send(res, result);
  } catch (error) {
    next(error);
  }
};

// GET /form-mappings/templates/:templateId/checklist-trace/questionnaire/:questionnaireKey
// Direction A: Checklist Question -> Canonical -> USCIS Form Field(s).
exports.traceQuestionsToFields = async (req, res, next) => {
  try {
    const result = await ChecklistFieldTraceabilityService.traceQuestionsToFields(req.params.questionnaireKey, req.params.templateId);
    send(res, result);
  } catch (error) {
    next(error);
  }
};

// GET /form-mappings/templates/:templateId/checklist-trace/coverage
exports.checklistTraceCoverage = async (req, res, next) => {
  try {
    const result = await ChecklistFieldTraceabilityService.coverageSummary(req.params.templateId);
    if (!result) throw Object.assign(new Error("USCIS form template not found"), { status: 404 });
    send(res, result);
  } catch (error) {
    next(error);
  }
};

// GET /form-mappings/templates/:templateId/checklist-trace/fields - every
// mapped field on this template with its checklist-question match(es) in
// one call, for a governance table (plan §7).
exports.traceAllFieldsForTemplate = async (req, res, next) => {
  try {
    const result = await ChecklistFieldTraceabilityService.traceAllFieldsForTemplate(req.params.templateId);
    send(res, result);
  } catch (error) {
    next(error);
  }
};

// GET /form-mappings/checklist-trace/coverage - system-wide, every active
// USCIS form template (not one form) - the actual answer to "across all
// visas/forms/checklists, how much of the mapping is traceable to a real
// checklist question".
exports.checklistTraceCoverageAll = async (req, res, next) => {
  try {
    const results = await ChecklistFieldTraceabilityService.coverageSummaryForAllForms();
    send(res, { results });
  } catch (error) {
    next(error);
  }
};

// Phase 3H/3I governance additions - read-only diagnostics only, alongside
// the checklist-trace endpoints above. No mutation route is added: this UI
// never auto-fixes anything.

// GET /form-mappings/templates/:templateId/checklist-trace/defects - every
// governance defect category for ONE form's real registry rows/mapping
// graph, with intentional/documented gaps reported separately from actual
// defects.
exports.governanceDefects = async (req, res, next) => {
  try {
    const result = await ChecklistFieldTraceabilityService.governanceDefects(req.params.templateId);
    if (!result) throw Object.assign(new Error("USCIS form template not found"), { status: 404 });
    send(res, result);
  } catch (error) {
    next(error);
  }
};

// GET /form-mappings/checklist-health - system-wide, one row per production
// checklist/questionnaire (Phase 3I "Checklist Health").
exports.checklistHealth = async (req, res, next) => {
  try {
    const rows = await ChecklistFieldTraceabilityService.checklistHealth();
    send(res, { rows });
  } catch (error) {
    next(error);
  }
};

// USCIS form edition-change governance (Phase 3J) - read-only diff preview
// plus the human-acknowledgement step. Never activates anything; that
// remains exclusively MappingGraphService.activate()'s job.

// GET /form-mappings/templates/:templateId/edition-diff?previousTemplateId=...
// Defaults to this template's own parentVersion (set at import time by
// FormVersionService.createTemplate); previousTemplateId lets a reviewer
// diff against a different prior document when parentVersion wasn't
// recorded (older, pre-lifecycle-field templates).
exports.editionDiff = async (req, res, next) => {
  try {
    const comparison = await FormEditionComparisonService.compareToParent(req.params.templateId, {
      previousTemplateId: req.query.previousTemplateId,
    });
    send(res, {
      templateId: req.params.templateId,
      hasParentEdition: Boolean(comparison),
      comparison,
    });
  } catch (error) {
    next(error);
  }
};

// POST /form-mappings/templates/:templateId/edition-diff/acknowledge - the
// explicit human-review step that lifts MappingGraphService.activate()'s
// additive edition-change gate for this template's specific parentVersion.
exports.acknowledgeEditionDiff = async (req, res, next) => {
  try {
    const result = await FormEditionComparisonService.acknowledge(req.params.templateId, req.user, req);
    send(res, result);
  } catch (error) {
    next(error);
  }
};
