// The rules a petition is checked against (Petition AI Review).
//   - fixed company rules: always applied, written here (Immiglance is not a law firm, Immiglance-only branding, no promised outcome)
//   - the company's own wording: the non-attorney disclaimer and prohibited terms from the existing compliance settings (entity-config)
//   - the editable record (models/PetitionAiRules): correct FedEx / filing addresses and extra rules written by the team
// loadRules() never throws: if any source cannot be read, the fixed rules and the compliance fallbacks are still returned.
const { FALLBACK_DISCLAIMER_UNCONFIGURED_FIRM_CLAUSE, DEFAULT_PROHIBITED_TERMS } = require("../compliance/compliance.constants");

const LEGACY_BRAND_NAMES = ["BAIS", "Bay Area Immigration Services"];

const FIXED_RULES = Object.freeze([
  {
    id: "not_a_law_firm",
    severity: "error",
    text: "Immiglance is not a law firm and does not provide legal advice. Flag any wording that presents Immiglance as a law firm, attorney, lawyer, legal counsel or legal adviser, or that says Immiglance gives legal advice or legal representation.",
  },
  {
    id: "no_promised_outcome",
    severity: "warning",
    text: "Nothing may promise or guarantee an immigration outcome. Flag wording that promises approval or success (for example 'guaranteed approval', '100% success', 'risk-free'). A factual statement about an approval that already happened (e.g. 'the approved I-140') is NOT a violation.",
  },
  {
    id: "case_facts",
    severity: "error",
    text: "Names, the case number, the visa type and addresses must match the case reference facts given above. Flag any page where a person's or company's name is spelled differently or a different person/company appears where the case's own should be.",
  },
  {
    id: "addresses",
    severity: "error",
    text: "A FedEx, courier, filing or mailing address must match one of the expected addresses given above exactly (street, suite, city, state, ZIP). Flag any address that differs.",
  },
]);

// The organisation-name check is OFF for now (owner decision 2026-11-04): the portal is used by the Bay Area Immigration Services team,
// who rightly write their own name in the petitions they prepare. It is kept for later and comes back with PETITION_AI_BRAND_CHECK=on.
const BRAND_RULE = Object.freeze({
  id: "brand_name",
  severity: "error",
  text: `The organisation name is "Immiglance" only. Flag any legacy or other organisation name used for the company (${LEGACY_BRAND_NAMES.join(", ")}) and any misspelling of "Immiglance".`,
});
const BRAND_NAME_PATTERN = /bay\s*area\s*immigration|\bBAIS\b/i;

function brandCheckOn(env = process.env) {
  return ["on", "true", "1", "yes", "enabled"].includes(String(env.PETITION_AI_BRAND_CHECK ?? "off").trim().toLowerCase());
}

/**
 * Safety net while the organisation-name check is off: true for a finding that only complains about the preparer's organisation name
 * (the AI may still report it on its own). Findings about the petitioner / beneficiary names are never dropped.
 */
function isOrganisationNameFinding(finding) {
  if (!finding || !["company_rule", "wrong_name"].includes(finding.category)) return false;
  return BRAND_NAME_PATTERN.test(`${finding.excerpt || ""} ${finding.found || ""} ${finding.suggestion || ""}`);
}

/** Pure: assembles the rule set from its sources. Every input is optional. `brandCheck` defaults to PETITION_AI_BRAND_CHECK (off). */
function buildRuleSet({ disclaimer, prohibitedTerms, stored, brandCheck = brandCheckOn() } = {}) {
  const terms = (Array.isArray(prohibitedTerms) && prohibitedTerms.length ? prohibitedTerms : DEFAULT_PROHIBITED_TERMS)
    .map((term) => String(term || "").trim())
    .filter(Boolean);
  const expectedAddresses = (stored?.expectedAddresses || [])
    .map((item) => ({ label: String(item?.label || "").trim(), address: String(item?.address || "").trim() }))
    .filter((item) => item.address);
  const extraRules = (stored?.extraRules || []).map((rule) => String(rule || "").trim()).filter(Boolean);
  return {
    version: Number(stored?.version) || 0,
    disclaimer: String(disclaimer || "").trim() || FALLBACK_DISCLAIMER_UNCONFIGURED_FIRM_CLAUSE,
    prohibitedTerms: [...new Set(terms)],
    legacyBrandNames: [...LEGACY_BRAND_NAMES],
    brandCheck: Boolean(brandCheck),
    expectedAddresses,
    rules: [...FIXED_RULES, ...(brandCheck ? [BRAND_RULE] : []), ...extraRules.map((text, index) => ({ id: `team_rule_${index + 1}`, severity: "warning", text }))],
  };
}

/** Reads every source and returns the rule set. Never throws. deps are injectable for tests. */
async function loadRules(deps = {}) {
  const entityConfig = deps.entityConfig || safeRequire("../entity-config/entityConfig.service");
  const RulesModel = deps.RulesModel || safeRequire("../../models/PetitionAiRules");
  const [disclaimer, prohibitedTerms, stored] = await Promise.all([
    entityConfig?.resolveDisclaimer ? entityConfig.resolveDisclaimer().then((value) => value?.text).catch(() => "") : "",
    entityConfig?.resolveProhibitedTerms ? entityConfig.resolveProhibitedTerms().catch(() => null) : null,
    RulesModel?.findOne ? Promise.resolve(RulesModel.findOne({ key: "default" }).lean()).catch(() => null) : null,
  ]);
  return buildRuleSet({ disclaimer, prohibitedTerms, stored });
}

function safeRequire(path) {
  try {
    return require(path);
  } catch (_error) {
    return null;
  }
}

module.exports = { buildRuleSet, loadRules, FIXED_RULES, LEGACY_BRAND_NAMES, BRAND_RULE, brandCheckOn, isOrganisationNameFinding };
