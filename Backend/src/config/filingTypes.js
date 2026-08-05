// Registry for the THIRD structural pattern: single-party individual
// filings — the applicant fills exactly ONE checklist for themselves, with
// NO second party (no employer/employee, no petitioner/beneficiary, no
// invite). Distinct from:
//   - employment-workflow (employer/employee, two-party)
//   - family-workflow (petitioner/beneficiary, two-party)
// This registry is additive and does not touch either of those.
//
// Each entry:
//   key              - stable registry key (also used as the API path param)
//   label            - display label for the selection UX
//   category         - "change_of_status" | "extension" | "ead" | "reinstatement"
//   includesEad      - true only for filing types that bundle an EAD request
//                       alongside their primary category (H-4 Extension + EAD)
//   isTransition     - true if this filing type is offered via the
//                       current-status -> desired-status picker; false if it's
//                       a standalone, named option
//   fromStatus       - for isTransition:true entries with a SPECIFIC required
//                       current status (e.g. F-1 -> B-2); null means "any
//                       current status" (e.g. COS to F-1 doesn't care what
//                       status you're coming from)
//   toStatus         - the resulting status for isTransition:true entries;
//                       null for COS (General), which has no specific target
//   visaType         - the value stored on Case.visaType for a case of this
//                       filing type (dash/space-free, matching the existing
//                       single-party convention used by h1b_questionnaire/
//                       o1a_questionnaire/etc. — see questionnaire.service.js's
//                       getQuestionnaireForCase, which strips dashes/spaces
//                       and uppercases both sides before comparing)
//   questionnaireKey - the Questionnaire template's own `key`
//                       (singlePartyChecklists.js), used to look the
//                       checklist up directly rather than only by visaType
const FILING_TYPES = {
  COS_F1: {
    key: "COS_F1",
    label: "Change of Status to F-1 (Student)",
    category: "change_of_status",
    includesEad: false,
    isTransition: true,
    fromStatus: null,
    toStatus: "F-1",
    visaType: "COSF1",
    questionnaireKey: "cos_f1_questionnaire",
  },
  COS_F2: {
    key: "COS_F2",
    label: "Change of Status to F-2 (Dependent)",
    category: "change_of_status",
    includesEad: false,
    isTransition: true,
    fromStatus: null,
    toStatus: "F-2",
    visaType: "COSF2",
    questionnaireKey: "cos_f2_questionnaire",
  },
  // Not part of the from->to picker — it has no single specific target
  // status, so it's offered as its own named "General / Other" option
  // alongside the picker (falls back to this when neither COS_F1, COS_F2,
  // nor F1_TO_B2 is the right match).
  COS_GENERIC: {
    key: "COS_GENERIC",
    label: "Change of Status (General)",
    category: "change_of_status",
    includesEad: false,
    isTransition: false,
    fromStatus: null,
    toStatus: null,
    visaType: "COSGENERIC",
    questionnaireKey: "cos_generic_questionnaire",
  },
  // Standalone (named option), not a status transition — reinstates the
  // applicant's existing F-1 status rather than changing it.
  F1_REINSTATEMENT: {
    key: "F1_REINSTATEMENT",
    label: "F-1 Reinstatement",
    category: "reinstatement",
    includesEad: false,
    isTransition: false,
    fromStatus: null,
    toStatus: null,
    visaType: "F1REINSTATEMENT",
    questionnaireKey: "f1_reinstatement_questionnaire",
  },
  F1_TO_B2: {
    key: "F1_TO_B2",
    label: "F-1 to B-2 Change of Status",
    category: "change_of_status",
    includesEad: false,
    isTransition: true,
    fromStatus: "F-1",
    toStatus: "B-2",
    visaType: "F1TOB2",
    questionnaireKey: "f1_to_b2_questionnaire",
  },
  EAD: {
    key: "EAD",
    label: "Employment Authorization Document (Form I-765)",
    category: "ead",
    includesEad: true,
    isTransition: false,
    fromStatus: null,
    toStatus: null,
    visaType: "EADI765",
    questionnaireKey: "ead_i765_questionnaire",
  },
  H4_EXTENSION: {
    key: "H4_EXTENSION",
    label: "H-4 Extension",
    category: "extension",
    includesEad: false,
    isTransition: false,
    fromStatus: null,
    toStatus: null,
    visaType: "H4EXTENSION",
    questionnaireKey: "h4_extension_questionnaire",
  },
  H4_EXTENSION_EAD: {
    key: "H4_EXTENSION_EAD",
    label: "H-4 Extension + EAD",
    category: "extension",
    includesEad: true,
    isTransition: false,
    fromStatus: null,
    toStatus: null,
    visaType: "H4EXTENSIONEAD",
    questionnaireKey: "h4_extension_ead_questionnaire",
  },
};

function listFilingTypes() {
  return Object.values(FILING_TYPES);
}

function getFilingType(key) {
  return FILING_TYPES[String(key || "").toUpperCase()] || null;
}

// Groups the registry for the selection UX: transition entries (rendered via
// a current-status -> desired-status picker) vs. standalone entries
// (rendered as named options), further grouped by category within each.
function groupedForSelection() {
  const all = listFilingTypes();
  const transitions = all.filter((entry) => entry.isTransition);
  const standalone = all.filter((entry) => !entry.isTransition);
  const byCategory = (entries) => entries.reduce((acc, entry) => {
    acc[entry.category] = acc[entry.category] || [];
    acc[entry.category].push(entry);
    return acc;
  }, {});
  return {
    transitions,
    standalone,
    byCategory: byCategory(all),
  };
}

// Resolves a transition filing type from a (fromStatus, toStatus) pair
// chosen in the picker. Prefers the most specific match (an entry with a
// concrete fromStatus) over a wildcard (fromStatus: null, "any current
// status") match, so F-1 -> B-2 resolves to F1_TO_B2 rather than, say, a
// hypothetical wildcard-to-B-2 entry that also matched toStatus. Falls back
// to COS_GENERIC (a named/standalone entry, not itself a transition) when no
// transition entry matches at all, so the picker always resolves to
// something rather than a dead end.
function resolveTransitionFilingType(fromStatus, toStatus) {
  const normalizedFrom = String(fromStatus || "").trim().toUpperCase();
  const normalizedTo = String(toStatus || "").trim().toUpperCase();
  const candidates = listFilingTypes().filter((entry) => entry.isTransition && String(entry.toStatus || "").toUpperCase() === normalizedTo);
  const specific = candidates.find((entry) => String(entry.fromStatus || "").toUpperCase() === normalizedFrom);
  if (specific) return specific;
  const wildcard = candidates.find((entry) => !entry.fromStatus);
  if (wildcard) return wildcard;
  return FILING_TYPES.COS_GENERIC;
}

module.exports = {
  FILING_TYPES,
  listFilingTypes,
  getFilingType,
  groupedForSelection,
  resolveTransitionFilingType,
};
