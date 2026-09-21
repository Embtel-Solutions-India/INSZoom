// Applicability resolution for the VisaFormMapping registry - the SOLE
// authority on whether a form applies to a visa/case. USCISFormTemplate
// existence/assignmentRules are evaluated separately, afterward, purely as
// a technical "can we actually render this yet" diagnostic - they never
// feed back into or override a registry applicability decision. See the
// VisaFormMapping implementation plan for the full rationale.
const VisaFormMapping = require("../../models/VisaFormMapping");
const Questionnaire = require("../../models/Questionnaire");
const uscisFormService = require("../uscis-forms/uscis-form.service");
const { resolveWithHierarchyFallback } = require("../../config/visaHierarchy");

// A CONDITIONAL mapping's formNumber that also has its own non-default,
// explicit-assignment-only client checklist (see i131Checklist.js's file
// banner for why I-131's Questionnaire is deliberately never isDefault).
// I-907/G-28/I-539/I-539A have no such entry - they have no client-facing
// checklist need, so this map (and the branch that reads it below) is a
// no-op for them, never a behavior change to their existing flow.
const CONDITIONAL_FORM_CHECKLIST_KEYS = {
  "I-131": "i131_checklist",
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
      conditional.push({ mapping, decision: decisionFor(caseData, mapping._id) });
    } else if (mapping.provisioningType === "LATER_STAGE") {
      laterStage.push({ mapping });
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

// TEMPLATE_MISSING | TEMPLATE_AVAILABLE | TEMPLATE_RULE_CONFLICT - see the
// implementation plan (§ Applicability resolution) for what each means.
// Never mutates or reclassifies the registry mapping.
async function resolveTemplateStatus(mapping, caseData) {
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
// own CaseForm - only I-129's FORM_COMPONENT supplements (embedded pages,
// no separate template at all) must never get one, and those are already
// excluded upstream by provisioningType NOT_APPLICABLE (visaFormMappings.seed.js),
// which resolveApplicableMappings' bucketing never puts in `autoCreate` to
// begin with. The independence filter belongs only where "is this
// independently offered/listed as its own form" is the question - see
// isIndependentUSCISForm's callers in form-registry.controller.js.
async function registryAutoCreateTemplates(caseData) {
  const { autoCreate } = await resolveVisaFormMappings(caseData);
  const templates = [];
  for (const entry of autoCreate) {
    if (entry.templateStatus !== "TEMPLATE_AVAILABLE") continue;
    const template = await uscisFormService.findLatestActiveTemplate(entry.mapping.formTemplateFormCode);
    if (!template) continue; // resolved TEMPLATE_AVAILABLE a moment ago; defensive re-check
    template._visaFormMapping = {
      mappingId: entry.mapping._id,
      provisioningType: entry.mapping.provisioningType,
      createdReason: `VisaFormMapping registry: ${entry.mapping.visaType} -> ${entry.mapping.formNumber} (AUTO_CREATE)`,
      visaType: caseData.visaType,
      processingPath: caseData.processingPath || "",
    };
    templates.push(template);
  }
  return templates;
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
  assertNoClientProvidedForms,
  readWhitelistedField,
};
