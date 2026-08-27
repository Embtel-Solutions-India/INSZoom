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
