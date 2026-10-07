// General visa-variant display helper (mirrors Backend/src/utils/visaDisplay.js
// and Admin/frontend/src/utils/visaDisplay.js). Some visa families have a
// variant the applicant selects (O-1 -> O-1A/O-1B; P -> P-1A/P-1B/P-3) that IS
// the visa they chose, and must display as such rather than the bare family
// key. The selected variant is mirrored onto
// case.questionnaireData.masterData.visaVariant automatically the moment its
// question is answered, so every case object already returned by the API
// carries it — no extra fetch needed.
export const H1B_SUBTYPES = ['New H-1B', 'H-1B Extension', 'H-1B Transfer', 'H-1B Amendment', 'H-1B Concurrent']

export function resolveDisplayVisa(caseItem) {
  const variant = caseItem?.questionnaireData?.masterData?.visaVariant
  if (variant) return variant
  // H-1B's staff-chosen filing type (Case.petitionSubType) IS the visa it displays as; visaType stays "H-1B" for routing.
  if (caseItem?.visaType === 'H-1B' && H1B_SUBTYPES.includes(caseItem?.petitionSubType)) return caseItem.petitionSubType
  return caseItem?.visaType || ''
}
