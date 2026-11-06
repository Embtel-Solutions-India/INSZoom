// After every import of a DOL ETA-9089 form (new version or resumed copy): do the authored mapping rules (form-mapping/config/etaFieldRules.js) and the box-type overrides
// (externalForms.js) still match the boxes of THIS version? DOL may rename or move a box when it renews the form; the rule for it would then silently stop applying and the box would stay
// blank. This reports exactly which stems no longer match (a warning in the log and `lifecycle.external.unmatchedRuleStems` on the template) so the fix is one precise edit of the rule file
// (the form's own entry names it) - never a silent gap. Pure core + one best-effort writer; never throws.
const logger = require("../../../utils/logger");
const { externalFormFor } = require("../config/externalForms");

const stemOf = (pdfField) => String(pdfField || "").split(".").pop().replace(/\[\d+\]/g, "").toLowerCase();

/** Pure. { unmatchedRuleStems: [...], unmatchedTypeOverrides: [...] } for a form code and the template's boxes ([] / [] for every other form). */
function unmatchedFor({ formCode, fields, rules }) {
  const entry = externalFormFor(formCode);
  if (!entry) return { unmatchedRuleStems: [], unmatchedTypeOverrides: [] };
  const names = (fields || []).map((field) => String(field.pdfFieldName || field.fieldName || field.originalName || ""));
  const stems = new Set(names.map(stemOf));
  const ruleList = rules || require("../../form-mapping/config/partyFieldRules").RULES[entry.formCode] || [];
  const unmatchedRuleStems = [...new Set(ruleList.flatMap((rule) => rule.stems).filter((stem) => !stems.has(String(stem).toLowerCase())))];
  const unmatchedTypeOverrides = (entry.fieldTypeOverrides || []).filter((override) => !names.some((name) => override.match.test(name))).map((override) => String(override.match));
  return { unmatchedRuleStems, unmatchedTypeOverrides };
}

/** Best effort: reads the template's boxes, logs a warning when something no longer matches, and records the result on the template. */
async function reportRuleHealth(templateId, formCode) {
  try {
    const USCISFormTemplate = require("../../../models/USCISFormTemplate");
    const template = await USCISFormTemplate.findById(templateId).select("formCode version formFields.pdfFieldName formFields.fieldName").lean();
    if (!template) return null;
    const result = unmatchedFor({ formCode, fields: template.formFields });
    const healthy = !result.unmatchedRuleStems.length && !result.unmatchedTypeOverrides.length;
    if (!healthy) logger.warn("external_form_rules_unmatched", { formCode, version: template.version, ...result, fix: "edit the stems in Backend/src/modules/form-mapping/config/etaFieldRules.js (and fieldTypeOverrides in uscis-form-import/config/externalForms.js) to the new box names" });
    await USCISFormTemplate.updateOne({ _id: templateId }, { $set: { "lifecycle.external.ruleHealth": { checkedAt: new Date(), ...result } } });
    return result;
  } catch (error) {
    logger.warn("external_form_rule_health_failed", { formCode, error: error.message });
    return null;
  }
}

module.exports = { unmatchedFor, reportRuleHealth, stemOf };
