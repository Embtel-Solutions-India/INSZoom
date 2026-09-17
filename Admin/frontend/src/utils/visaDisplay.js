// General visa-variant display helper (mirrors Backend/src/utils/visaDisplay.js).
// Some visa families have a variant the applicant selects (O-1 -> O-1A/O-1B;
// P -> P-1A/P-1B/P-3) that IS the visa they chose, and must display as such
// rather than the bare family key. The selected variant is mirrored onto
// case.questionnaireData.masterData.visaVariant automatically the moment its
// question is answered, so every case object already returned by the API
// carries it — no extra fetch needed.
export function resolveDisplayVisa(caseItem) {
  const variant = caseItem?.questionnaireData?.masterData?.visaVariant
  return variant || caseItem?.visaType || ''
}
