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
  // Kept as its own registry key (fromStatus:"F-1" still wins the specificity
  // check in resolveTransitionFilingType over the wildcard COS_B2 below, so
  // routing/case data referencing this key is unaffected) — but its content
  // is now the same real COS_TO_B2 checklist every other source status gets
  // (cos_b2_questionnaire), not a separate F-1-only scaffold. This avoids
  // the exact "per-source-visa checklist" duplication (H1B_TO_B1/F1_TO_B1/
  // L1_TO_B1-style) the COS-to-B1/B2 task explicitly forbids.
  F1_TO_B2: {
    key: "F1_TO_B2",
    label: "F-1 to B-2 Change of Status",
    category: "change_of_status",
    includesEad: false,
    isTransition: true,
    fromStatus: "F-1",
    toStatus: "B-2",
    visaType: "COSB2",
    questionnaireKey: "cos_b2_questionnaire",
  },
  // Wildcard (any current status) -> B-1. See COS_F1/COS_F2 above for the
  // same "fromStatus: null" pattern.
  COS_B1: {
    key: "COS_B1",
    label: "Change of Status to B-1 (Business Visitor)",
    category: "change_of_status",
    includesEad: false,
    isTransition: true,
    fromStatus: null,
    toStatus: "B-1",
    visaType: "COSB1",
    questionnaireKey: "cos_b1_questionnaire",
  },
  // Wildcard (any current status) -> H-4 (dependent). Selected through the same transition picker as the other change-of-status filings;
  // the principal H-1B case can be linked via Case.principalCaseRef.
  COS_H4: {
    key: "COS_H4",
    label: "Change of Status to H-4",
    category: "change_of_status",
    includesEad: false,
    isTransition: true,
    fromStatus: null,
    toStatus: "H-4",
    visaType: "COSH4",
    questionnaireKey: "cos_h4_questionnaire",
  },
  // Wildcard (any current status) -> B-2. F1_TO_B2 above is more specific
  // (fromStatus:"F-1") and wins for that one pair, per
  // resolveTransitionFilingType's specificity rule — but it now shares this
  // same cos_b2_questionnaire content, so every current-status -> B-2 case
  // gets identical COS_TO_B2 content regardless of which registry key it
  // resolved through.
  COS_B2: {
    key: "COS_B2",
    label: "Change of Status to B-2 (Tourist Visitor)",
    category: "change_of_status",
    includesEad: false,
    isTransition: true,
    fromStatus: null,
    toStatus: "B-2",
    visaType: "COSB2",
    questionnaireKey: "cos_b2_questionnaire",
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
  // Standalone H-4 EAD (no extension of H-4 status itself) — the third leg
  // of the H4 decision matrix alongside H4_EXTENSION and
  // H4_EXTENSION_EAD (see resolveH4Checklist in h4Checklist.util.js, the
  // single source of truth for which of the three applies).
  H4_EAD: {
    key: "H4_EAD",
    label: "H-4 EAD",
    category: "ead",
    includesEad: true,
    isTransition: false,
    fromStatus: null,
    toStatus: null,
    visaType: "H4EAD",
    questionnaireKey: "h4_ead_questionnaire",
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
  // "I-765 EAD": standalone EAD case type with exactly the H-4 EAD checklist
  // (h4Checklist.js's I765_EAD_CHECKLIST_DEFINITIONS) and Form I-765 only.
  // Separate from EAD/EADI765 above (scaffold-only, never offered).
  I765_EAD: {
    key: "I765_EAD",
    label: "I-765 EAD",
    category: "ead",
    includesEad: true,
    isTransition: false,
    fromStatus: null,
    toStatus: null,
    visaType: "I765EAD",
    questionnaireKey: "i765_ead_questionnaire",
  },
  // ---- Indian Timeline Cases (single-person, no forms): OCI and its subtypes. Case.visaType = "OCI"; the subtype is this key. Not part of the status-change / extension / EAD pickers
  // (groupedForSelection skips section "indian_timeline"); the Admin "New case" form picks it through the OCI subtype dropdown.
  OCI_ADULT_FORMER_INDIAN_PASSPORT: {
    key: "OCI_ADULT_FORMER_INDIAN_PASSPORT",
    label: "Adult Foreign citizen and held Indian passport",
    category: "indian_timeline",
    section: "indian_timeline",
    includesEad: false,
    isTransition: false,
    fromStatus: null,
    toStatus: null,
    visaType: "OCI",
    questionnaireKey: "oci_adult_former_indian_passport_checklist",
  },
  OCI_ADULT_FOREIGN_CITIZEN_BY_BIRTH: {
    key: "OCI_ADULT_FOREIGN_CITIZEN_BY_BIRTH",
    label: "Adult Foreign citizen by birth and never held Indian passport",
    category: "indian_timeline",
    section: "indian_timeline",
    includesEad: false,
    isTransition: false,
    fromStatus: null,
    toStatus: null,
    visaType: "OCI",
    questionnaireKey: "oci_adult_foreign_citizen_by_birth_checklist",
  },
  OCI_MINOR_FOREIGN_CITIZEN_NEVER_HELD: {
    key: "OCI_MINOR_FOREIGN_CITIZEN_NEVER_HELD",
    label: "Minor Foreign citizen and never held Indian passport",
    category: "indian_timeline",
    section: "indian_timeline",
    includesEad: false,
    isTransition: false,
    fromStatus: null,
    toStatus: null,
    visaType: "OCI",
    questionnaireKey: "oci_minor_foreign_citizen_never_held_passport_checklist",
  },
  OCI_SPOUSE_OF_FOREIGN_ORIGIN: {
    key: "OCI_SPOUSE_OF_FOREIGN_ORIGIN",
    label: "OCI Checklist for Spouse of Foreign Origin",
    category: "indian_timeline",
    section: "indian_timeline",
    includesEad: false,
    isTransition: false,
    fromStatus: null,
    toStatus: null,
    visaType: "OCI",
    questionnaireKey: "oci_spouse_of_foreign_origin_checklist",
  },
  OCI_MINOR_FOREIGN_CITIZEN_HELD: {
    key: "OCI_MINOR_FOREIGN_CITIZEN_HELD",
    label: "Minor Foreign citizen and held Indian passport",
    category: "indian_timeline",
    section: "indian_timeline",
    includesEad: false,
    isTransition: false,
    fromStatus: null,
    toStatus: null,
    visaType: "OCI",
    questionnaireKey: "oci_minor_foreign_citizen_held_passport_checklist",
  },
  // US Passport Renewal for Minors (also an Indian Timeline Cases visa type): single-person, no forms; the DS-11 checklist for a child under 16.
  US_PASSPORT_MINOR_DS11: {
    key: "US_PASSPORT_MINOR_DS11",
    label: "US Passport Renewal for Minors (DS-11, under age 16)",
    category: "indian_timeline",
    section: "indian_timeline",
    includesEad: false,
    isTransition: false,
    fromStatus: null,
    toStatus: null,
    visaType: "US-PASSPORT-MINOR",
    questionnaireKey: "us_passport_minor_ds11_checklist",
  },
  // Indian E-Tourist Visa (Indian Timeline Cases): single-person, checklist-only, NO forms. Subtype 1 = Business Visa (its own checklist).
  // Subtype 2 = E-Visa (its own checklist, questionnaires/indianEtouristEvisaChecklist.js).
  INDIAN_ETOURIST_BUSINESS: {
    key: "INDIAN_ETOURIST_BUSINESS",
    label: "Business Visa",
    category: "indian_timeline",
    section: "indian_timeline",
    includesEad: false,
    isTransition: false,
    fromStatus: null,
    toStatus: null,
    visaType: "INDIAN-E-TOURIST-VISA",
    questionnaireKey: "indian_etourist_business_visa_checklist",
  },
  INDIAN_ETOURIST_SUBTYPE_2: {
    key: "INDIAN_ETOURIST_SUBTYPE_2",
    label: "E-Visa",
    category: "indian_timeline",
    section: "indian_timeline",
    includesEad: false,
    isTransition: false,
    fromStatus: null,
    toStatus: null,
    visaType: "INDIAN-E-TOURIST-VISA",
    questionnaireKey: "indian_etourist_evisa_checklist",
  },
  // Renunciation (Indian Timeline Cases): single-person, checklist-only, NO forms. One filing type (and one checklist) per subtype. Subtype 1 = Minor without Indian passport
  // (questionnaires/renunciationMinorNoPassportChecklist.js). Each later subtype is added here with its own questionnaireKey.
  RENUNCIATION_MINOR_WITHOUT_INDIAN_PASSPORT: {
    key: "RENUNCIATION_MINOR_WITHOUT_INDIAN_PASSPORT",
    label: "Minor without Indian passport",
    category: "indian_timeline",
    section: "indian_timeline",
    includesEad: false,
    isTransition: false,
    fromStatus: null,
    toStatus: null,
    visaType: "RENUNCIATION",
    questionnaireKey: "renunciation_minor_without_indian_passport_checklist",
  },
  // Renunciation subtype 2 = Adult Indian Citizen without Indian Passport (questionnaires/renunciationAdultNoPassportChecklist.js).
  RENUNCIATION_ADULT_INDIAN_WITHOUT_PASSPORT: {
    key: "RENUNCIATION_ADULT_INDIAN_WITHOUT_PASSPORT",
    label: "Adult Indian Citizen without Indian Passport",
    category: "indian_timeline",
    section: "indian_timeline",
    includesEad: false,
    isTransition: false,
    fromStatus: null,
    toStatus: null,
    visaType: "RENUNCIATION",
    questionnaireKey: "renunciation_adult_indian_without_passport_checklist",
  },
  // Renunciation subtype 3 = Minor Indian Passport Holder (questionnaires/renunciationMinorHolderChecklist.js).
  RENUNCIATION_MINOR_INDIAN_PASSPORT_HOLDER: {
    key: "RENUNCIATION_MINOR_INDIAN_PASSPORT_HOLDER",
    label: "Minor Indian Passport Holder",
    category: "indian_timeline",
    section: "indian_timeline",
    includesEad: false,
    isTransition: false,
    fromStatus: null,
    toStatus: null,
    visaType: "RENUNCIATION",
    questionnaireKey: "renunciation_minor_indian_passport_holder_checklist",
  },
  // Renunciation subtype 4 = Adult Indian Passport Holder (questionnaires/renunciationAdultHolderChecklist.js).
  RENUNCIATION_ADULT_INDIAN_PASSPORT_HOLDER: {
    key: "RENUNCIATION_ADULT_INDIAN_PASSPORT_HOLDER",
    label: "Adult Indian Passport Holder",
    category: "indian_timeline",
    section: "indian_timeline",
    includesEad: false,
    isTransition: false,
    fromStatus: null,
    toStatus: null,
    visaType: "RENUNCIATION",
    questionnaireKey: "renunciation_adult_indian_passport_holder_checklist",
  },
  // Indian Passport Renewal (Indian Timeline Cases): single-person, checklist-only, NO forms. One filing type (and one checklist) per subtype. Subtype 1 = Minor Indian Passport
  // Holder (questionnaires/indianPassportRenewalMinorChecklist.js). Each later subtype is added here with its own questionnaireKey.
  INDIAN_PASSPORT_RENEWAL_MINOR_HOLDER: {
    key: "INDIAN_PASSPORT_RENEWAL_MINOR_HOLDER",
    label: "Minor Indian Passport Holder",
    category: "indian_timeline",
    section: "indian_timeline",
    includesEad: false,
    isTransition: false,
    fromStatus: null,
    toStatus: null,
    visaType: "INDIAN-PASSPORT-RENEWAL",
    questionnaireKey: "indian_passport_renewal_minor_holder_checklist",
  },
  // Indian Passport Renewal subtype 2 = Minor Indian in Lieu of lost Passport (questionnaires/indianPassportRenewalLostPassportChecklist.js).
  INDIAN_PASSPORT_RENEWAL_MINOR_LOST_PASSPORT: {
    key: "INDIAN_PASSPORT_RENEWAL_MINOR_LOST_PASSPORT",
    label: "Minor Indian in Lieu of lost Passport",
    category: "indian_timeline",
    section: "indian_timeline",
    includesEad: false,
    isTransition: false,
    fromStatus: null,
    toStatus: null,
    visaType: "INDIAN-PASSPORT-RENEWAL",
    questionnaireKey: "indian_passport_renewal_minor_lost_passport_checklist",
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
  const all = listFilingTypes().filter((entry) => entry.section !== "indian_timeline"); // OCI & co. have their own subtype dropdown
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
