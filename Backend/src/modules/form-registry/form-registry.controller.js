const Case = require("../../models/Case");
const CaseForm = require("../../models/CaseForm");
const VisaFormMapping = require("../../models/VisaFormMapping");
const USCISFormTemplate = require("../../models/USCISFormTemplate");
const USCISFormComponentDefinition = require("../../models/USCISFormComponentDefinition");
const caseService = require("../cases/case.service");
const visaFormMappingService = require("./visaFormMapping.service");
const OnDemandFormAcquisitionService = require("../uscis-form-import/services/OnDemandFormAcquisitionService");

function handleError(error, next) {
  if (error.status) return next(error);
  next(Object.assign(error, { status: 500 }));
}

async function loadAuthorizedCase(req) {
  const caseData = await Case.findById(req.params.id);
  if (!caseData) throw Object.assign(new Error("Case not found"), { status: 404 });
  if (!caseService.canAccessCase(req.user, caseData)) throw Object.assign(new Error("Not authorized to access forms for this case"), { status: 403 });
  return caseData;
}

// GET /api/cases/:id/form-mappings - full resolved registry state for a
// case (auto-create/conditional/later-stage/reference + which auto-create
// entries are actually renderable right now + diagnostics for the ones
// that aren't). Server-authoritative, read-only.
exports.getCaseFormMappings = async (req, res, next) => {
  try {
    const caseData = await loadAuthorizedCase(req);
    const resolved = await visaFormMappingService.resolveApplicableMappings(caseData);
    const provisioned = (caseData.uscisFormReferences || []).map((ref) => ref.label);
    res.json({
      success: true,
      data: {
        autoCreate: resolved.autoCreate,
        conditional: resolved.conditional,
        laterStage: resolved.laterStage,
        reference: resolved.reference,
        provisioned,
        diagnostics: visaFormMappingService.templateDiagnostics(resolved.autoCreate),
      },
    });
  } catch (error) {
    handleError(error, next);
  }
};

// GET /api/cases/:id/form-mappings/conditional - conditional-only view for
// the future "Additional Forms Available" UI.
exports.getConditionalFormMappings = async (req, res, next) => {
  try {
    const caseData = await loadAuthorizedCase(req);
    const { conditional } = await visaFormMappingService.resolveApplicableMappings(caseData);
    res.json({ success: true, data: conditional });
  } catch (error) {
    handleError(error, next);
  }
};

// POST /api/cases/:id/form-mappings/:mappingId/decision - the ONLY thing a
// client may send is {decision, reason}. Any client-supplied "which forms
// are required" field is explicitly rejected, never merely ignored.
exports.decideConditionalFormMapping = async (req, res, next) => {
  try {
    visaFormMappingService.assertNoClientProvidedForms(req.body);
    const caseData = await loadAuthorizedCase(req);
    const result = await visaFormMappingService.recordConditionalDecision(
      caseData,
      req.params.mappingId,
      req.body.decision,
      req.user,
      req.body.reason,
      req
    );
    res.json({ success: true, data: result });
  } catch (error) {
    handleError(error, next);
  }
};

// POST /api/cases/:id/form-mappings/:mappingId/provision - adds a single
// AUTO_CREATE-mapped form (templateStatus TEMPLATE_AVAILABLE, no CaseForm
// yet) independently of the bulk "Generate USCIS Forms" endpoint, which is
// correctly gated on unresolved canonical-profile conflicts that may have
// nothing to do with this specific form. See
// visaFormMappingService.provisionAvailableMapping's own comment.
exports.provisionMappedForm = async (req, res, next) => {
  try {
    const caseData = await loadAuthorizedCase(req);
    const result = await visaFormMappingService.provisionAvailableMapping(caseData, req.params.mappingId, req.user, req);
    res.json({ success: true, data: result });
  } catch (error) {
    handleError(error, next);
  }
};

// GET /api/form-registry/visa/:visaType - raw registry lookup, answers
// "what forms belong to X" (§23 of the spec). Not case-scoped, no
// authorization beyond authenticate (registry content is not sensitive).
exports.getMappingsForVisa = async (req, res, next) => {
  try {
    const mappings = await VisaFormMapping.find({ visaType: req.params.visaType, active: true }).sort({ displayOrder: 1, formNumber: 1 }).lean();
    res.json({ success: true, data: mappings });
  } catch (error) {
    handleError(error, next);
  }
};

// GET /api/form-registry/catalog - the Form Governance page's single data
// source: every real (formTemplateFormCode-bearing) VisaFormMapping row,
// grouped by form code, joined against its USCISFormTemplate (if any). Not
// case-scoped - this is "which forms exist in this system at all and what
// state are they in", not "what does this one case need". A form with no
// formTemplateFormCode (a SUPPLEMENT/FORM_COMPONENT/ONLINE_APPLICATION/
// GOVERNMENT_DOCUMENT/REFERENCE_DOCUMENT row - DS-160, ETA-9035, I-20, or a
// component sharing its parent's PDF) is excluded - there is nothing of its
// own to fetch, review, or map.
exports.getFormCatalog = async (req, res, next) => {
  try {
    const mappings = await VisaFormMapping.find({ active: true, formTemplateFormCode: { $ne: null } })
      .select("visaType formNumber formTemplateFormCode provisioningType processingPaths agency checklistMappings")
      .lean();
    const grouped = new Map();
    for (const mapping of mappings) {
      const formCode = String(mapping.formTemplateFormCode).toUpperCase();
      if (!grouped.has(formCode)) {
        grouped.set(formCode, { formCode, formNumber: mapping.formNumber, agency: mapping.agency, associations: [] });
      }
      grouped.get(formCode).associations.push({
        visaType: mapping.visaType,
        provisioningType: mapping.provisioningType,
        // Surfaced as the "automatic/conditional" label the operator asked
        // for - LATER_STAGE/REFERENCE are provisioning-registry concepts
        // too niche for this page, folded into "conditional" for display
        // (both mean "not auto-created on its own" from an operator's
        // point of view; PetitionAssemblyService/ensureAssignedForms still
        // treat all three on their own merits under the hood).
        automatic: mapping.provisioningType === "AUTO_CREATE",
        processingPaths: mapping.processingPaths || [],
        // Which client checklist(s) this specific visa/form combination
        // carries (VisaFormMapping.checklistMappings) - the same data
        // checklistMappings.seed.js populates and
        // resolveChecklistsForCase resolves at case creation; surfaced
        // here read-only so an operator can see the full visa->form->
        // checklist chain in one place, per the Form Governance spec.
        checklistMappings: (mapping.checklistMappings || []).map((entry) => ({
          checklistKey: entry.checklistKey,
          assignmentType: entry.assignmentType,
          role: entry.role || "",
        })),
      });
    }

    // Every USCISFormTemplate, not just ones a VisaFormMapping already
    // references - a form uploaded via "Upload Form" has no case-type
    // association yet (that's a separate, later step, via "Add case
    // type"), but it must still show up here with full mapping/approve/
    // activate access, exactly like any other form; it would otherwise be
    // invisible until someone maps it to a visa type first.
    const templates = await USCISFormTemplate.find({})
      .select("formCode title formName status mappingStatus officialStatus editionDate approvedAt activatedAt artifacts.form.status version updatedAt createdAt")
      .lean();
    // More than one USCISFormTemplate can share a formCode (e.g. right after
    // "Replace Form" publishes a new draft edition alongside the still-active
    // prior one) - deterministically prefer the live, in-service ("active")
    // template over any draft/review edition for this catalog view, never an
    // arbitrary find()-order pick (that exact ambiguity previously caused a
    // bulk mapping-regeneration script to silently corrupt a production
    // template's field mappings by picking the wrong document). Among
    // several non-active editions (e.g. two drafts), fall back to the same
    // recency convention findLatestActiveTemplate's sort already uses.
    const templateByCode = new Map();
    // The runner-up non-active candidate for a formCode that DOES have an
    // active template - i.e. a newer draft/review edition sitting behind
    // the one currently in service (exactly what "Replace Form" produces).
    // Surfaced separately so it's never silently invisible on the catalog.
    const pendingByCode = new Map();
    for (const template of templates) {
      const code = String(template.formCode).toUpperCase();
      const existing = templateByCode.get(code);
      if (!existing) { templateByCode.set(code, template); continue; }
      const existingActive = existing.status === "active";
      const candidateActive = template.status === "active";
      if (candidateActive && !existingActive) {
        pendingByCode.set(code, existing);
        templateByCode.set(code, template);
        continue;
      }
      if (existingActive && !candidateActive) {
        const prevPending = pendingByCode.get(code);
        if (!prevPending || new Date(template.editionDate || template.updatedAt || 0) > new Date(prevPending.editionDate || prevPending.updatedAt || 0)) {
          pendingByCode.set(code, template);
        }
        continue;
      }
      const existingDate = existing.editionDate || existing.updatedAt || existing.createdAt || 0;
      const candidateDate = template.editionDate || template.updatedAt || template.createdAt || 0;
      if (new Date(candidateDate).getTime() > new Date(existingDate).getTime()) templateByCode.set(code, template);
    }

    // A template with no VisaFormMapping row at all yet - freshly uploaded
    // via "Upload Form"/"Replace Form" and not yet assigned to any case
    // type. Still gets a full catalog entry (fetched, mappable, approvable,
    // activatable) - "Add case type" is what's still pending, not the
    // form's existence in this list.
    for (const code of templateByCode.keys()) {
      if (grouped.has(code)) continue;
      grouped.set(code, { formCode: code, formNumber: code, agency: "USCIS", associations: [] });
    }

    const standaloneCatalog = [...grouped.values()].map((entry) => {
      const template = templateByCode.get(entry.formCode);
      const pending = pendingByCode.get(entry.formCode);
      const artifactStatus = template?.artifacts?.form?.status;
      let fetchStatus;
      if (!template) fetchStatus = entry.agency === "USCIS" ? "not_fetched" : "not_fetchable";
      else if (["failed", "corrupted", "missing"].includes(artifactStatus)) fetchStatus = "fetch_failed";
      else fetchStatus = "fetched";
      return {
        formCode: entry.formCode,
        formNumber: entry.formNumber,
        agency: entry.agency,
        title: template?.title || template?.formName || entry.formNumber,
        templateId: template?._id || null,
        templateVersion: template?.version || null,
        fetchStatus,
        templateStatus: template?.status || null,
        mappingStatus: template?.mappingStatus || "unmapped",
        officialStatus: template?.officialStatus || null,
        editionDate: template?.editionDate || null,
        approvedAt: template?.approvedAt || null,
        activatedAt: template?.activatedAt || null,
        // A newer draft/review edition uploaded via "Replace Form" (or an
        // on-demand edition-change scan) that hasn't been approved/activated
        // yet - the currently-active template above stays in service until
        // this one is explicitly promoted.
        pendingTemplateId: pending?._id || null,
        pendingTemplateStatus: pending?.status || null,
        pendingEditionDate: pending?.editionDate || null,
        pendingApprovedAt: pending?.approvedAt || null,
        associations: entry.associations,
        isSupplement: false,
        parentFormCode: null,
        componentCode: null,
      };
    });

    // Supplement/component forms (e.g. I-129's H Classification Supplement) -
    // a VisaFormMapping row with componentCode set instead of
    // formTemplateFormCode, by design (see the model's own field comment):
    // it shares its parent's real USCISFormTemplate/PDF, sliced into its own
    // pages by USCISFormComponentDiscoveryService. "Fetched" here means the
    // parent's PDF has been fetched AND the discovery service has found and
    // sliced this exact supplement out of the parent's CURRENT active
    // edition - a definition discovered against a since-superseded edition
    // doesn't count (mirrors visaFormMapping.service.js's own
    // resolveActiveComponent semantics, re-derived here rather than reused
    // since that helper isn't exported and this is a read-only projection).
    const componentMappings = await VisaFormMapping.find({ active: true, componentCode: { $ne: null } })
      .select("visaType formNumber componentCode parentForm provisioningType processingPaths agency")
      .lean();
    const componentGroups = new Map();
    for (const mapping of componentMappings) {
      if (!componentGroups.has(mapping.componentCode)) {
        componentGroups.set(mapping.componentCode, { componentCode: mapping.componentCode, parentForm: mapping.parentForm, formNumber: mapping.formNumber, agency: mapping.agency, associations: [] });
      }
      componentGroups.get(mapping.componentCode).associations.push({
        visaType: mapping.visaType,
        provisioningType: mapping.provisioningType,
        automatic: mapping.provisioningType === "AUTO_CREATE",
        processingPaths: mapping.processingPaths || [],
      });
    }
    const componentDefs = componentGroups.size
      ? await USCISFormComponentDefinition.find({ componentCode: { $in: [...componentGroups.keys()] }, status: "ACTIVE" }).select("componentCode name parentTemplateId").sort({ discoveredAt: -1 }).lean()
      : [];
    const componentDefByCode = new Map();
    for (const def of componentDefs) if (!componentDefByCode.has(def.componentCode)) componentDefByCode.set(def.componentCode, def);

    const supplementCatalog = [...componentGroups.values()].map((entry) => {
      const parentCode = String(entry.parentForm || "").toUpperCase();
      const parentTemplate = templateByCode.get(parentCode);
      const componentDef = componentDefByCode.get(entry.componentCode);
      const isLive = Boolean(componentDef && parentTemplate && String(componentDef.parentTemplateId) === String(parentTemplate._id));
      let fetchStatus;
      if (!parentTemplate) fetchStatus = entry.agency === "USCIS" ? "not_fetched" : "not_fetchable";
      else if (!isLive) fetchStatus = "not_fetched";
      else fetchStatus = "fetched";
      return {
        formCode: entry.componentCode,
        formNumber: entry.formNumber,
        agency: entry.agency,
        title: componentDef ? `${componentDef.name} (supplement of ${parentCode})` : `${entry.formNumber} (supplement of ${parentCode})`,
        templateId: parentTemplate?._id || null,
        templateVersion: parentTemplate?.version || null,
        fetchStatus,
        templateStatus: parentTemplate?.status || null,
        mappingStatus: parentTemplate?.mappingStatus || "unmapped",
        officialStatus: parentTemplate?.officialStatus || null,
        editionDate: parentTemplate?.editionDate || null,
        approvedAt: parentTemplate?.approvedAt || null,
        activatedAt: parentTemplate?.activatedAt || null,
        associations: entry.associations,
        isSupplement: true,
        parentFormCode: parentCode,
        componentCode: entry.componentCode,
      };
    });

    const catalog = [...standaloneCatalog, ...supplementCatalog].sort((left, right) => left.formCode.localeCompare(right.formCode));

    res.json({ success: true, data: catalog });
  } catch (error) {
    handleError(error, next);
  }
};

// POST /api/form-registry/catalog/:formCode/fetch - admin-triggered, real-
// time (not the throttled background self-heal in visaFormMapping.service's
// registryAutoCreateTemplates) uscis.gov fetch for one form code, so an
// operator gets an immediate, visible result (success, or a real error)
// instead of waiting on the hourly-cooldown background attempt. Mirrors
// OnDemandFormAcquisitionService.acquireForCase's own agency gate, since
// acquireAndActivate itself (used here, deliberately NOT acquireForCase -
// that one also re-runs ensureAssignedForms against a specific case, which
// has no meaning outside a case context) never checks agency itself.
exports.fetchFormFromUSCIS = async (req, res, next) => {
  try {
    const formCode = String(req.params.formCode || "").trim();
    const mapping = await VisaFormMapping.findOne({ formTemplateFormCode: formCode.toLowerCase(), active: true }).select("agency").lean();
    if (!mapping) throw Object.assign(new Error(`No active registry mapping references form code "${formCode}"`), { status: 404 });
    if (mapping.agency !== "USCIS") {
      throw Object.assign(new Error(`${formCode.toUpperCase()} is a ${mapping.agency} form, not a downloadable USCIS PDF - it can't be fetched from uscis.gov.`), { status: 422, code: "USCIS_FORM_WRONG_AGENCY" });
    }
    const result = await OnDemandFormAcquisitionService.acquireAndActivate(formCode, req.user, req);
    res.json({
      success: true,
      data: {
        alreadyActive: result.alreadyActive,
        requiresActivation: result.requiresActivation,
        activationBlockedReason: result.activationBlockedReason,
        biographicReady: result.biographicReady,
        template: result.template && {
          id: result.template._id,
          formCode: result.template.formCode,
          status: result.template.status,
          mappingStatus: result.template.mappingStatus,
        },
      },
    });
  } catch (error) {
    handleError(error, next);
  }
};

// Derives the single status chip the Forms tab renders per row from a
// registry mapping entry + whatever CaseForm (if any) already exists for
// it. Never mutates anything — read-only projection over
// resolveApplicableMappings' own output.
//
// agency !== "USCIS" (DOS's DS-160/DS-156E, DOL's ETA-9035/ETA-790, ...)
// deliberately never resolves to ACQUIRE_FROM_USCIS - confirmed live
// against this DB's real K-1 registry mappings: DS-160 is a DOS online
// application with no downloadable PDF at all, so offering "Fetch from
// USCIS" for it would always fail (OnDemandFormAcquisitionService only
// ever fetches from *.uscis.gov, per Constraint #5). NOT_FETCHABLE_HERE
// tells the UI to explain that instead of offering a doomed button.
function deriveUiStatus({ bucket, templateStatus, decision, caseForm, agency }) {
  if (caseForm) {
    if (caseForm.status === "archived") return "CONDITIONAL_PENDING"; // condition no longer met, see reconcileConditionalForms
    // Biographic Activation tier (BiographicMappingService): the CaseForm's
    // template never reached full production "active" status - a distinct
    // chip so the workspace makes clear this form still needs a curated
    // mapping review before it's ready for filing, never conflated with a
    // fully-activated AUTOFILLED form.
    if (caseForm.formTemplateId?.mappingStatus === "biographic_active") return "BIOGRAPHIC_READY";
    return (caseForm.completion?.percent || 0) > 0 || caseForm.status !== "pending" ? "AUTOFILLED" : "PROVISIONED";
  }
  if (bucket === "conditional") {
    if (decision === "NOT_APPLICABLE") return "REFERENCE";
    // Approved (decision "ADD") but no CaseForm exists yet: recordConditionalDecision
    // only provisions a CaseForm when a fully-active template is already on
    // file (ensureAssignedForms' single-template path never routes a
    // status:"review"/mappingStatus:"biographic_active" template - see
    // OnDemandFormAcquisitionService.acquireForCase's own comment on why
    // that's a deliberate, separate path). A freshly-registered form like
    // I-131 will commonly be in exactly this state right after approval -
    // offer the same "Acquire from USCIS" action the autoCreate bucket
    // already uses (same endpoint, same agency gate) rather than leaving
    // the Case Manager with an "Approved" chip and no way to actually get
    // the form provisioned.
    if (decision === "ADD" && agency === "USCIS") return "ACQUIRE_FROM_USCIS";
    return "CONDITIONAL_PENDING";
  }
  if (bucket === "laterStage") return "LATER_STAGE";
  if (bucket === "reference") return "REFERENCE";
  // bucket === "autoCreate"
  if (templateStatus === "TEMPLATE_AVAILABLE") return "AVAILABLE_TO_PROVISION";
  if (templateStatus === "TEMPLATE_RULE_CONFLICT") return "RULE_CONFLICT";
  if (agency !== "USCIS") return "NOT_FETCHABLE_HERE"; // TEMPLATE_MISSING, but not a USCIS form
  return "ACQUIRE_FROM_USCIS"; // TEMPLATE_MISSING
}

function toOverviewEntry(bucket, entry, caseFormsByCode) {
  const mapping = entry.mapping;
  const formCode = String(mapping.formTemplateFormCode || mapping.formNumber || "").toUpperCase();
  const caseForm = caseFormsByCode.get(formCode) || null;
  return {
    mappingId: mapping._id,
    formNumber: mapping.formNumber,
    formName: mapping.formName,
    agency: mapping.agency,
    componentType: mapping.componentType,
    provisioningType: mapping.provisioningType,
    displayOrder: mapping.displayOrder || 0,
    // Best-effort convenience link built from USCIS's own URL convention
    // (see OnDemandFormAcquisitionService.guessedFormPageUrl) - not a
    // network call, so this can never be wrong in a way that blocks
    // anything; "Fetch from USCIS" does the real, verified resolution. Only
    // offered for USCIS-agency forms - a guessed uscis.gov link for a DOS/
    // DOL form (DS-160, ETA-9035, ...) would point at the wrong agency's
    // site entirely.
    officialPageUrl: mapping.agency === "USCIS" ? OnDemandFormAcquisitionService.guessedFormPageUrl(mapping.formNumber) : null,
    templateStatus: entry.templateStatus || null,
    decision: entry.decision || null,
    caseForm: caseForm
      ? {
          id: caseForm._id,
          status: caseForm.status,
          editionDate: caseForm.formEditionDate,
          completionPct: caseForm.completion?.percent || 0,
          mappingStatus: caseForm.formTemplateId?.mappingStatus || null,
        }
      : null,
    uiStatus: deriveUiStatus({ bucket, templateStatus: entry.templateStatus, decision: entry.decision, caseForm, agency: mapping.agency }),
  };
}

// GET /api/cases/:id/forms-overview - Phase 1: the full registry-resolved
// form set for this case's visa, provisioned or not, one row per applicable
// VisaFormMapping - not just the CaseForms that already happen to exist
// (that's listCaseForms' narrower job, still used as-is by the interactive
// workspace/renderCaseForm). Read-only; provisioning/acquisition are
// separate POST actions below and in uscis-form-import.
//
// Independent-USCIS-forms-only, per the VisaFormMapping architecture
// correction: this is the Case Manager/Team Lead/Admin-facing "USCIS Forms"
// list (all three share this one endpoint/component), so it must never show
// a USCIS supplement (I-129 H Classification Supplement, ...), a genuinely
// dependent USCIS form (I-130A, I-539A, I-864A, I-918 Supplement A/B), or a
// non-USCIS document (DS-160, ETA-9035, I-20, I-983) as if it were an
// independently filed form. Uses resolveVisaFormMappings (parent-visa-aware
// - e.g. P-1A inherits P-1's I-129 when P-1A has no mapping of its own) and
// filters through isIndependentUSCISForm before building rows.
exports.getFormsOverview = async (req, res, next) => {
  try {
    const caseData = await loadAuthorizedCase(req);
    const resolved = await visaFormMappingService.resolveVisaFormMappings(caseData);
    const independentEntries = visaFormMappingService.independentFormsFrom(resolved);
    const existingForms = await CaseForm.find({ caseId: caseData._id })
      .select("formCode status formEditionDate completion formTemplateId")
      .populate({ path: "formTemplateId", select: "mappingStatus" })
      .lean();
    const caseFormsByCode = new Map(existingForms.map((form) => [String(form.formCode).toUpperCase(), form]));

    const bucketByMappingId = new Map();
    for (const bucketName of ["autoCreate", "conditional", "laterStage", "reference"]) {
      for (const entry of resolved[bucketName]) bucketByMappingId.set(String(entry.mapping._id), bucketName);
    }

    const items = independentEntries
      .map((entry) => toOverviewEntry(bucketByMappingId.get(String(entry.mapping._id)), entry, caseFormsByCode))
      .sort((left, right) => (left.displayOrder || 0) - (right.displayOrder || 0) || String(left.formNumber).localeCompare(String(right.formNumber)));

    res.json({
      success: true,
      data: {
        items,
        diagnostics: visaFormMappingService.templateDiagnostics(resolved.autoCreate.filter((entry) => visaFormMappingService.isIndependentUSCISForm(entry.mapping))),
        resolvedVisaType: resolved.resolvedVisaType,
        usedParentFallback: resolved.usedParentFallback,
        unresolved: resolved.unresolved,
        // Bulk "provision + curated-autofill everything available right
        // now" already exists as its own well-tested endpoint
        // (CaseLifecycleOrchestrator.generateForms, wired to the Forms
        // tab's existing "Generate USCIS Forms"/"Refresh Auto Fill"
        // button) - surfaced here so the frontend never has to hardcode
        // this path, rather than this endpoint duplicating that logic.
        bulkProvisionEndpoint: `/cases/${caseData._id}/workflow/generate-forms`,
      },
    });
  } catch (error) {
    handleError(error, next);
  }
};

// POST /api/cases/:id/forms/acquire {formNumber} - Phase 2: on-demand live
// fetch for a mapped form whose template is TEMPLATE_MISSING. Delegates
// entirely to OnDemandFormAcquisitionService; this controller only handles
// input validation + the case-authorization boundary all other case-scoped
// routes in this file already use.
exports.acquireCaseForm = async (req, res, next) => {
  try {
    const caseData = await loadAuthorizedCase(req);
    const formNumber = String(req.body?.formNumber || "").trim();
    if (!formNumber) {
      const error = new Error("formNumber is required");
      error.status = 400;
      throw error;
    }
    const result = await OnDemandFormAcquisitionService.acquireForCase(caseData._id, formNumber, req.user, req);
    res.json({ success: true, data: result });
  } catch (error) {
    handleError(error, next);
  }
};
