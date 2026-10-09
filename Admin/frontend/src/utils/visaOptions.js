import { useEffect, useMemo, useState } from 'react'
import { casesApi } from '../services/api'

// The ONE visa-type dropdown list. "New case" (CreateCaseModal) and the GoHighLevel "Visa selection required" banner both
// build their options here, so a case type added, removed or relabelled shows up in both with no second edit.
export const VISA_TYPE_OPTIONS = [
  { value: 'h1b', label: 'H-1B' },
  { value: 'h1b1', label: 'H-1B1' },
  { value: 'l1a', label: 'L-1A' },
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
  { value: 'ir1', label: 'IR-1 (I-130 / Green Card)', canonicalLabel: 'IR-1' },
  { value: 'cr1', label: 'CR-1 (I-130 / Green Card)', canonicalLabel: 'CR-1' },
  { value: 'ir2', label: 'IR-2 (I-130 / Green Card)', canonicalLabel: 'IR-2' },
  { value: 'cr2', label: 'CR-2 (I-130 / Green Card)', canonicalLabel: 'CR-2' },
  { value: 'ir3', label: 'IR-3 (I-130 / Green Card)', canonicalLabel: 'IR-3' },
  { value: 'ir4', label: 'IR-4 (I-130 / Green Card)', canonicalLabel: 'IR-4' },
  { value: 'ir5', label: 'IR-5 (I-130 / Green Card)', canonicalLabel: 'IR-5' },
  { value: 'f1family', label: 'F1 (I-130 / Green Card)', canonicalLabel: 'F1' },
  { value: 'f2a', label: 'F2A (I-130 / Green Card)', canonicalLabel: 'F2A' },
  { value: 'f2b', label: 'F2B (I-130 / Green Card)', canonicalLabel: 'F2B' },
  { value: 'f3', label: 'F3 (I-130 / Green Card)', canonicalLabel: 'F3' },
  { value: 'f4', label: 'F4 (I-130 / Green Card)', canonicalLabel: 'F4' },
  { value: 'i539cos', label: 'I-539-COS' },
  { value: 'i539ext', label: 'I-539-EXT' },
  { value: 'eb1a', label: 'EB-1A' },
  { value: 'eb1b', label: 'EB-1B' },
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
  { value: 'cosf1', label: 'Change of Status to F-1' },
  { value: 'f1reinstatement', label: 'F-1 Reinstatement' },
  { value: 'cosf2', label: 'Change of Status to F-2' },
  { value: 'cosb1', label: 'Change of Status to B-1' },
  { value: 'cosb2', label: 'Change of Status to B-2' },
]

// The dropdown = the curated options above (they carry special routing/labels) + EVERY other case type the registry can create
// (GET /cases/visa-types, i.e. config/visaCategories.js - the list createCase validates against). A case type added to the registry
// therefore shows up here with no frontend change. Family-structure types are skipped: they only exist through the family workflow.
export const optionKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
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
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    casesApi.visaTypes()
      .then((res) => { if (!cancelled) setRegistryTypes(res.data?.data || []) })
      .catch((err) => { console.error('Error fetching case types:', err); if (!cancelled) setError(true) }) // the curated list still works
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [enabled])
  const options = useMemo(() => mergeRegistryOptions(registryTypes), [registryTypes])
  return { options, registryTypes, loaded, error }
}

// The registry entry behind a dropdown option (matched on value / label / canonical label), or null for an option the registry
// does not know. Its `visaType` is the exact spelling the backend validates and stores.
export const registryEntryFor = (option, registryTypes) => {
  const keys = [option.value, option.canonicalLabel, option.label].map(optionKey).filter(Boolean)
  return (registryTypes || []).find((entry) => keys.includes(optionKey(entry.visaType))) || null
}

// Which GoHighLevel pipeline a case lives on. Asked wherever a case is created in the CRM (New case, leads, Add employee);
// cases that arrive from GHL already carry it.
export const PIPELINE_CATEGORY_OPTIONS = [
  { value: 'immigrant', label: 'Immigrant pipeline' },
  { value: 'non_immigrant', label: 'Non-Immigrant pipeline' },
]
export const pipelineCategoryLabel = (value) => PIPELINE_CATEGORY_OPTIONS.find((option) => option.value === value)?.label || ''
