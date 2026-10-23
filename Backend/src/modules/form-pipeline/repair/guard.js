// Phase 4 (carried over from Phase 3): what automatic repair may NEVER touch. A repair strategy is only for a failure that is deterministic and fixable by code without
// changing anything a person decided: what a client said, a mapping edge, which party a box belongs to, or an edition-acceptance decision. Everything here is pure.
//
// Refused outright (a person has to look): the mapping / party / box-value checks of certification (mapping_valid, party_markers, widget_inputs - repairing the PDF around
// them would only hide them), an edition-policy hold, a lost lease or a busy promotion, and any mapping-contract or unreviewed-edition-change error.
const NEVER_AUTO_REPAIR_CHECKS = Object.freeze(["mapping_valid", "party_markers", "widget_inputs"]);
const NEVER_AUTO_REPAIR_CODES = Object.freeze(["EDITION_POLICY_HELD", "PIPELINE_LEASE_LOST", "PROMOTION_BUSY", "MAPPING_CONTRACT_VIOLATION", "UNREVIEWED_EDITION_CHANGES", "NOT_THE_REVIEWER"]);
const NEVER_AUTO_REPAIR_NAMES = Object.freeze(["EditionPolicyHeldError", "LeaseLostError"]);

/** The failed certification checks an error carries: [{ name, detail }] (empty for an ordinary error). */
const failedChecksOf = (error) => (Array.isArray(error?.failedChecks) ? error.failedChecks : []).map((check) => ({ name: String(check?.name || ""), detail: String(check?.detail || "") }));

/** True when NO strategy may act on this error. */
function refuses(error) {
  if (!error) return true;
  if (NEVER_AUTO_REPAIR_NAMES.includes(String(error.name || ""))) return true;
  const code = String(error.code || "");
  if (NEVER_AUTO_REPAIR_CODES.includes(code) || /^(EDITION_|MAPPING_)/.test(code)) return true;
  if (error.refuseRepair === true) return true;
  return failedChecksOf(error).some((check) => NEVER_AUTO_REPAIR_CHECKS.includes(check.name));
}

/** matches() must never throw: an odd error simply is not ours. */
const safe = (fn) => (error) => { try { return Boolean(fn(error)); } catch { return false; } };

module.exports = { NEVER_AUTO_REPAIR_CHECKS, NEVER_AUTO_REPAIR_CODES, failedChecksOf, refuses, safe };
