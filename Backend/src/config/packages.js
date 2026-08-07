// Canonical service-package names. These are the ONLY values persisted or
// returned for a case/payment/client service tier.
const SELF_FILING = "Self Filing Package";
const ATTORNEY_REVIEW = "Attorney Review Package";
const FULL_ATTORNEY_FILING = "Full Attorney Filing Package";

const PACKAGE_NAMES = [SELF_FILING, ATTORNEY_REVIEW, FULL_ATTORNEY_FILING];

// Inbound-only migration aliases. These normalize older payload/database
// values to the canonical names above; callers must never display or persist
// alias values.
const LEGACY_ALIASES = {
  basic: SELF_FILING,
  basicpackage: SELF_FILING,
  selffile: SELF_FILING,
  selfpackage: SELF_FILING,
  essentials: SELF_FILING,
  essentialspackage: SELF_FILING,
  selffilepackage: SELF_FILING,
  selffilingpackage: SELF_FILING,

  pro: ATTORNEY_REVIEW,
  propackage: ATTORNEY_REVIEW,
  standard: ATTORNEY_REVIEW,
  standardpackage: ATTORNEY_REVIEW,
  guidedreview: ATTORNEY_REVIEW,
  enhanced: ATTORNEY_REVIEW,
  enhancedpackage: ATTORNEY_REVIEW,
  guidedreviewpackage: ATTORNEY_REVIEW,
  attorneyreviewpackage: ATTORNEY_REVIEW,

  gold: FULL_ATTORNEY_FILING,
  goldpackage: FULL_ATTORNEY_FILING,
  premium: FULL_ATTORNEY_FILING,
  premiumpackage: FULL_ATTORNEY_FILING,
  fullservice: FULL_ATTORNEY_FILING,
  professional: FULL_ATTORNEY_FILING,
  professionalpackage: FULL_ATTORNEY_FILING,
  fullservicepackage: FULL_ATTORNEY_FILING,
  fullservicefilingpackage: FULL_ATTORNEY_FILING,
  fullattorneyfilingpackage: FULL_ATTORNEY_FILING,
};

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Resolves any known legacy value (or an already-canonical one) to one of
// the 3 canonical names. Returns "" for empty/unrecognized input; callers
// decide whether an unrecognized value is an error or just "not selected".
function normalizePackageName(value) {
  if (!value) return "";
  const key = normalizeKey(value);
  if (PACKAGE_NAMES.includes(value)) return value;
  return LEGACY_ALIASES[key] || "";
}

module.exports = {
  SELF_FILING,
  ATTORNEY_REVIEW,
  FULL_ATTORNEY_FILING,
  PACKAGE_NAMES,
  normalizePackageName,
};
