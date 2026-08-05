const DOCUMENT_REQUIREMENTS = {
  default: ["passport"],
  // Keys below must match the real `documentType` values used by the canonical
  // checklist (Backend/src/modules/employment-workflow/questionnaires/{h1b,l1a}.js,
  // surfaced as Questionnaire "file" questions via employmentChecklists.js) —
  // not arbitrary slugs, or REQUIRED_DOCUMENT_MISSING will false-positive against
  // documents that were actually uploaded under their real type.
  H1B: ["passport", "updated_resume", "academic_certificates", "employment_offer_letter"],
  "H-1B": ["passport", "updated_resume", "academic_certificates", "employment_offer_letter"],
  L1A: ["passport", "updated_resume", "beneficiary_offer_letter"],
  "L-1A": ["passport", "updated_resume", "beneficiary_offer_letter"],
  // L1B has no canonical checklist yet (Backend/src/modules/employment-workflow/questionnaires/registry.js
  // only matches L-1A) — left as the old placeholder keys pending that checklist definition.
  L1B: ["passport", "resume", "employment_letter"],
  "L-1B": ["passport", "resume", "employment_letter"],
  O1A: ["passport", "resume", "award", "publication", "recommendation_letter"],
  "O-1A": ["passport", "resume", "award", "publication", "recommendation_letter"],
  EB1A: ["passport", "resume", "award", "publication", "recommendation_letter"],
  "EB-1A": ["passport", "resume", "award", "publication", "recommendation_letter"],
  EB2NIW: ["passport", "resume", "degree", "publication", "recommendation_letter"],
  "EB-2 NIW": ["passport", "resume", "degree", "publication", "recommendation_letter"],
  N400: ["green_card", "tax_return", "travel_history"],
  "N-400": ["green_card", "tax_return", "travel_history"],
  I130: ["passport", "marriage_certificate", "birth_certificate"],
  "I-130": ["passport", "marriage_certificate", "birth_certificate"],
  I485: ["passport", "birth_certificate", "i94"],
  "I-485": ["passport", "birth_certificate", "i94"],
};

function normalizeKey(value = "") {
  return String(value).trim().replace(/[\s_-]+/g, "").toUpperCase();
}

function requirementsFor(profile = {}) {
  const visaType = profile.case?.visaType || profile.immigration?.currentVisaType || profile.beneficiary?.visaType;
  const rawKeys = [visaType, normalizeKey(visaType), profile.case?.petitionType, profile.case?.visaCategory].filter(Boolean);
  const matched = rawKeys.find((key) => DOCUMENT_REQUIREMENTS[key] || DOCUMENT_REQUIREMENTS[normalizeKey(key)]);
  return matched ? (DOCUMENT_REQUIREMENTS[matched] || DOCUMENT_REQUIREMENTS[normalizeKey(matched)]) : DOCUMENT_REQUIREMENTS.default;
}

module.exports = {
  DOCUMENT_REQUIREMENTS,
  requirementsFor,
};
