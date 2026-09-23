// Final phase (USCIS forms production readiness) - durability fix.
//
// Every form-seed script used to hardcode its own static `template.visaTypes`
// array (e.g. i129.seed.js: `["H-1B", "L-1A", "L-1B"]`). Phase 2/3 found and
// live-corrected real drift between those hardcoded arrays and the actual,
// much larger set of visa types `VisaFormMapping` (the SOLE authority on
// applicability, per its own header comment) maps to each form - I-539 and
// I-907 in particular had NO visaTypes assignment in their seed at all,
// which is the literal root cause of those two templates having an empty
// `visaTypes` array in production. A live-database fix alone is not
// durable: reseeding, a fresh environment, or a database rebuild would
// silently reintroduce every one of those bugs, since the hardcoded arrays
// never changed.
//
// This derives a form's real visaTypes set live from the registry itself -
// every visa type with an active AUTO_CREATE/CONDITIONAL VisaFormMapping
// row that resolves to this form, either directly (formTemplateFormCode)
// or as the parent of one of its own FORM_COMPONENTs (parentForm) - so a
// seed script that uses this never goes stale as new mappings are added,
// and a fresh environment ends up with the same correct state Phase 2/3
// already proved live, without a second, hand-maintained list to drift
// from the first.
const VisaFormMapping = require("../../../models/VisaFormMapping");

async function deriveVisaTypesFromRegistry(formCode) {
  const normalized = String(formCode || "").trim().toLowerCase();
  if (!normalized) return [];
  const rows = await VisaFormMapping.find({
    active: true,
    provisioningType: { $in: ["AUTO_CREATE", "CONDITIONAL"] },
    $or: [
      { formTemplateFormCode: normalized },
      { parentForm: new RegExp(`^${formCode}$`, "i") },
    ],
  }).select("visaType").lean();
  return [...new Set(rows.map((r) => r.visaType))].sort();
}

module.exports = { deriveVisaTypesFromRegistry };
