/**
 * Frontend mirror of Backend/src/config/visaTypes.js — visa type is captured
 * under a mix of spellings across this app ("L-1A", "l1a", "L1A", "L-1"...);
 * this only gives call sites one shared, format-tolerant way to check "is this
 * case visa X", replacing the copy-pasted isH1BCase/isL1ACase regex helpers
 * that used to live separately in Documents.jsx, Profile.jsx, and Dashboard.jsx.
 * Keep the matching rules in sync with the backend file.
 */

const MATCHERS = {
  H1B: /h[\s-]?1b/i,
  L1A: /l[\s-]?1a\b/i,
  L1B: /l[\s-]?1b\b/i,
};

function visaTypeText(caseData = {}, client = {}) {
  return `${caseData?.visaType || ""} ${caseData?.petitionType || ""} ${client?.visaType || ""}`;
}

/**
 * True when the given case's (and optionally the client profile's, as a
 * fallback) visaType/petitionType matches the canonical visa key.
 */
export function isVisaType(caseData, canonicalKey, client) {
  const matcher = MATCHERS[canonicalKey];
  return matcher ? matcher.test(visaTypeText(caseData, client)) : false;
}

export function isH1BCase(caseData, client) {
  return isVisaType(caseData, "H1B", client);
}

export function isL1ACase(caseData, client) {
  return isVisaType(caseData, "L1A", client);
}
