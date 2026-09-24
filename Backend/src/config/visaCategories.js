/**
 * Visa Category Lookup Table
 *
 * Maps every supported visa type string to:
 *   - caseStructure: the structural type for Case.caseStructure
 *   - forms: USCIS form IDs associated with this visa type
 *
 * This is the SINGLE SOURCE OF TRUTH for visa classification.
 * Route handlers and services must import from here — never duplicate this logic inline.
 *
 * To add a new visa type:
 *   1. Add it here with the correct caseStructure and forms
 *   2. Ensure USCISFormTemplate records exist for each form listed
 *   3. Ensure USCISMappingVersion records exist for each form listed
 *   Do NOT add it directly to a route handler or controller.
 *
 * Every key string here must exactly match a `visaType` value in the
 * VisaFormMapping registry (src/modules/form-registry/seeds/visaFormMappings.seed.js)
 * — that registry is what actually determines which USCIS forms get
 * auto-assigned to a case (see uscis-form.service.js's
 * latestTemplatesByAssignmentRules/ensureAssignedForms). A visa type
 * recognized here but absent from that registry will pass case creation but
 * never have any forms auto-assigned, so the two must be kept in sync.
 * Existing keys are never renamed/removed here even if the registry's
 * naming differs slightly (e.g. "TN" vs "TN Canada"/"TN Mexico") — a case
 * already created with the old string must keep resolving. New entries
 * below use the registry's exact string.
 */

const VISA_CATEGORIES = {
  // ─── EMPLOYER / EMPLOYEE VISAS ───────────────────────────────────────────
  "H-1B": {
    caseStructure: "employer_employee",
    forms: ["i-129", "i-907"],
    label: "H-1B Specialty Occupation",
  },
  "H-1B1": {
    caseStructure: "employer_employee",
    forms: ["i-129"],
    label: "H-1B1 (Chile/Singapore)",
  },
  "L-1A": {
    caseStructure: "employer_employee",
    forms: ["i-129"],
    label: "L-1A Intracompany Manager/Executive",
  },
  "L-1B": {
    caseStructure: "employer_employee",
    forms: ["i-129"],
    label: "L-1B Intracompany Specialized Knowledge",
  },
  "O-1A": {
    caseStructure: "employer_employee",
    forms: ["i-129"],
    label: "O-1A Extraordinary Ability (Science/Business/Athletics)",
  },
  "O-1B": {
    caseStructure: "employer_employee",
    forms: ["i-129"],
    label: "O-1B Extraordinary Ability (Arts/Film/TV)",
  },
  "O-2": {
    caseStructure: "employer_employee",
    forms: ["i-129"],
    label: "O-2 Support Personnel for O-1B",
  },
  "P-1A": {
    caseStructure: "employer_employee",
    forms: ["i-129"],
    label: "P-1A Internationally Recognized Athlete",
  },
  "P-1B": {
    caseStructure: "employer_employee",
    forms: ["i-129"],
    label: "P-1B Internationally Recognized Entertainment Group",
  },
  "P-2": {
    caseStructure: "employer_employee",
    forms: ["i-129"],
    label: "P-2 Artist/Entertainer (Reciprocal Exchange)",
  },
  "P-3": {
    caseStructure: "employer_employee",
    forms: ["i-129"],
    label: "P-3 Artist/Entertainer (Culturally Unique)",
  },
  TN: {
    caseStructure: "employer_employee",
    forms: ["i-129"],
    label: "TN Trade NAFTA/USMCA",
  },
  "E-1": {
    caseStructure: "employer_employee",
    forms: ["i-129"],
    label: "E-1 Treaty Trader",
  },
  "E-2": {
    caseStructure: "employer_employee",
    forms: ["i-129"],
    label: "E-2 Treaty Investor",
  },
  "E-3": {
    caseStructure: "employer_employee",
    forms: ["i-129"],
    label: "E-3 Australian Specialty Occupation",
  },
  "R-1": {
    caseStructure: "employer_employee",
    forms: ["i-129"],
    label: "R-1 Religious Worker",
  },

  // ─── FAMILY VISAS ─────────────────────────────────────────────────────────
  "K-1": {
    caseStructure: "family",
    forms: ["i-129f"],
    label: "K-1 Fiancé(e) Visa",
  },
  "K-3": {
    caseStructure: "family",
    forms: ["i-129f"],
    label: "K-3 Spouse of U.S. Citizen (Abroad)",
  },
  "IR-1": {
    caseStructure: "family",
    forms: ["i-130"],
    label: "IR-1 Immediate Relative Spouse",
  },
  "IR-2": {
    caseStructure: "family",
    forms: ["i-130"],
    label: "IR-2 Child of U.S. Citizen",
  },
  "IR-5": {
    caseStructure: "family",
    forms: ["i-130"],
    label: "IR-5 Parent of U.S. Citizen",
  },
  "F-1-FAMILY": {
    caseStructure: "family",
    forms: ["i-130"],
    label: "F-1 Family Preference",
  },
  "F-2A": {
    caseStructure: "family",
    forms: ["i-130"],
    label: "F-2A Spouse/Child of LPR",
  },

  // ─── SINGLE-PERSON VISAS ──────────────────────────────────────────────────
  "I-485-AOS": {
    caseStructure: "single",
    forms: ["i-485"],
    label: "Adjustment of Status",
  },
  "I-539-EXT": {
    caseStructure: "single",
    forms: ["i-539"],
    label: "Extension of Stay",
  },
  "I-539-COS": {
    caseStructure: "single",
    forms: ["i-539"],
    label: "Change of Status",
  },
  "I-131": {
    caseStructure: "single",
    forms: ["i-131"],
    label: "Travel Document / Advance Parole",
  },
  "I-765": {
    caseStructure: "single",
    forms: ["i-765"],
    label: "Employment Authorization Document (EAD)",
  },
  "I-134": {
    caseStructure: "single",
    forms: ["i-134"],
    label: "Declaration of Financial Support",
  },

  // ─── ADDITIONAL H/L/O/P/Q/R/E/TN VARIANTS (registry-exact strings) ───────
  "H-1B1 Chile": { caseStructure: "employer_employee", forms: ["i-129"], label: "H-1B1 (Chile)" },
  "H-1B1 Singapore": { caseStructure: "employer_employee", forms: ["i-129"], label: "H-1B1 (Singapore)" },
  "H-2A": { caseStructure: "employer_employee", forms: ["i-129"], label: "H-2A Agricultural Worker" },
  "H-2B": { caseStructure: "employer_employee", forms: ["i-129"], label: "H-2B Temporary Non-Agricultural Worker" },
  "H-3": { caseStructure: "employer_employee", forms: ["i-129"], label: "H-3 Trainee" },
  "H-4": { caseStructure: "single", forms: ["i-539"], label: "H-4 Dependent" },
  // Single-party filing-type variants (filingTypes.js's H4_EXTENSION/
  // H4_EAD/H4_EXTENSION_EAD) — distinct visaType strings stored on
  // Case.visaType for cases created via single-party-filing.controller.js,
  // kept in sync with the VisaFormMapping registry rows added for them
  // (visaFormMappings.seed.js's H4EXTENSION/H4EAD/H4EXTENSIONEAD block).
  "H4EXTENSION": { caseStructure: "single", forms: ["i-539"], label: "H-4 Extension" },
  "H4EAD": { caseStructure: "single", forms: ["i-765"], label: "H-4 EAD" },
  "H4EXTENSIONEAD": { caseStructure: "single", forms: ["i-539", "i-765"], label: "H-4 Extension + EAD" },
  // Single-party filing-type variant (filingTypes.js's COS_F2) — distinct
  // visaType string stored on Case.visaType for cases created via
  // single-party-filing.controller.js, separate from the generic "F-2"
  // entry above (used for F-2 cases created some other way, e.g. consular).
  "COSF2": { caseStructure: "single", forms: ["i-539"], label: "Change of Status to F-2" },
  "L-2": { caseStructure: "single", forms: ["i-539"], label: "L-2 Dependent" },
  "O-3": { caseStructure: "single", forms: ["i-539"], label: "O-3 Dependent" },
  "P-1": { caseStructure: "employer_employee", forms: ["i-129"], label: "P-1 Internationally Recognized Athlete/Entertainment Group" },
  "P-1S": { caseStructure: "employer_employee", forms: ["i-129"], label: "P-1S Essential Support Personnel" },
  "P-2S": { caseStructure: "employer_employee", forms: ["i-129"], label: "P-2S Essential Support Personnel" },
  "P-3S": { caseStructure: "employer_employee", forms: ["i-129"], label: "P-3S Essential Support Personnel" },
  "P-4": { caseStructure: "single", forms: ["i-539"], label: "P-4 Dependent" },
  "Q-1": { caseStructure: "employer_employee", forms: ["i-129"], label: "Q-1 Cultural Exchange Visitor" },
  "R-2": { caseStructure: "single", forms: ["i-539"], label: "R-2 Dependent" },
  "TN Canada": { caseStructure: "employer_employee", forms: ["i-129"], label: "TN Trade NAFTA/USMCA (Canada)" },
  "TN Mexico": { caseStructure: "employer_employee", forms: ["i-129"], label: "TN Trade NAFTA/USMCA (Mexico)" },

  // ─── STUDENT / EXCHANGE VISITOR ───────────────────────────────────────────
  "F-1": { caseStructure: "single", forms: ["i-539"], label: "F-1 Academic Student" },
  "F-2": { caseStructure: "single", forms: ["i-539"], label: "F-2 Dependent of F-1 Student" },
  "F-1 OPT": { caseStructure: "single", forms: ["i-765"], label: "F-1 Optional Practical Training" },
  "F-1 STEM OPT": { caseStructure: "single", forms: ["i-765"], label: "F-1 STEM OPT Extension" },
  "J-1": { caseStructure: "single", forms: ["i-539"], label: "J-1 Exchange Visitor" },
  "J-2": { caseStructure: "single", forms: ["i-539"], label: "J-2 Dependent of J-1" },
  "M-1": { caseStructure: "single", forms: ["i-539"], label: "M-1 Vocational Student" },
  "M-2": { caseStructure: "single", forms: ["i-539"], label: "M-2 Dependent of M-1" },

  // ─── VISITOR ───────────────────────────────────────────────────────────────
  "B-1": { caseStructure: "single", forms: ["i-539"], label: "B-1 Business Visitor" },
  "B-2": { caseStructure: "single", forms: ["i-539"], label: "B-2 Tourist Visitor" },
  "B-1/B-2": { caseStructure: "single", forms: ["i-539"], label: "B-1/B-2 Visitor" },

  // ─── HUMANITARIAN ──────────────────────────────────────────────────────────
  "U-1": { caseStructure: "single", forms: ["i-918"], label: "U-1 Victim of Qualifying Criminal Activity" },
  "U derivative": { caseStructure: "family", forms: ["i-918"], label: "U Derivative Family Member" },
  "SB-1": { caseStructure: "single", forms: ["ds-117"], label: "Returning Resident Visa (SB-1)" },

  // ─── EB-1 (EMPLOYMENT-BASED, FIRST PREFERENCE) ────────────────────────────
  "EB-1A": { caseStructure: "single", forms: ["i-140", "i-485"], label: "EB-1A Extraordinary Ability" },
  "EB-1B": { caseStructure: "employer_employee", forms: ["i-140", "i-485"], label: "EB-1B Outstanding Researcher/Professor" },
  "EB-1C": { caseStructure: "employer_employee", forms: ["i-140", "i-485"], label: "EB-1C Multinational Manager/Executive" },

  // ─── EB-2 (EMPLOYMENT-BASED, SECOND PREFERENCE) ───────────────────────────
  "EB-2 PERM": { caseStructure: "employer_employee", forms: ["i-140", "i-485"], label: "EB-2 (PERM Labor Certification)" },
  "EB-2 NIW": { caseStructure: "single", forms: ["i-140", "i-485"], label: "EB-2 National Interest Waiver" },
  // Plain "EB-2" is not a registry visaType (the registry only has the two
  // subtypes above), but pre-existing UI (Admin's CreateCaseModal) offers
  // it as a generic choice — recognized here as an alias for the standard
  // PERM-based pathway so it doesn't 400 at case creation.
  "EB-2": { caseStructure: "employer_employee", forms: ["i-140", "i-485"], label: "EB-2 (Advanced Degree/Exceptional Ability)" },

  // ─── EB-3 (EMPLOYMENT-BASED, THIRD PREFERENCE) ────────────────────────────
  "EB-3 Skilled Worker": { caseStructure: "employer_employee", forms: ["i-140", "i-485"], label: "EB-3 Skilled Worker" },
  "EB-3 Professional": { caseStructure: "employer_employee", forms: ["i-140", "i-485"], label: "EB-3 Professional" },
  "EB-3 Other Worker": { caseStructure: "employer_employee", forms: ["i-140", "i-485"], label: "EB-3 Other Worker" },
  // Plain "EB-3" alias, same reasoning as plain "EB-2" above.
  "EB-3": { caseStructure: "employer_employee", forms: ["i-140", "i-485"], label: "EB-3 (Skilled Worker/Professional/Other Worker)" },

  // ─── EB-4 (SPECIAL IMMIGRANTS) ─────────────────────────────────────────────
  "EB-4": { caseStructure: "single", forms: ["i-360", "i-485"], label: "EB-4 Special Immigrant" },

  // ─── EB-5 (IMMIGRANT INVESTOR) ─────────────────────────────────────────────
  "EB-5 Regional Center": { caseStructure: "single", forms: ["i-526e", "i-485"], label: "EB-5 Immigrant Investor (Regional Center)" },
  "EB-5 Standalone": { caseStructure: "single", forms: ["i-526", "i-485"], label: "EB-5 Immigrant Investor (Standalone)" },

  // ─── FAMILY-BASED (ADDITIONAL PREFERENCE CATEGORIES) ──────────────────────
  "CR-1": { caseStructure: "family", forms: ["i-130"], label: "CR-1 Conditional Resident Spouse" },
  "CR-2": { caseStructure: "family", forms: ["i-130"], label: "CR-2 Conditional Resident Child" },
  "IR-3": { caseStructure: "family", forms: ["i-130"], label: "IR-3 Orphan Adopted Abroad" },
  "IR-4": { caseStructure: "family", forms: ["i-130"], label: "IR-4 Orphan to Be Adopted in the U.S." },
  "K-2": { caseStructure: "family", forms: ["i-539"], label: "K-2 Derivative Child of K-1" },
  "K-4": { caseStructure: "family", forms: ["i-539"], label: "K-4 Derivative Child of K-3" },
  F1: { caseStructure: "family", forms: ["i-130"], label: "F1 Unmarried Son/Daughter of U.S. Citizen" },
  // Registry-exact "F2A" (no hyphen) — kept alongside the pre-existing
  // "F-2A" (with hyphen) below rather than replacing it, since an existing
  // case may already store either string.
  F2A: { caseStructure: "family", forms: ["i-130"], label: "F2A Spouse/Child of LPR" },
  F2B: { caseStructure: "family", forms: ["i-130"], label: "F2B Unmarried Son/Daughter of LPR" },
  F3: { caseStructure: "family", forms: ["i-130"], label: "F3 Married Son/Daughter of U.S. Citizen" },
  F4: { caseStructure: "family", forms: ["i-130"], label: "F4 Sibling of U.S. Citizen" },

  // ─── GREEN CARD / CITIZENSHIP WORKFLOWS (STANDALONE CASE TYPES) ───────────
  "Adjustment of Status": { caseStructure: "single", forms: ["i-485"], label: "Adjustment of Status" },
  "Conditional Green Card Removal": { caseStructure: "single", forms: ["i-751"], label: "Removal of Conditions on Residence" },
  // label is staff-facing (CreateCaseModal.jsx's case-type dropdown, CRM
  // displays) - the client never sees this string; the client sees the
  // Questionnaire's own title, "Renew, Replace, Correct or Update Green
  // Card" (greenCardRenewalChecklist.js), never "I-90".
  "Green Card Renewal": { caseStructure: "single", forms: ["i-90"], label: "Green Card Renewal / Replacement / Correction / Update" },
  "Re-entry Permit": { caseStructure: "single", forms: ["i-131"], label: "Re-entry Permit" },
  Naturalization: { caseStructure: "single", forms: ["n-400"], label: "Naturalization" },
  "Certificate of Citizenship": { caseStructure: "single", forms: ["n-600"], label: "Certificate of Citizenship" },
  "Replacement Citizenship Certificate": { caseStructure: "single", forms: ["n-565"], label: "Replacement Citizenship/Naturalization Document" },
};

/**
 * Look up the case structure for a given visa type string.
 * @param {string} visaType
 * @returns {'single'|'employer_employee'|'family'|null}
 */
function getCaseStructure(visaType) {
  return VISA_CATEGORIES[visaType]?.caseStructure ?? null;
}

/**
 * Look up the USCIS form IDs for a given visa type.
 * @param {string} visaType
 * @returns {string[]}
 */
function getFormIds(visaType) {
  return VISA_CATEGORIES[visaType]?.forms ?? [];
}

/**
 * Returns all visa types that have the given case structure.
 * @param {'single'|'employer_employee'|'family'} structure
 * @returns {string[]}
 */
function getVisaTypesByStructure(structure) {
  return Object.entries(VISA_CATEGORIES)
    .filter(([, v]) => v.caseStructure === structure)
    .map(([k]) => k);
}

module.exports = {
  VISA_CATEGORIES,
  getCaseStructure,
  getFormIds,
  getVisaTypesByStructure,
};
