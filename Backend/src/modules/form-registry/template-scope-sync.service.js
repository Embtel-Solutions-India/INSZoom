// Keeps a form template's own visa scope in step with the registry.
//
// A form is put on a case only when BOTH agree: the registry row (VisaFormMapping: visa type -> form, Automatic / Conditional) says it applies, and the
// form template's own scope (USCISFormTemplate.visaTypes, plus assignmentRules.visaTypes when that is set) names the case's visa type
// (uscis-form.service.templateAppliesToCase). When an admin maps a form to a visa on the Form Governance page, only the registry used to change, so the
// case showed "Configuration issue - this form's template can't be applied to this case yet". This adds the registry's visa types to the template scope
// (add-only, atomic, idempotent - exactly what FormPipelineAutopilot already does on its interval, just immediately). It never removes a visa type and
// never touches a retired / archived edition.

const USCISFormTemplate = require("../../models/USCISFormTemplate");
const { deriveVisaTypesFromRegistry } = require("../uscis-form-import/seeds/deriveVisaTypesFromRegistry");

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Pure: which of `wanted` the template scope is missing (the dry-run / test surface).
function missingFromScope(template = {}, wanted = []) {
  const have = new Set((template.visaTypes || []).map(String));
  const rulesList = template.assignmentRules?.visaTypes || [];
  const haveRules = new Set(rulesList.map(String));
  return {
    visaTypes: wanted.filter((visaType) => !have.has(String(visaType))),
    // assignmentRules.visaTypes is authoritative when it is non-empty; when it is empty the template's own visaTypes are used
    assignmentRules: rulesList.length ? wanted.filter((visaType) => !haveRules.has(String(visaType))) : [],
  };
}

async function syncTemplateScopeForForm(formCode) {
  const code = String(formCode || "").trim();
  if (!code) return { formCode: code, visaTypes: [], modified: 0 };
  const visaTypes = await deriveVisaTypesFromRegistry(code);
  if (!visaTypes.length) return { formCode: code, visaTypes, modified: 0 };
  const filter = { formCode: new RegExp(`^${escapeRegExp(code)}$`, "i"), status: { $nin: ["retired", "archived"] } };
  const base = await USCISFormTemplate.updateMany(filter, { $addToSet: { visaTypes: { $each: visaTypes } } });
  const rules = await USCISFormTemplate.updateMany({ ...filter, "assignmentRules.visaTypes.0": { $exists: true } }, { $addToSet: { "assignmentRules.visaTypes": { $each: visaTypes } } });
  const modified = (base.modifiedCount || 0) + (rules.modifiedCount || 0);
  if (modified) {
    try { require("../uscis-forms/uscis-form.service").invalidateTemplateCache(); } catch (error) { /* cache only */ }
  }
  return { formCode: code, visaTypes, modified };
}

const QUALIFYING = ["AUTO_CREATE", "CONDITIONAL"]; // the provisioning types that put a visa type into a form template's scope
const qualifies = (row) => Boolean(row && row.active !== false && QUALIFYING.includes(row.provisioningType));

// An admin removed a case type from a form (or made it not-applicable / reference only / later stage): take that visa type out of the form's own scope too,
// or the older template-scope path would keep assigning the form to cases of that visa. Only called on that explicit transition, and only when no other
// active Automatic / Conditional registry row still justifies the visa type for this form.
async function removeVisaFromTemplateScope(formCode, visaType) {
  const code = String(formCode || "").trim();
  if (!code || !visaType) return { formCode: code, removed: false };
  const VisaFormMapping = require("../../models/VisaFormMapping");
  const stillJustified = await VisaFormMapping.exists({
    visaType, active: true, provisioningType: { $in: QUALIFYING },
    $or: [{ formTemplateFormCode: code.toLowerCase() }, { parentForm: new RegExp(`^${escapeRegExp(code)}$`, "i") }],
  });
  if (stillJustified) return { formCode: code, removed: false, reason: "another registry row still applies" };
  const filter = { formCode: new RegExp(`^${escapeRegExp(code)}$`, "i"), status: { $nin: ["retired", "archived"] } };
  const base = await USCISFormTemplate.updateMany(filter, { $pull: { visaTypes: visaType } });
  const rules = await USCISFormTemplate.updateMany({ ...filter, "assignmentRules.visaTypes": visaType }, { $pull: { "assignmentRules.visaTypes": visaType } });
  const modified = (base.modifiedCount || 0) + (rules.modifiedCount || 0);
  if (modified) {
    try { require("../uscis-forms/uscis-form.service").invalidateTemplateCache(); } catch (error) { /* cache only */ }
  }
  return { formCode: code, removed: modified > 0 };
}

// After ANY registry change to one row: add the visa type to the form's scope when the row now applies; remove it only when it applied before and no longer does.
async function reconcileScopeAfterRowChange({ formCode, visaType, wasQualifying, nowQualifying }) {
  try {
    if (nowQualifying) return await syncTemplateScopeForForm(formCode);
    if (wasQualifying) return await removeVisaFromTemplateScope(formCode, visaType);
    return { formCode, modified: 0 };
  } catch (error) {
    require("../../utils/logger").error("template_scope_reconcile_failed", { formCode, visaType, error: error.message });
    return { formCode, modified: 0, error: error.message };
  }
}

// Never throws: used right after a registry edit, which must not fail because the scope sync did.
async function syncTemplateScopeSafely(formCode) {
  try {
    return await syncTemplateScopeForForm(formCode);
  } catch (error) {
    require("../../utils/logger").error("template_scope_sync_failed", { formCode, error: error.message });
    return { formCode, visaTypes: [], modified: 0, error: error.message };
  }
}

module.exports = { missingFromScope, qualifies, syncTemplateScopeForForm, syncTemplateScopeSafely, removeVisaFromTemplateScope, reconcileScopeAfterRowChange };
