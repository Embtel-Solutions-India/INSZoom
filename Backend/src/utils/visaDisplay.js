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

function resolveDisplayVisa(caseData) {
  const variant = caseData?.questionnaireData?.masterData?.visaVariant;
  if (variant) return variant;
  const visaType = caseData?.visaType || "";
  const subType = caseData?.petitionSubType;
  return subType && getSubTypes(visaType).includes(subType) ? subType : visaType;
}

module.exports = { resolveDisplayVisa };
