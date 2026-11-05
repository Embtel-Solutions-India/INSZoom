// General visa-variant display helper (mirrors Backend/src/utils/visaDisplay.js).
// Some visa families have a variant the applicant selects (O-1 -> O-1A/O-1B;
// P -> P-1A/P-1B/P-3) that IS the visa they chose, and must display as such
// rather than the bare family key. The selected variant is mirrored onto
// case.questionnaireData.masterData.visaVariant automatically the moment its
// question is answered, so every case object already returned by the API
// carries it — no extra fetch needed.
export const H1B_SUBTYPES = ['New H-1B', 'H-1B Extension', 'H-1B Transfer', 'H-1B Amendment', 'H-1B Concurrent']

// Single-party filing types are STORED under compact codes (H4EAD, I765EAD, COSF1 ...) that routing and the registry depend on; every screen SHOWS their proper name.
export const FILING_TYPE_NAMES = {
  H4EXTENSION: 'H-4 Extension',
  H4EAD: 'H-4 EAD',
  H4EXTENSIONEAD: 'H-4 Extension + EAD',
  I765EAD: 'I-765 EAD',
  COSF1: 'Change of Status to F-1',
  F1REINSTATEMENT: 'F-1 Reinstatement',
  COSF2: 'Change of Status to F-2',
  COSB1: 'Change of Status to B-1',
  COSB2: 'Change of Status to B-2',
  COSH4: 'Change of Status to H-4',
  // citizenship filings are shown with their form number
  'Naturalization': 'N-400 - Naturalization',
  'Certificate of Citizenship': 'N-600 - Certificate of Citizenship',
  'Replacement Citizenship Certificate': 'N-565 - Replacement Citizenship/Naturalization Document',
}
export const visaName = (code) => FILING_TYPE_NAMES[code] || code || ''

export function resolveDisplayVisa(caseItem) {
  const variant = caseItem?.questionnaireData?.masterData?.visaVariant
  if (variant) return variant
  // H-1B's staff-chosen filing type (Case.petitionSubType) IS the visa it displays as; visaType stays "H-1B" for routing.
  if (caseItem?.visaType === 'H-1B' && H1B_SUBTYPES.includes(caseItem?.petitionSubType)) return caseItem.petitionSubType
  return visaName(caseItem?.visaType)
}
