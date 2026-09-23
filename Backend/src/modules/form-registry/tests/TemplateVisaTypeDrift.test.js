// Final phase (USCIS forms production readiness) §11-13 - permanent guard
// against the exact failure mode Phase 2/3 found and live-corrected: a
// USCISFormTemplate's own `visaTypes` field silently falling behind the
// registry as new VisaFormMapping rows are added (I-129 had only 3 of 24
// real visa types; I-539/I-907 had ZERO, making them unreachable for any
// visa at all). Derives its expectations entirely from the live registry -
// never a hardcoded form/visa list - and calls the REAL, unmodified
// `templateAppliesToCase`/`hasAssignmentScope` production functions rather
// than a simplified reimplementation, so this test can never quietly
// disagree with what the running service actually does.
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");
const env = require("../../../config/env");
const VisaFormMapping = require("../../../models/VisaFormMapping");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const { templateAppliesToCase, hasAssignmentScope } = require("../../uscis-forms/uscis-form.service");

test.before(async () => {
  if (mongoose.connection.readyState === 0) await mongoose.connect(env.mongoUri);
});

test.after(async () => {
  await mongoose.disconnect();
});

// Builds the narrowest fake case that should legitimately satisfy this
// template's OTHER assignmentRules requirements (if any), so a failure can
// only be attributed to the visaType check itself - isolates exactly the
// fallback semantics templateAppliesToCase's own visaTypes line uses
// (`rules.visaTypes?.length ? rules.visaTypes : template.visaTypes`),
// never a simplified reimplementation of it.
function buildSatisfyingCase(template, visaType) {
  const rules = template.assignmentRules || {};
  const caseData = { visaType };
  if (rules.visaCategories?.length) caseData.visaCategory = rules.visaCategories[0];
  if (rules.caseTypes?.length) caseData.caseType = rules.caseTypes[0];
  if (rules.petitionTypes?.length) caseData.petitionType = rules.petitionTypes[0];
  if (rules.applicantTypes?.length) caseData.applicantType = rules.applicantTypes[0];
  if (rules.premiumProcessing !== undefined) caseData.premiumProcessing = rules.premiumProcessing;
  return caseData;
}

test("Registry-wide: every visa type an active mapping justifies must not be rejected by stale template.visaTypes", async () => {
  const rows = await VisaFormMapping.find({
    active: true,
    provisioningType: { $in: ["AUTO_CREATE", "CONDITIONAL"] },
    $or: [
      { formTemplateFormCode: { $ne: null } },
      { parentForm: { $ne: null } },
    ],
  }).select("visaType formNumber formTemplateFormCode parentForm provisioningType componentType").lean();

  assert.ok(rows.length > 0, "expected at least one AUTO_CREATE/CONDITIONAL mapping row to audit");

  const templateCache = new Map();
  const drift = [];

  for (const row of rows) {
    const formCode = (row.formTemplateFormCode || row.parentForm || "").toUpperCase();
    if (!formCode) continue;

    let template = templateCache.get(formCode);
    if (template === undefined) {
      template = await USCISFormTemplate.findOne({ formCode: new RegExp(`^${formCode}$`, "i"), status: "active" }).lean();
      templateCache.set(formCode, template);
    }
    if (!template) continue; // tracked separately by the registry closure audit - not a visaTypes concern.
    if (!hasAssignmentScope(template)) continue; // no scope at all is a different failure mode, not visaTypes drift specifically.

    const rules = template.assignmentRules || {};
    const usesTemplateFallback = !(rules.visaTypes?.length);
    if (!usesTemplateFallback) continue; // assignmentRules.visaTypes is authoritative here, not template.visaTypes - not this test's concern.

    const caseData = buildSatisfyingCase(template, row.visaType);
    const applies = templateAppliesToCase(template, caseData);
    if (!applies) {
      drift.push({
        template: formCode,
        missingVisaType: row.visaType,
        mappingId: String(row._id),
        mappingFormNumber: row.formNumber,
        mappingProvisioningType: row.provisioningType,
        templateVisaTypes: template.visaTypes || [],
      });
    }
  }

  if (drift.length) {
    const report = drift.map((d) => (
      `TEMPLATE_VISA_MAPPING_DRIFT\n` +
      `  Template: ${d.template}\n` +
      `  Missing visa type: ${d.missingVisaType}\n` +
      `  Mapping: ${d.mappingFormNumber} (id ${d.mappingId}, ${d.mappingProvisioningType})\n` +
      `  Actual template.visaTypes: ${JSON.stringify(d.templateVisaTypes)}\n`
    )).join("\n");
    assert.fail(`${drift.length} template(s) reject a visa type their own active VisaFormMapping registry justifies:\n\n${report}`);
  }
});
