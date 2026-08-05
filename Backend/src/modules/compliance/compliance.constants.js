// Hardcoded fallbacks so the system is NEVER in a state with no disclaimer
// and no prohibited-word list, even on a brand-new database before an admin
// has configured anything. The DB (Settings.nonAttorneyDisclaimer /
// Settings.prohibitedTerms) is always the preferred source of truth — see
// entityConfig.service.resolveDisclaimer / resolveProhibitedTerms.

// {msoEntityShortName} / {lawFirmEntityName} are substituted at resolve time.
// When the law firm entity isn't configured yet, the firm-clause sentence is
// swapped for FALLBACK_DISCLAIMER_UNCONFIGURED_FIRM_CLAUSE instead of ever
// interpolating an empty name into client-facing legal copy.
const FALLBACK_DISCLAIMER_TEMPLATE =
  "{msoEntityShortName} is not a law firm and does not provide legal advice. " +
  "Legal services are provided exclusively by {lawFirmEntityName}, an independent, attorney-supervised law firm.";

const FALLBACK_DISCLAIMER_UNCONFIGURED_FIRM_CLAUSE =
  "{msoEntityShortName} is not a law firm and does not provide legal advice. " +
  "Where legal services are provided, they are provided exclusively by an independent, attorney-supervised law firm.";

// Release-blocking terms (PRD). Case-insensitive, word-boundary matched by
// copyLint.service — this is a fallback; Settings.prohibitedTerms overrides
// and extends it. Multi-word entries are treated as literal phrases.
const DEFAULT_PROHIBITED_TERMS = [
  "guaranteed",
  "guarantee",
  "approved",
  "100% success",
  "legal advice",
  "visa approval",
  "risk-free",
  "no risk",
  "sure thing",
];

// Soft (warn, not block) terms — configurable via Settings in the future;
// for now a small fixed set the lint service treats as advisory only.
const DEFAULT_SOFT_TERMS = ["eligible", "qualify", "likely"];

module.exports = {
  FALLBACK_DISCLAIMER_TEMPLATE,
  FALLBACK_DISCLAIMER_UNCONFIGURED_FIRM_CLAUSE,
  DEFAULT_PROHIBITED_TERMS,
  DEFAULT_SOFT_TERMS,
};
