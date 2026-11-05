// General visa-variant display helper. Some visa families have a variant the
// applicant selects (O-1 -> O-1A/O-1B; P -> P-1A/P-1B/P-3) that IS the visa
// they chose, and must display as such rather than the bare family key. The
// selected variant is mirrored onto case.questionnaireData.masterData.visaVariant
// the moment its question is answered (see employmentChecklists.js's
// oClassification/pClassification fieldCatalog entries — masterDataPath:
// "visaVariant" — and questionnaire.service.js's buildMasterCaseData/
// inferMasterDataPath, which every saveAnswers() call already runs), so no
// extra query or schema field is needed here: this just prefers that value
// over the plain family visaType when present.
//
// H-1B is the other kind: its type (New H-1B / H-1B Extension / Transfer /
// Amendment / Concurrent) is chosen by staff at case creation and stored on
// Case.petitionSubType (config/visaCategories.js `subTypes`), so that is the
// visa it displays as. Case.visaType itself stays "H-1B" for routing.
const { getSubTypes } = require("../config/visaCategories");

// Single-party filing types are STORED under compact codes (H4EAD, I765EAD, COSF1 ...); every screen and e-mail SHOWS their proper name (config/filingTypes.js labels).
const FILING_TYPE_NAMES = {
  H4EXTENSION: "H-4 Extension",
  H4EAD: "H-4 EAD",
  H4EXTENSIONEAD: "H-4 Extension + EAD",
  I765EAD: "I-765 EAD",
  COSF1: "Change of Status to F-1",
  F1REINSTATEMENT: "F-1 Reinstatement",
  COSF2: "Change of Status to F-2",
  COSB1: "Change of Status to B-1",
  COSB2: "Change of Status to B-2",
  COSH4: "Change of Status to H-4",
  // citizenship filings are shown with their form number
  "Naturalization": "N-400 - Naturalization",
  "Certificate of Citizenship": "N-600 - Certificate of Citizenship",
  "Replacement Citizenship Certificate": "N-565 - Replacement Citizenship/Naturalization Document",
};

function resolveDisplayVisa(caseData) {
  const variant = caseData?.questionnaireData?.masterData?.visaVariant;
  if (variant) return variant;
  const visaType = caseData?.visaType || "";
  const subType = caseData?.petitionSubType;
  if (subType && getSubTypes(visaType).includes(subType)) return subType;
  return FILING_TYPE_NAMES[visaType] || visaType;
}

module.exports = { resolveDisplayVisa };
