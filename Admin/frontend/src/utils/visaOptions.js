import { useEffect, useMemo, useState } from 'react'
import { casesApi } from '../services/api'

// The ONE visa-type dropdown list. "New case" (CreateCaseModal), "Add employee" and the GoHighLevel "Visa selection required" banner all
// build their options here, so a case type added, removed or relabelled shows up in all of them with no second edit.
//
// The list itself lives on the SERVER (Backend/src/config/visaDropdown.js, served as `options` by GET /cases/visa-types and shared with the client
// portal's "Add employee"), so a change there reaches every portal. VISA_TYPE_OPTIONS below is only the emergency fallback for when that request
// fails; a backend test fails if the two ever differ.
export const VISA_TYPE_OPTIONS = [
  { value: 'h1b', label: 'H-1B' },
  { value: 'h1b1', label: 'H-1B1' },
  { value: 'l1a', label: 'L-1A' },
  { value: 'l1aextension', label: 'L-1A Extension', canonicalLabel: 'L-1A Extension' },
  { value: 'l1b', label: 'L-1B' },
  { value: 'o1a', label: 'O-1A' },
  { value: 'o1b', label: 'O-1B' },
  { value: 'o2', label: 'O-2' },
  { value: 'p1a', label: 'P-1A' },
  { value: 'p1b', label: 'P-1B' },
  { value: 'p2', label: 'P-2' },
  { value: 'p3', label: 'P-3' },
  { value: 'tn', label: 'TN' },
  { value: 'e1', label: 'E-1' },
  { value: 'e2', label: 'E-2' },
  { value: 'e3', label: 'E-3' },
  { value: 'r1', label: 'R-1' },
  { value: 'k1', label: 'K-1' },
  { value: 'k3', label: 'K-3' },
  // I-130/Green-Card/I-864 family-based classifications - previously
  // absent from this dropdown entirely, so staff had no way to create
  // these cases through the CRM at all (POST /family-workflow/cases had no
  // frontend caller anywhere in the app until this change). Underlying
  // `value` matches visaCategories.js's own spelling exactly, since that's
  // the real-world format Case.visaType/VisaFormMapping already key on -
  // only the LABEL adds "(I-130 / Green Card)" so a case manager sees at a
  // glance that picking any of these leads into the I-130/Green-Card
  // checklist+form logic (then the Filing Path selector below decides
  // Petition Only vs the fuller Green Card package). Listed inline with
  // every other visa type, same as before - no separate section/optgroup.
  { value: 'f1family', label: 'F1 (I-130 / Green Card)', canonicalLabel: 'F1' },
  // SB-1 is a single-person case (no petitioner / family subcases); canonicalLabel is the visa type the case is created with.
  // I-824 (Action on an Approved Application or Petition): its own two-party case (Petitioner + Beneficiary checklists), created through the family workflow.
  { value: 'i824', label: 'I-824', canonicalLabel: 'I-824' },
  // I-130 as its own two-party case type (petitioner + beneficiary checklists, every related form from the registry)
  { value: 'i130', label: 'I-130', canonicalLabel: 'I-130' },
  { value: 'i130i485', label: 'I-130 + I-485', canonicalLabel: 'I-130 + I-485' },
  // I-140 + I-485: employment based (employer + employee)
  { value: 'i140i485', label: 'I-140 + I-485', canonicalLabel: 'I-140/I-485' },
  // Indian Timeline Cases section: OCI (its subtype is chosen in the New case form)
  { value: 'oci', label: 'OCI - Overseas Citizen of India', canonicalLabel: 'OCI' },
  { value: 'uspassportminor', label: 'US Passport Renewal', canonicalLabel: 'US-PASSPORT-MINOR' },
  { value: 'indianetourist', label: 'Indian E-Tourist Visa', canonicalLabel: 'INDIAN-E-TOURIST-VISA' },
  { value: 'renunciation', label: 'Renunciation', canonicalLabel: 'RENUNCIATION' },
  { value: 'indianpassportrenewal', label: 'Indian Passport Renewal', canonicalLabel: 'INDIAN-PASSPORT-RENEWAL' },
  { value: 'usvisitorvisa', label: 'US Visitor Visa', canonicalLabel: 'US-VISITOR-VISA' },
  // I-485 is a single-person case type (the registry's "Adjustment of Status"): Green Card + I-864 checklists
  { value: 'adjustmentofstatus', label: 'I-485', canonicalLabel: 'Adjustment of Status' },
  { value: 'sb1', label: 'SB-1 Visa — Returning Resident', canonicalLabel: 'SB-1' },
  { value: 'i539cos', label: 'I-539-COS' },
  { value: 'i539ext', label: 'I-539-EXT' },
  { value: 'eb1a', label: 'EB-1A' },
  { value: 'eb1b', label: 'EB-1B' },
  { value: 'eb1c', label: 'EB-1C', canonicalLabel: 'EB-1C' },
  { value: 'eb2', label: 'EB-2' },
  { value: 'niw', label: 'EB-2 NIW' },
  { value: 'eb3', label: 'EB-3' },
  // DOL labor certification: an ordinary employer + employees matter (see PERM_STRUCTURE below).
  { value: 'perm', label: 'PERM (Labor Certification)', canonicalLabel: 'PERM' },
  // GC-NVC: one client checklist (DS-260 information), no USCIS forms - see visaCategories.js.
  { value: 'gcnvc', label: 'GC-NVC (Green Card - National Visa Center)', canonicalLabel: 'GC-NVC' },
  // Premium Processing as its own case: single party, Form I-907 only (see visaCategories.js).
  { value: 'premiumprocessing', label: 'Premium Processing (Form I-907)', canonicalLabel: 'Premium Processing' },
  // Standalone single-party filing types (Backend/src/config/filingTypes.js) -
  // no second party (no petitioner/beneficiary or employer/employee), so
  // these go through singlePartyFilingsApi.createCase (POST
  // /single-party-filings/cases) rather than the generic casesApi.create -
  // see SINGLE_PARTY_FILING_TYPE_KEYS below.
  { value: 'h4extension', label: 'H-4 Extension' },
  { value: 'h4ead', label: 'H-4 EAD' },
  { value: 'h4extensionead', label: 'H-4 Extension + EAD' },
  { value: 'i765ead', label: 'I-765 EAD' },
  { value: 'cosf1', label: 'Change of Status to F-1' },
  { value: 'f1reinstatement', label: 'F-1 Reinstatement' },
  { value: 'cosf2', label: 'Change of Status to F-2' },
  { value: 'cosb1', label: 'Change of Status to B-1' },
  { value: 'cosb2', label: 'Change of Status to B-2' },
  { value: 'cosh4', label: 'Change of Status to H-4' },
  // MTR: notice-response style case (no checklist) whose only form is I-290B - listed here so its label keeps "MTR".
  { value: 'mtr', label: 'MTR - Motion to Reopen', canonicalLabel: 'MTR' },
]

// The dropdown = the curated options above (they carry special routing/labels) + EVERY other case type the registry can create
// (GET /cases/visa-types, i.e. config/visaCategories.js - the list createCase validates against). A case type added to the registry
// therefore shows up here with no frontend change. Family-structure types are skipped: they only exist through the family workflow.
export const optionKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '')

// Visa types REMOVED from the product on 2026-11-12 (owner request): IR-1..IR-5, CR-1, CR-2, F2A, F2B, F3 and F4. The server no longer sends them, but a server that has not been
// updated yet (production until it is deployed) still does, and with the family sets above trimmed they would land under "Single applicant". They are never shown, whatever any
// server returns. (F1 and the student F-1 / F-2 types are different types and stay.)
export const REMOVED_VISA_KEYS = new Set(['ir1', 'ir2', 'ir3', 'ir4', 'ir5', 'cr1', 'cr2', 'f2a', 'f2b', 'f3', 'f4'])
export const isRemovedVisaOption = (option) => [option?.value, option?.canonicalLabel].some((key) => key && REMOVED_VISA_KEYS.has(optionKey(key)))
export const withoutRemovedVisas = (options) => (options || []).filter((option) => !isRemovedVisaOption(option))
// A single-form filing is listed by its form number ("N-400 - Naturalization", "N-600 - Certificate of Citizenship"), so each
// form is its own, clearly named entry. Types already named by their form number, and multi-form types, keep their name.
const formNumber = (formId) => String(formId || '').toUpperCase()
const registryLabel = (entry) => {
  const base = entry.label && entry.label !== entry.visaType ? `${entry.visaType} - ${entry.label}` : entry.visaType
  const forms = entry.forms || []
  if (forms.length !== 1 || entry.caseStructure !== 'single') return base
  const form = formNumber(forms[0])
  if (!form || optionKey(base).includes(optionKey(form))) return base
  return `${form} - ${entry.label || entry.visaType}`
}
export const mergeRegistryOptions = (registryTypes) => {
  const known = new Set(VISA_TYPE_OPTIONS.flatMap((opt) => [optionKey(opt.value), optionKey(opt.label), optionKey(opt.canonicalLabel)]))
  const extra = (registryTypes || [])
    .filter((entry) => entry.hasChecklist !== false && entry.caseStructure !== 'family' && !known.has(optionKey(entry.visaType)))
    .map((entry) => ({
      value: optionKey(entry.visaType),
      label: registryLabel(entry),
      canonicalLabel: entry.visaType,
      caseStructure: entry.caseStructure,
      fromRegistry: true,
    }))
    .sort((a, b) => a.canonicalLabel.localeCompare(b.canonicalLabel, undefined, { numeric: true }))
  // Case types with no checklist yet are not offered (a case of that type would sit empty). Only types the registry reports as
  // checklist-less are hidden; options the registry does not know about (special routing) stay.
  const withoutChecklist = new Set((registryTypes || []).filter((entry) => entry.hasChecklist === false).map((entry) => optionKey(entry.visaType)))
  const offered = VISA_TYPE_OPTIONS.filter((opt) => ![opt.value, opt.label, opt.canonicalLabel].some((key) => key && withoutChecklist.has(optionKey(key))))
  return [...offered, ...extra]
}

// case structure ('single' | 'employer_employee' | 'family') of each registry case type, keyed by optionKey(visaType)
export const structureByKey = (registryTypes) => new Map((registryTypes || []).map((entry) => [optionKey(entry.visaType), entry.caseStructure]))

// Loads the registry (GET /cases/visa-types) on every mount, so the lists are always current, and returns the shared options.
export function useVisaOptions({ enabled = true } = {}) {
  const [registryTypes, setRegistryTypes] = useState([])
  const [serverOptions, setServerOptions] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    casesApi.visaTypes()
      .then((res) => {
        if (cancelled) return
        setRegistryTypes((res.data?.data || []).filter((entry) => !REMOVED_VISA_KEYS.has(optionKey(entry.visaType))))
        // the server's own list (the same in every portal); an older server without it falls back to merging here
        if (Array.isArray(res.data?.options) && res.data.options.length) setServerOptions(withoutRemovedVisas(res.data.options))
      })
      .catch((err) => { console.error('Error fetching case types:', err); if (!cancelled) setError(true) }) // the curated list still works
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [enabled])
  const options = useMemo(() => serverOptions || mergeRegistryOptions(registryTypes), [serverOptions, registryTypes])
  return { options, registryTypes, loaded, error }
}

// The registry entry behind a dropdown option (matched on value / label / canonical label), or null for an option the registry
// does not know. Its `visaType` is the exact spelling the backend validates and stores.
export const registryEntryFor = (option, registryTypes) => {
  const keys = [option.value, option.canonicalLabel, option.label].map(optionKey).filter(Boolean)
  return (registryTypes || []).find((entry) => keys.includes(optionKey(entry.visaType))) || null
}

// Is this option an employer / employee matter according to the registry (GET /cases/visa-types)? Read for EVERY option, curated or not, so EB-2, EB-3,
// L-1A Extension ... get the employer + employee form like H-1B without a hard-coded list.
export const isEmployerEmployeeOption = (option, registryTypes) => registryEntryFor(option || {}, registryTypes)?.caseStructure === 'employer_employee'

// How the dropdown is grouped everywhere it is shown (New case, the GoHighLevel visa banner): employer cases first, then family visas, then single-party
// filings, each under a small grey heading; order inside a group is unchanged. These sets also steer which form "New case" shows for the chosen visa
// (components/CreateCaseModal.jsx imports them for that routing).
export const SINGLE_PARTY_FILING_TYPE_KEYS = {
  h4extension: 'H4_EXTENSION',
  h4ead: 'H4_EAD',
  h4extensionead: 'H4_EXTENSION_EAD',
  i765ead: 'I765_EAD',
  cosf1: 'COS_F1',
  f1reinstatement: 'F1_REINSTATEMENT',
  cosf2: 'COS_F2',
  cosb1: 'COS_B1',
  cosb2: 'COS_B2',
  cosh4: 'COS_H4',
}
// Indian Timeline Cases: single-person, no forms. Each visa type here has subtypes; the New case form shows a subtype dropdown and the subtype decides the checklist
// (the filingTypeKey is the single-party filing type that creates the case and assigns that subtype's checklist).
export const INDIAN_TIMELINE_VISA_TYPES = new Set(['oci', 'uspassportminor', 'indianetourist', 'renunciation', 'indianpassportrenewal', 'usvisitorvisa'])
export const INDIAN_TIMELINE_SUBTYPES = {
  oci: [{ value: 'OCI_ADULT_FORMER_INDIAN_PASSPORT', label: 'Adult Foreign citizen and held Indian passport', description: 'For adult foreign citizens who previously held an Indian passport and are applying for Overseas Citizen of India (OCI) registration.' },
    { value: 'OCI_ADULT_FOREIGN_CITIZEN_BY_BIRTH', label: 'Adult Foreign citizen and never held Indian passport', description: 'For adult foreign citizens born as foreign citizens who have never held an Indian passport and are applying for OCI registration.' },
    { value: 'OCI_MINOR_FOREIGN_CITIZEN_HELD', label: 'Minor Foreign citizen and held Indian passport', description: 'For minor foreign citizens who previously held an Indian passport and are applying for Overseas Citizen of India (OCI) registration.' },
    { value: 'OCI_MINOR_FOREIGN_CITIZEN_NEVER_HELD', label: 'Minor Foreign citizen and never held Indian passport', description: 'For minor foreign citizens who have never held an Indian passport and are applying for Overseas Citizen of India (OCI) registration.' },
    { value: 'OCI_SPOUSE_OF_FOREIGN_ORIGIN', label: 'OCI Checklist for Spouse of Foreign Origin', description: 'For eligible foreign-origin applicants applying for OCI registration through marriage to an Indian citizen or an OCI cardholder.' },
    { value: 'OCI_RENUNCIATION', label: 'OCI RENUNCIATION', description: 'OCI renunciation: document checklist and questionnaire.' }],
  indianetourist: [{ value: 'INDIAN_ETOURIST_BUSINESS', label: 'Business Visa', description: 'Indian Business Visa application questionnaire and mandatory document checklist.' },
    { value: 'INDIAN_ETOURIST_SUBTYPE_2', label: 'E-Visa', description: 'Indian E-Tourist Visa (E-Visa) questionnaire and mandatory document checklist.' }],
  renunciation: [{ value: 'RENUNCIATION_ADULT_INDIAN_WITHOUT_PASSPORT', label: 'Adult Indian Citizen without Indian Passport', description: 'Renunciation of Indian citizenship: checklist and questionnaire for an adult Indian citizen who does not hold an Indian passport.' },
    { value: 'RENUNCIATION_ADULT_INDIAN_PASSPORT_HOLDER', label: 'Adult Indian Passport Holder', description: 'Renunciation of Indian citizenship: checklist and questionnaire for an adult applicant who holds an Indian passport.' },
    { value: 'RENUNCIATION_MINOR_INDIAN_PASSPORT_HOLDER', label: 'Minor Indian Passport Holder', description: 'Renunciation of Indian citizenship: checklist and questionnaire for a minor applicant who holds an Indian passport.' },
    { value: 'RENUNCIATION_MINOR_WITHOUT_INDIAN_PASSPORT', label: 'Minor without Indian passport', description: 'Renunciation of Indian citizenship: checklist and questionnaire for a minor applicant without an Indian passport.' }],
  indianpassportrenewal: [{ value: 'INDIAN_PASSPORT_RENEWAL_ADULT_DAMAGE_PASSPORT', label: 'Adult Indian In Lieu of damage Passport', description: 'Indian Passport Renewal: document checklist and questionnaire for an adult Indian in lieu of a damaged passport.' },
    { value: 'INDIAN_PASSPORT_RENEWAL_ADULT_LOST_PASSPORT', label: 'Adult Indian In Lieu of lost Passport', description: 'Indian Passport Renewal: document checklist and questionnaire for an adult Indian in lieu of a lost passport.' },
    { value: 'INDIAN_PASSPORT_RENEWAL_ADULT_HOLDER', label: 'Adult Indian Passport Holder', description: 'Indian Passport Renewal: document checklist and questionnaire for an adult Indian passport holder.' },
    { value: 'INDIAN_PASSPORT_RENEWAL_MINOR_DAMAGE_PASSPORT', label: 'Minor Indian in Lieu of damage Passport', description: 'Indian Passport Renewal: document checklist and questionnaire for a minor Indian in lieu of a damaged passport.' },
    { value: 'INDIAN_PASSPORT_RENEWAL_MINOR_LOST_PASSPORT', label: 'Minor Indian in Lieu of lost Passport', description: 'Indian Passport Renewal: document checklist and questionnaire for a minor Indian in lieu of a lost passport.' },
    { value: 'INDIAN_PASSPORT_RENEWAL_MINOR_HOLDER', label: 'Minor Indian Passport Holder', description: 'Indian Passport Renewal: document checklist and questionnaire for a minor Indian passport holder.' }],
  uspassportminor: [{ value: 'US_PASSPORT_MINOR_DS11', label: 'US Passport Renewal for Minors (DS-11, under age 16)', description: 'DS-11 passport application checklist for a child under age 16: first-time applications and renewal/replacement of a Passport Book and/or Card.' }],
}
export const FAMILY_PACKAGE_VISA_TYPES = new Set(['f1family', 'i130', 'i130i485']) // every I-130 / Green Card package type follows the same workflow
export const FAMILY_SINGLE_CASE_VISA_TYPES = new Set(['k1', 'k3', 'i824'])
// RFE / NOIR / NOID / MTR: no checklist is assigned; the case manager builds it per case with special requests (Documents tab)
export const NOTICE_RESPONSE_TYPES = ['rfe', 'noir', 'noid', 'mtr']
export const EMPLOYMENT_VISA_TYPES = new Set(['h1b', 'h1b1', 'l1a', 'l1b', 'o1a', 'o1b', 'o2', 'p1a', 'p1b', 'p2', 'p3', 'tn', 'e1', 'e2', 'e3', 'r1', 'eb1b', 'eb1c', 'perm', 'i140i485'])
const VISA_GROUP_LABELS = ['Employment based', 'Family based', 'Single applicant', 'Indian timeline cases', 'Notice responses (RFE, NOIR, NOID, MTR)']

// The registry (config/visaCategories.js) is the source of truth for which case types are employer / employee matters; the fixed sets above are only a fallback.
export const groupVisaOptions = (options, registryTypes) => {
  const visaGroupOf = (opt) => {
    if (NOTICE_RESPONSE_TYPES.includes(opt.value)) return 4
    if (INDIAN_TIMELINE_VISA_TYPES.has(opt.value)) return 3
    if (FAMILY_PACKAGE_VISA_TYPES.has(opt.value) || FAMILY_SINGLE_CASE_VISA_TYPES.has(opt.value)) return 1
    if (SINGLE_PARTY_FILING_TYPE_KEYS[opt.value]) return 2
    if (EMPLOYMENT_VISA_TYPES.has(opt.value) || opt.caseStructure === 'employer_employee' || isEmployerEmployeeOption(opt, registryTypes)) return 0
    return 2
  }
  return (options || [])
    .map((opt, index) => ({ opt, index, rank: visaGroupOf(opt) }))
    .sort((a, b) => a.rank - b.rank || (a.rank === 4 ? NOTICE_RESPONSE_TYPES.indexOf(a.opt.value) - NOTICE_RESPONSE_TYPES.indexOf(b.opt.value) : a.index - b.index))
    .map(({ opt, rank }) => ({ ...opt, group: VISA_GROUP_LABELS[rank] }))
}

// Which GoHighLevel pipeline a case lives on. Asked wherever a case is created in the CRM (New case, leads, Add employee);
// cases that arrive from GHL already carry it.
export const PIPELINE_CATEGORY_OPTIONS = [
  { value: 'immigrant', label: 'Immigrant pipeline' },
  { value: 'non_immigrant', label: 'Non-Immigrant pipeline' },
]
export const pipelineCategoryLabel = (value) => PIPELINE_CATEGORY_OPTIONS.find((option) => option.value === value)?.label || ''
