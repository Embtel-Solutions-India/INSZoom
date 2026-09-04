// Applicability resolution for the VisaFormMapping registry - the SOLE
// authority on whether a form applies to a visa/case. USCISFormTemplate
// existence/assignmentRules are evaluated separately, afterward, purely as
// a technical "can we actually render this yet" diagnostic - they never
// feed back into or override a registry applicability decision. See the
// VisaFormMapping implementation plan for the full rationale.
const VisaFormMapping = require("../../models/VisaFormMapping");
const uscisFormService = require("../uscis-forms/uscis-form.service");

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

// Builds the exact shape ensureAssignedForms' merge step needs: real
// USCISFormTemplate documents (not mapping records) for every AUTO_CREATE
// entry that is TEMPLATE_AVAILABLE right now, tagged with the registry
// provenance so the CaseForm creation loop can populate `provisioning`.
async function registryAutoCreateTemplates(caseData) {
  const { autoCreate } = await resolveApplicableMappings(caseData);
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
    return { decisionRecord, templateStatus };
  }
  return { decisionRecord, templateStatus: null };
}

module.exports = {
  evaluateTrigger,
  isRegistryApplicable,
  resolveApplicableMappings,
  resolveTemplateStatus,
  templateDiagnostics,
  registryAutoCreateTemplates,
  recordConditionalDecision,
  assertNoClientProvidedForms,
  readWhitelistedField,
};
