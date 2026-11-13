// What the client sees as a case's "Visa category" and "Visa type" (Client app only - Landing and the shared visaDisplay.js are deliberately untouched).
//
// Indian Timeline cases (visaCategory "indian_timeline"):
//   - Visa category: shown by the SUBTYPE the case manager chose, stored as the case's petitionType (for example "Adult Indian Passport Holder"), because the raw category
//     code tells the client nothing. With no subtype, the visa type's own name is shown (the same name the "Visa type" column shows).
//   - Visa type: the new Indian Timeline types are stored under registry codes ("INDIAN-PASSPORT-RENEWAL"); the client sees their proper name. OCI is already readable.
// EVERY other visa category / type is returned exactly as it was, so no other visa is affected.
//
// Display only: nothing here changes a stored visaCategory / petitionType / visaType, and nothing throws (missing data falls back to the visa type name, then to "").
import { resolveDisplayVisa } from "./visaDisplay";

export const INDIAN_TIMELINE_CATEGORY = "indian_timeline";

const INDIAN_TIMELINE_VISA_NAMES = {
  "INDIAN-PASSPORT-RENEWAL": "Indian Passport Renewal",
  RENUNCIATION: "Renunciation",
  "INDIAN-E-TOURIST-VISA": "Indian E-Tourist Visa",
  "US-PASSPORT-MINOR": "US Passport Renewal",
};

// The visa's display name: the readable name for an Indian Timeline code, otherwise exactly what resolveDisplayVisa returns.
export function caseVisaTypeLabel(caseData) {
  return INDIAN_TIMELINE_VISA_NAMES[caseData?.visaType] || resolveDisplayVisa(caseData);
}

export function caseCategoryLabel(caseData) {
  const category = caseData?.visaCategory;
  if (category !== INDIAN_TIMELINE_CATEGORY) return category;
  const subtype = typeof caseData?.petitionType === "string" ? caseData.petitionType.trim() : "";
  return subtype || caseVisaTypeLabel(caseData) || "";
}
