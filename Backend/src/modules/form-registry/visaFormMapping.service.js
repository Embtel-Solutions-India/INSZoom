// Applicability resolution for the VisaFormMapping registry - the SOLE
// authority on whether a form applies to a visa/case. USCISFormTemplate
// existence/assignmentRules are evaluated separately, afterward, purely as
// a technical "can we actually render this yet" diagnostic - they never
// feed back into or override a registry applicability decision. See the
// VisaFormMapping implementation plan for the full rationale.
const VisaFormMapping = require("../../models/VisaFormMapping");
const Questionnaire = require("../../models/Questionnaire");
const USCISFormComponentDefinition = require("../../models/USCISFormComponentDefinition");
const uscisFormService = require("../uscis-forms/uscis-form.service");
const { resolveWithHierarchyFallback } = require("../../config/visaHierarchy");
const { permStageFlags } = require("../../config/permStages");

// A CONDITIONAL mapping's formNumber that also has its own non-default,
// explicit-assignment-only client checklist (see i131Checklist.js's file
// banner for why I-131's Questionnaire is deliberately never isDefault).
// I-907/G-28/I-539/I-539A have no such entry - they have no client-facing
// checklist need, so this map (and the branch that reads it below) is a
// no-op for them, never a behavior change to their existing flow.
const CONDITIONAL_FORM_CHECKLIST_KEYS = {
  "I-131": "i131_checklist",
  "N-565": "n565_checklist",
};

// Mirrors the whitelist in VisaFormMapping.js exactly - a trigger may only
// ever reference one of these. premiumProcessing gets the same fallback
// chain templateAppliesToCase already uses elsewhere in this codebase, for
// consistency (not reinvented).
function readWhitelistedField(caseData, field) {
  switch (field) {
    case "premiumProcessing":
      return Boolean(caseData.plan?.premiumProcessing || caseData.premiumProcessing);
    case "attorneyOnRecord":
      return Boolean(caseData.assignedAttorney || caseData.attorney);
    // Same resolution immigration-knowledge-engine.service.js's own
    // requiresNewOfficePetition gate already uses (line ~135) - reused,
    // not re-derived, so this and the L-1A business-plan-checklist
    // questionnaire-assignment gate can never disagree about whether a
    // case is a New Office petition.
    case "newOfficePetition":
      return String(caseData.assessmentAnswers?.newOfficePetition || caseData.questionnaireData?.masterData?.newOfficePetition || "").trim().toLowerCase() === "yes";
    case "hasJointSponsor":
      return Boolean(caseData.jointSponsorUser);
    case "permCertified":
    case "permAdjustmentStage":
    case "permEmploymentAuthorization":
    case "permAdvanceParole":
      return permStageFlags(caseData)[field];
    case "visaType":
    case "visaCategory":
    case "caseType":
    case "petitionType":
    case "petitionSubType":
    case "processingPath":
      return caseData[field];
    default:
      // Unreachable in practice - the schema-level validator on
      // triggerCondition already rejects any non-whitelisted field before a
      // mapping can be saved. Fails closed (never-matches) rather than
      // throwing, so a corrupted/legacy document can't crash provisioning.
      return undefined;
  }
}

function evaluateTrigger(node, caseData) {
  if (node === null || node === undefined) return true; // no trigger = always applies
  if (Array.isArray(node.all)) return node.all.every((child) => evaluateTrigger(child, caseData));
  if (Array.isArray(node.any)) return node.any.some((child) => evaluateTrigger(child, caseData));
  const actual = readWhitelistedField(caseData, node.field);
  switch (node.operator) {
    case "equals":
      return String(actual ?? "") === String(node.value ?? "") || actual === node.value;
    case "notEquals":
      return !(String(actual ?? "") === String(node.value ?? "") || actual === node.value);
    case "in":
      return Array.isArray(node.value) && node.value.some((v) => String(v) === String(actual));
    case "notIn":
      return !(Array.isArray(node.value) && node.value.some((v) => String(v) === String(actual)));
    case "exists":
      return node.value ? actual !== undefined && actual !== null && actual !== "" : (actual === undefined || actual === null || actual === "");
    default:
      return false;
  }
}

function processingPathApplies(mapping, caseData) {
  if (!mapping.processingPaths || !mapping.processingPaths.length) return true; // wildcard
  return mapping.processingPaths.includes(caseData.processingPath);
}

function isRegistryApplicable(mapping, caseData) {
  if (!mapping.active) return false;
  if (mapping.visaType !== caseData.visaType) return false;
  if (!processingPathApplies(mapping, caseData)) return false;
  return evaluateTrigger(mapping.triggerCondition, caseData);
}

function decisionFor(caseData, mappingId) {
  const entry = (caseData.conditionalFormDecisions || []).find((d) => String(d.mappingId) === String(mappingId));
  return entry ? entry.decision : null; // absence = pending, never a stored PENDING record
}

// Live, uncached per call - templateStatus/decision are never written back
// onto the mapping document itself, and never change whether a mapping is
// REGISTRY_APPLICABLE (that decision, above, is already final by the time
// this runs).
async function resolveApplicableMappings(caseData) {
  const mappings = await VisaFormMapping.find({ visaType: caseData.visaType, active: true }).lean();
  const applicable = mappings.filter((mapping) => isRegistryApplicable(mapping, caseData));

  const autoCreate = [];
  const conditional = [];
  const laterStage = [];
  const reference = [];

  for (const mapping of applicable) {
    if (mapping.provisioningType === "AUTO_CREATE") {
      autoCreate.push({ mapping, templateStatus: await resolveTemplateStatus(mapping, caseData) });
    } else if (mapping.provisioningType === "CONDITIONAL") {
      // templateStatus is also resolved here now (not just decision) - a
      // CONDITIONAL form is auto-created the same as AUTO_CREATE once its
      // template is available (see registryAutoCreateTemplates), so the
      // caller needs the same readiness signal it already computes for
      // AUTO_CREATE. `decision` is preserved purely so a case manager can
      // still explicitly mark a mapping NOT_APPLICABLE to opt a specific
      // case out of auto-creation - it is no longer what GATES creation.
      conditional.push({ mapping, decision: decisionFor(caseData, mapping._id), templateStatus: await resolveTemplateStatus(mapping, caseData) });
    } else if (mapping.provisioningType === "LATER_STAGE") {
      // No-criteria provisioning: a LATER_STAGE form used to have no path
      // onto the case at all until a bespoke UI action was built for its
      // specific stage. It's now treated exactly like AUTO_CREATE/CONDITIONAL
      // - created the moment its template is available, regardless of case
      // stage - so templateStatus is resolved here too.
      laterStage.push({ mapping, templateStatus: await resolveTemplateStatus(mapping, caseData) });
    } else if (mapping.provisioningType === "REFERENCE") {
      reference.push({ mapping });
    }
    // NOT_APPLICABLE mappings are, definitionally, filtered out by
    // isRegistryApplicable's active/visaType/trigger checks having no
    // reason to include them in practice; NOT_APPLICABLE records exist in
    // the registry purely for documentation/validator completeness.
  }

  return { autoCreate, conditional, laterStage, reference };
}

// Resolves a mapping's componentCode to its real, currently-ACTIVE
// USCISFormComponentDefinition against the parent form's CURRENT active
// template - live, at read time, never cached on the mapping itself. This
// is what makes a USCIS edition change safe: a new parent template version
// simply has no ACTIVE component definitions yet (until
// USCISFormComponentDiscoveryService is re-run against it), so this
// resolves to null and the mapping correctly reports TEMPLATE_MISSING
// rather than silently reusing a previous edition's page ranges.
async function resolveActiveComponent(parentFormCode, componentCode) {
  if (!parentFormCode || !componentCode) return null;
  const parentTemplate = await uscisFormService.findLatestActiveTemplate(parentFormCode);
  if (!parentTemplate) return null;
  const component = await USCISFormComponentDefinition.findOne({ parentTemplateId: parentTemplate._id, componentCode, status: "ACTIVE" }).lean();
  return component ? { component, parentTemplate } : null;
}

// TEMPLATE_MISSING | TEMPLATE_AVAILABLE | TEMPLATE_RULE_CONFLICT - see the
// implementation plan (§ Applicability resolution) for what each means.
// Never mutates or reclassifies the registry mapping.
async function resolveTemplateStatus(mapping, caseData) {
  // A component mapping (componentCode set) shares its parent's template -
  // it has no formTemplateFormCode of its own by design (see the field's
  // own doc comment on VisaFormMapping.js) - so its availability depends on
  // the parent template existing/applying AND the specific component still
  // being ACTIVE for that exact template version, not on formTemplateFormCode
  // at all.
  if (mapping.componentCode) {
    const resolved = await resolveActiveComponent(mapping.parentForm, mapping.componentCode);
    if (!resolved) return "TEMPLATE_MISSING";
    return uscisFormService.templateAppliesToCase(resolved.parentTemplate, caseData) ? "TEMPLATE_AVAILABLE" : "TEMPLATE_RULE_CONFLICT";
  }
  if (!mapping.formTemplateFormCode) return "TEMPLATE_MISSING";
  const template = await uscisFormService.findLatestActiveTemplate(mapping.formTemplateFormCode);
  if (!template) return "TEMPLATE_MISSING";
  return uscisFormService.templateAppliesToCase(template, caseData) ? "TEMPLATE_AVAILABLE" : "TEMPLATE_RULE_CONFLICT";
}

// Structured diagnostics for AUTO_CREATE mappings that are registry-
// applicable but currently cannot produce a CaseForm - surfaced via the
// debug endpoint, never silently dropped (§19).
function templateDiagnostics(autoCreateEntries) {
  return autoCreateEntries
    .filter((entry) => entry.templateStatus !== "TEMPLATE_AVAILABLE")
    .map((entry) => ({
      mappingId: entry.mapping._id,
      visaType: entry.mapping.visaType,
      formNumber: entry.mapping.formNumber,
      provisioningType: entry.mapping.provisioningType,
      reason: entry.templateStatus,
    }));
}

function isEmptyResolution(resolved) {
  return !resolved.autoCreate.length && !resolved.conditional.length && !resolved.laterStage.length && !resolved.reference.length;
}

// Parent-visa-aware wrapper around resolveApplicableMappings - tries the
// case's exact visaType first (unchanged behavior), and only when that
// returns nothing at all (every bucket empty) walks up the canonical
// visa hierarchy (visaHierarchy.js) to a parent classification, e.g.
// P-1A -> P-1. A visa with its own dedicated mapping (L-1A, EB-2 NIW, ...)
// never inherits its parent's/sibling's forms - the walker only advances
// when the current level is genuinely empty. See §9/§12/§14 of the
// VisaFormMapping architecture correction plan.
async function resolveVisaFormMappings(caseData) {
  // .toObject() first when available (a real Mongoose document's schema
  // paths aren't reliably spread-safe otherwise) - readWhitelistedField
  // above only ever reads plain scalar/nested fields off the result, so a
  // plain object clone is sufficient and never needs Mongoose document
  // methods.
  const plainCase = typeof caseData.toObject === "function" ? caseData.toObject() : caseData;
  const lookup = (visaType) => resolveApplicableMappings({ ...plainCase, visaType });
  const { result, resolvedVisaType, usedFallback, unresolved } = await resolveWithHierarchyFallback(caseData.visaType, lookup, isEmptyResolution);
  return { ...result, resolvedVisaType, usedParentFallback: usedFallback, unresolved };
}

// The ONLY predicate that decides "independent USCIS form" anywhere in the
// app - agency must be USCIS, componentType must be STANDALONE_FORM (not a
// SUPPLEMENT/FORM_COMPONENT/ONLINE_APPLICATION/GOVERNMENT_DOCUMENT/
// REFERENCE_DOCUMENT), and parentForm must be unset. The parentForm check
// is a defensive belt-and-suspenders layer: a mapping mis-tagged
// STANDALONE_FORM without also clearing parentForm can never slip through
// as independent.
function isIndependentUSCISForm(mapping) {
  return Boolean(mapping) && mapping.agency === "USCIS" && mapping.componentType === "STANDALONE_FORM" && !mapping.parentForm;
}

// Flattens resolveApplicableMappings'/resolveVisaFormMappings' 4 buckets
// into the independent-forms-only projection every "USCIS Forms" surface
// must use, deduped by formNumber (defensive - the hierarchy walker never
// mixes an exact-match result with a parent-fallback result in the same
// response, so this never actually fires today, but guards against any
// future seed data that duplicates a formNumber across rows).
function independentFormsFrom(resolved) {
  const allEntries = [...resolved.autoCreate, ...resolved.conditional, ...resolved.laterStage, ...resolved.reference];
  const seen = new Set();
  const independent = [];
  for (const entry of allEntries) {
    if (!isIndependentUSCISForm(entry.mapping)) continue;
    if (seen.has(entry.mapping.formNumber)) continue;
    seen.add(entry.mapping.formNumber);
    independent.push(entry);
  }
  return independent;
}

// Builds the exact shape ensureAssignedForms' merge step needs: real
// USCISFormTemplate documents (not mapping records) for every AUTO_CREATE
// entry that is TEMPLATE_AVAILABLE right now, tagged with the registry
// provenance so the CaseForm creation loop can populate `provisioning`.
// Uses resolveVisaFormMappings (parent-fallback aware) rather than the raw
// exact-match resolver, so a case whose exact visaType has no mapping of
// its own (e.g. P-1A) still gets its parent's (P-1's) forms auto-created.
//
// Deliberately NOT gated by isIndependentUSCISForm here: a genuinely
// dependent form with its own real PDF/template (e.g. I-918 Supplement B,
// AUTO_CREATE alongside its parent I-918 for every U-1 case) still needs its
// own CaseForm. The independence filter belongs only where "is this
// independently offered/listed as its own form" is the question - see
// isIndependentUSCISForm's callers in form-registry.controller.js.
//
// A componentCode entry (e.g. I-129's H Classification Supplement) is
// different from both of the above: it has no USCISFormTemplate of its own
// at all - it shares its parent's. For these, the "template" object pushed
// here is the PARENT template itself (so formTemplateId correctly points at
// the one real, shared PDF/template), annotated with `_componentInfo` so
// ensureAssignedForms' create loop below can give the resulting CaseForm
// its own distinct formCode (the componentCode) instead of colliding with
// the parent's, and set parentFormCode/componentCode/componentType.
// No-criteria provisioning: CONDITIONAL and LATER_STAGE mappings are now
// auto-created the same as AUTO_CREATE, the instant their template is
// TEMPLATE_AVAILABLE - no case-manager click, no case-stage gating. A
// CONDITIONAL mapping the case manager has explicitly marked
// NOT_APPLICABLE (recordConditionalDecision) is still respected and
// skipped - that remains a real, deliberate opt-out, not a readiness gate.
// Per-process, per-form-code cooldown for the self-heal acquisition kicked
// off below - deliberately NOT the OnDemandFormAcquisitionService TTL
// (that TTL only throttles the "existing template, check for a new
// edition" path; a genuinely MISSING template has no TTL guard at all and
// retries on every single call - see ensureCurrentUSCISFormInner). Without
// this, every case-creation/assignment/generateForms call for a visa type
// whose forms aren't seeded locally would re-attempt a live uscis.gov fetch
// for every one of its missing form codes, unthrottled. One hour is
// generous enough that a real acquisition failure (USCIS unreachable, a
// non-standard form-page URL) doesn't turn into a hot-path network call on
// every request, while still self-healing well within a normal workday.
const ACQUISITION_COOLDOWN_MS = 60 * 60 * 1000;
const lastAcquisitionAttempt = new Map();

// Fire-and-forget: never awaited by the caller, never throws into it.
// Deliberately calls ensureCurrentUSCISForm (fetch/activate only) rather
// than acquireForCase (which also re-runs ensureAssignedForms) - the latter
// would recurse back into this same resolution path, since
// registryAutoCreateTemplates is itself called FROM ensureAssignedForms.
function attemptSelfHealAcquisition(formCode, user, req) {
  const now = Date.now();
  const lastAttempt = lastAcquisitionAttempt.get(formCode) || 0;
  if (now - lastAttempt < ACQUISITION_COOLDOWN_MS) return;
  lastAcquisitionAttempt.set(formCode, now);
  require("../uscis-form-import/services/OnDemandFormAcquisitionService")
    .ensureCurrentUSCISForm(formCode, user, req)
    .catch((error) => {
      require("../../utils/logger").error("uscis_form_self_heal_acquisition_failed", { formCode, error: error.message });
    });
}

async function registryAutoCreateTemplates(caseData, user, req) {
  const { autoCreate, conditional, laterStage } = await resolveVisaFormMappings(caseData);
  const eligible = [
    ...autoCreate,
    ...conditional.filter((entry) => entry.decision !== "NOT_APPLICABLE"),
    ...laterStage,
  ];
  const templates = [];
  for (const entry of eligible) {
    if (entry.templateStatus !== "TEMPLATE_AVAILABLE") {
      // Self-heal: a standalone USCIS form with no local template at all
      // gets a throttled, non-blocking attempt to fetch it from uscis.gov,
      // so it shows up (in whatever activation tier it qualifies for) the
      // next time this case - or any case needing the same form - is
      // touched, with no admin having to click "Acquire" first. Component/
      // supplement mappings (share a parent's template) and non-USCIS
      // agencies are never attempted - there's nothing to fetch.
      if (entry.templateStatus === "TEMPLATE_MISSING" && isIndependentUSCISForm(entry.mapping) && entry.mapping.formTemplateFormCode) {
        attemptSelfHealAcquisition(entry.mapping.formTemplateFormCode, user, req);
      }
      continue;
    }
    const template = await buildTemplateForMapping(entry.mapping, caseData, entry.mapping.provisioningType);
    if (!template) continue; // resolved TEMPLATE_AVAILABLE a moment ago; defensive re-check
    templates.push(template);
  }
  return templates;
}

// Shared by registryAutoCreateTemplates (bulk) and provisionAvailableMapping
// (single-form "Add") - the one place that turns a VisaFormMapping entry
// into the "template" shape ensureAssignedForms' create loop consumes.
// Component mappings (componentCode set) never have their own
// USCISFormTemplate - they share the parent's - so this returns a fresh
// plain object pointing at the real parent template/PDF, with formCode
// overridden to the component's own stable identity (never the parent's),
// tagged with _componentInfo so the create loop can set
// parentFormCode/componentCode/componentType on the resulting CaseForm. A
// STANDALONE_FORM/CONDITIONAL mapping with its own real template
// (formTemplateFormCode set) is untouched, exactly as before this helper
// existed.
async function buildTemplateForMapping(mapping, caseData, reasonSuffix) {
  let template;
  if (mapping.componentCode) {
    const resolved = await resolveActiveComponent(mapping.parentForm, mapping.componentCode);
    if (!resolved) return null;
    const parentTemplate = resolved.parentTemplate;
    // A fresh, explicit plain object - never mutate the parent template doc
    // in place. findLatestActiveTemplate's result may be the same cached
    // instance activeTemplatesCached() hands out to every other caller in
    // this process; overwriting its formCode here would corrupt that
    // shared cache for the CORE I-129 resolution happening in the very
    // same request.
    template = {
      _id: parentTemplate._id,
      formCode: mapping.componentCode,
      version: parentTemplate.version,
      editionDate: parentTemplate.editionDate,
      activeMappingVersion: parentTemplate.activeMappingVersion,
      activeMappingVersionId: parentTemplate.activeMappingVersionId,
      latestMappingVersionId: parentTemplate.latestMappingVersionId,
      mappingVersion: parentTemplate.mappingVersion,
      validationVersion: parentTemplate.validationVersion,
      renderingVersion: parentTemplate.renderingVersion,
      _componentInfo: {
        parentFormCode: mapping.parentForm,
        componentCode: mapping.componentCode,
        componentType: mapping.componentType,
      },
    };
  } else {
    template = await uscisFormService.findLatestActiveTemplate(mapping.formTemplateFormCode);
    if (!template) return null;
  }
  template._visaFormMapping = {
    mappingId: mapping._id,
    provisioningType: mapping.provisioningType,
    createdReason: `VisaFormMapping registry: ${mapping.visaType} -> ${mapping.formNumber} (${reasonSuffix})`,
    visaType: caseData.visaType,
    processingPath: caseData.processingPath || "",
  };
  return template;
}

function assertNoClientProvidedForms(body = {}) {
  const forbidden = ["requiredForms", "formsToCreate", "formNumbersToProvision"];
  const present = forbidden.filter((key) => body[key] !== undefined);
  if (present.length) {
    const error = new Error(`The client may not specify which forms are required (${present.join(", ")}) - this is determined solely by the server-side registry.`);
    error.status = 400;
    throw error;
  }
}

// The ADD path reuses the exact same merge-and-create mechanism as
// automatic provisioning (uscis-form.service.js's ensureAssignedForms),
// not a second, parallel CaseForm-creation function.
async function recordConditionalDecision(caseData, mappingId, decision, user, reason, req) {
  if (!["ADD", "NOT_APPLICABLE"].includes(decision)) {
    const error = new Error(`decision must be ADD or NOT_APPLICABLE, got "${decision}"`);
    error.status = 400;
    throw error;
  }
  const mapping = await VisaFormMapping.findById(mappingId);
  if (!mapping || !mapping.active) {
    const error = new Error("Unknown or inactive form mapping");
    error.status = 404;
    throw error;
  }
  if (!isRegistryApplicable(mapping, caseData)) {
    const error = new Error("This mapping is not applicable to this case");
    error.status = 400;
    throw error;
  }
  const existingIndex = (caseData.conditionalFormDecisions || []).findIndex((d) => String(d.mappingId) === String(mapping._id));
  const decisionRecord = { mappingId: mapping._id, formNumber: mapping.formNumber, decision, decidedBy: user?._id, decidedAt: new Date(), reason: reason || "" };
  if (existingIndex >= 0) caseData.conditionalFormDecisions[existingIndex] = decisionRecord;
  else caseData.conditionalFormDecisions.push(decisionRecord);
  await caseData.save();

  if (decision === "ADD") {
    const templateStatus = await resolveTemplateStatus(mapping, caseData);
    if (templateStatus === "TEMPLATE_AVAILABLE") {
      const template = await uscisFormService.findLatestActiveTemplate(mapping.formTemplateFormCode);
      template._visaFormMapping = {
        mappingId: mapping._id,
        provisioningType: mapping.provisioningType,
        createdReason: `VisaFormMapping registry: ${mapping.visaType} -> ${mapping.formNumber} (CONDITIONAL, added by case manager)`,
        visaType: caseData.visaType,
        processingPath: caseData.processingPath || "",
      };
      await uscisFormService.ensureAssignedForms(caseData, user, req, { templates: [template] });
    }
    // The one integration point where "approved" also means "client may
    // now see the checklist" (§26 of the I-131 spec) - not every CONDITIONAL
    // form needs this (I-907/G-28/I-539/I-539A have no entry in
    // CONDITIONAL_FORM_CHECKLIST_KEYS, so this stays a no-op for them,
    // exactly as before this addition). Runs regardless of templateStatus:
    // the client-facing questionnaire (real Q&A + document checklist) does
    // not depend on the USCISFormTemplate/CaseForm existing yet - it can be
    // answered and its documents uploaded before the PDF template is
    // acquired/activated, same as any other visa's checklist is answerable
    // before "Generate USCIS Forms" is ever clicked. Assigning twice (a
    // reopened/re-approved decision) is a safe no-op: assignQuestionnaire
    // only ever pushes a new questionnaireReferences entry, and
    // resolveCaseQuestionnaires' own dedup (by responseId) already
    // prevents a duplicate checklist row from ever being shown - never a
    // second, parallel record kept elsewhere.
    const checklistKey = CONDITIONAL_FORM_CHECKLIST_KEYS[mapping.formNumber];
    if (checklistKey) {
      const questionnaire = await Questionnaire.findOne({ key: checklistKey, latestVersion: true });
      // assignQuestionnaireIfNotActive (questionnaire.service.js) is the
      // shared, tested version of the hasActiveReference guard this
      // function used to hand-roll itself - now used by every checklist
      // assignment site (this one, and family-checklist composition) so
      // none of them can duplicate a questionnaireReferences entry.
      if (questionnaire) {
        await require("../questionnaires/questionnaire.service").assignQuestionnaireIfNotActive(
          questionnaire,
          { caseData, targetRole: questionnaire.checklistRole },
          user,
          req
        );
      }
    }
    return { decisionRecord, templateStatus };
  }
  return { decisionRecord, templateStatus: null };
}

// Single-form, conflict-independent provisioning for an AUTO_CREATE mapping
// that's fully ready (TEMPLATE_AVAILABLE) but has no CaseForm yet. Mirrors
// recordConditionalDecision's ADD path and OnDemandFormAcquisitionService's
// single-template call above it - same ensureAssignedForms mechanism, not a
// second creation path.
//
// Exists because the bulk "Generate USCIS Forms" endpoint
// (CaseLifecycleOrchestrator.generateForms) is correctly gated on
// unresolved canonical-profile conflicts (a real safety check - autofilling
// from a value known to conflict with another source would write bad data),
// but that gate has no way to know a conflict on, say, company.name has
// nothing to do with a form like I-129 whose own mapping/template are
// completely ready. A form stuck at templateStatus TEMPLATE_AVAILABLE with
// no CaseForm had no path onto the case at all until a completely unrelated
// conflict was resolved first - confirmed against a real production case.
// This only ever creates the CaseForm; it does not autofill it (the
// frontend follows up with the existing per-form Autofill action, which is
// already conflict-independent).
async function provisionAvailableMapping(caseData, mappingId, user, req) {
  const mapping = await VisaFormMapping.findById(mappingId);
  if (!mapping || !mapping.active) {
    const error = new Error("Unknown or inactive form mapping");
    error.status = 404;
    throw error;
  }
  if (!isRegistryApplicable(mapping, caseData)) {
    const error = new Error("This mapping is not applicable to this case");
    error.status = 400;
    throw error;
  }
  const templateStatus = await resolveTemplateStatus(mapping, caseData);
  if (templateStatus !== "TEMPLATE_AVAILABLE") {
    const error = new Error(`This form isn't ready to be added yet (status: ${templateStatus}).`);
    error.status = 409;
    error.code = "TEMPLATE_NOT_AVAILABLE";
    throw error;
  }
  const template = await buildTemplateForMapping(mapping, caseData, "added by case manager, single-form");
  if (!template) {
    const error = new Error(`This form isn't ready to be added yet (status: ${templateStatus}).`);
    error.status = 409;
    error.code = "TEMPLATE_NOT_AVAILABLE";
    throw error; // resolved TEMPLATE_AVAILABLE a moment ago; defensive re-check
  }
  const created = await uscisFormService.ensureAssignedForms(caseData, user, req, { templates: [template] });
  return { mapping, templateStatus, created };
}

// Answers "now that these USCIS forms are applicable to this case, which
// checklist(s) are associated with each one, and under what assignment
// condition" (§21 of the checklist-mapping plan) - a read-only projection
// over each applicable mapping's own checklistMappings, consuming
// resolveVisaFormMappings' applicability decision rather than re-deriving
// it (never a second "is this form applicable" check). Buckets by
// assignmentType, since that's what a caller (UI, tests, a future
// assignment call-site) needs to act differently on:
//   auto        - assign immediately, no human/condition gate
//   conditional - assign only because `condition` evaluated true right now
//   explicitCm  - never auto-assigned; a case manager must add it
// A form whose own provisioningType bucket is autoCreate/conditional/
// laterStage/reference doesn't matter here - checklistMappings are
// evaluated for every registry-applicable row regardless of which of
// those four buckets it's in (e.g. I-539 is CONDITIONAL for H-1B as a
// FORM, but its checklistMappings entry is still evaluated the same way).
function resolveChecklistMappingEntry(entry, mapping, caseData) {
  const base = { checklistKey: entry.checklistKey, role: entry.role || "", formNumber: mapping.formNumber, visaType: mapping.visaType, notes: entry.notes || "" };
  if (entry.assignmentType === "CONDITIONAL") {
    return { ...base, satisfied: evaluateTrigger(entry.condition, caseData) };
  }
  return { ...base, satisfied: true };
}

async function resolveChecklistsForCase(caseData) {
  // BUG (fixed): this never checked a checklistMapping's own `role`
  // (employer/employee/petitioner/beneficiary) against which role THIS
  // specific case actually is — every mapping matching the visa/form was
  // returned regardless. Confirmed live: an employer_employee child
  // (employee-role) case had h1b_employer_checklist auto-assigned onto its
  // own questionnaireReferences via this path, alongside its real
  // h1b_employee_checklist — a duplicate, permanently-empty reference,
  // since the real employer data only ever gets filled in on the principal.
  // ImmigrationKnowledgeEngineService.expectedChecklistRoleForCase already
  // has this exact, correct case-structure -> role mapping (reused here,
  // not re-derived, so the two resolution paths this codebase has for
  // "which checklists apply to this case" — this one and orchestrate()'s
  // own applicableQuestionnaires() — can never disagree about it).
  const expectedRole = require("../cases/immigration-knowledge-engine.service").expectedChecklistRoleForCase(caseData);
  const resolved = await resolveVisaFormMappings(caseData);
  const allEntries = [...resolved.autoCreate, ...resolved.conditional, ...resolved.laterStage, ...resolved.reference];
  const auto = [];
  const conditional = [];
  const explicitCm = [];
  for (const entry of allEntries) {
    for (const checklistMapping of entry.mapping.checklistMappings || []) {
      if (expectedRole && checklistMapping.role && checklistMapping.role !== expectedRole) continue;
      if (checklistMapping.assignmentType === "AUTO") {
        auto.push(resolveChecklistMappingEntry(checklistMapping, entry.mapping, caseData));
      } else if (checklistMapping.assignmentType === "CONDITIONAL") {
        const resolvedEntry = resolveChecklistMappingEntry(checklistMapping, entry.mapping, caseData);
        (resolvedEntry.satisfied ? auto : conditional).push(resolvedEntry);
      } else if (checklistMapping.assignmentType === "EXPLICIT_CM") {
        explicitCm.push(resolveChecklistMappingEntry(checklistMapping, entry.mapping, caseData));
      }
    }
  }
  // Dedupe by checklistKey - the same checklist can legitimately be listed
  // against more than one form (e.g. h1b_employer_checklist against both
  // I-129 and I-907), and a case manager only needs to see it once.
  const dedupe = (list) => [...new Map(list.map((item) => [item.checklistKey, item])).values()];
  return { auto: dedupe(auto), conditional: dedupe(conditional), explicitCm: dedupe(explicitCm) };
}

module.exports = {
  evaluateTrigger,
  isRegistryApplicable,
  resolveApplicableMappings,
  resolveVisaFormMappings,
  isIndependentUSCISForm,
  independentFormsFrom,
  resolveTemplateStatus,
  templateDiagnostics,
  registryAutoCreateTemplates,
  recordConditionalDecision,
  provisionAvailableMapping,
  assertNoClientProvidedForms,
  readWhitelistedField,
  resolveChecklistsForCase,
};
