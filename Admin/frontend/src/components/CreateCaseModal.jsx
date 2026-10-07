import { useState, useEffect, useMemo } from 'react'
import { casesApi, usersApi, familyWorkflowApi, singlePartyFilingsApi } from '../services/api'
import { X } from 'lucide-react'
import { H1B_SUBTYPES } from '../utils/visaDisplay'

const VISA_TYPE_OPTIONS = [
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
  { value: 'cosf2', label: 'Change of Status to F-2' },
  { value: 'cosb1', label: 'Change of Status to B-1' },
  { value: 'cosb2', label: 'Change of Status to B-2' },
]

// Maps this modal's own visaType option value to the backend's
// filingTypeKey (Backend/src/config/filingTypes.js's FILING_TYPES). Any
// visaType present here is a single-party filing and is created via
// singlePartyFilingsApi.createCase instead of casesApi.create - every other
// visa type is unaffected.
const SINGLE_PARTY_FILING_TYPE_KEYS = {
  h4extension: 'H4_EXTENSION',
  h4ead: 'H4_EAD',
  h4extensionead: 'H4_EXTENSION_EAD',
  cosf1: 'COS_F1',
  cosf2: 'COS_F2',
  cosb1: 'COS_B1',
  cosb2: 'COS_B2',
}

// familyBased() (Backend/src/modules/form-registry/seeds/visaFormMappings.seed.js)
// visa types - each gets the "Filing Path" choice below, and is created via
// familyWorkflowApi.createCase (POST /family-workflow/cases) rather than
// the generic casesApi.create, since that's the only path that actually
// assigns the I-130/Green-Card/I-864 checklists (see
// family-workflow.controller.js's ensureFamilyChecklistReferences).
const FAMILY_PACKAGE_VISA_TYPES = new Set(['ir1', 'cr1', 'ir2', 'cr2', 'ir3', 'ir4', 'ir5', 'f1family', 'f2a', 'f2b', 'f3', 'f4'])
// K-1/K-3 are ONE shared petitioner+beneficiary case too - they must go
// through familyWorkflowApi.createCase as well (never casesApi.create, which
// used to spawn a principal + lettered beneficiary child case). They have no
// filing-path/relationship choice, so they skip those two fields.
const FAMILY_SINGLE_CASE_VISA_TYPES = new Set(['k1', 'k3'])

// Client-facing surfaces must never say "I-130"/"processingPath" - staff
// already work with form numbers everywhere else in the CRM, so technical
// labels are fine here.
const FILING_PATH_OPTIONS = [
  { value: 'PETITION_ONLY', label: 'Petition Only (I-130)' },
  { value: 'ADJUSTMENT_OF_STATUS', label: 'Adjustment of Status / Green Card (I-485, filing in the U.S.)' },
  { value: 'CONSULAR', label: 'Consular Processing / Green Card (DS-260, filing abroad)' },
]

const RELATIONSHIP_OPTIONS = ['Husband/wife', 'Parent', 'Brother/Sister', 'Child']

const PACKAGE_OPTIONS = [
  { value: '', label: 'Not selected' },
  { value: 'Self Filing Package', label: 'Self Filing Package' },
  { value: 'Attorney Review Package', label: 'Attorney Review Package' },
  { value: 'Full Attorney Filing Package', label: 'Full Attorney Filing Package' },
]

const EMPLOYMENT_VISA_TYPES = new Set(['h1b', 'h1b1', 'l1a', 'l1b', 'o1a', 'o1b', 'o2', 'p1a', 'p1b', 'p2', 'p3', 'tn', 'e1', 'e2', 'e3', 'r1', 'eb1b', 'perm'])

// What a PERM case is created with - shown read-only on the create form.
const PERM_STRUCTURE = [
  { title: 'Employer Information Checklist', detail: '19 questions - completed by the employer' },
  { title: 'Employee Information Checklist', detail: 'Information, qualification, repeatable employment history and required documents - completed by the one employee' },
]

const initialForm = {
  clientName: '',
  clientEmail: '',
  clientPhone: '',
  visaType: '',
  petitionSubType: '',
  packageName: '',
  assignedCaseManager: '',
  employerName: '',
  employerEmail: '',
  caseDetails: '',
  relationship: '',
  filingPath: '',
  beneficiaryEmail: '',
  beneficiaryName: '',
  beneficiaryPhone: '',
}

// The dropdown = the curated options above (they carry special routing/labels) + EVERY other case type the registry can create
// (GET /cases/visa-types, i.e. config/visaCategories.js - the list createCase validates against). A case type added to the registry
// therefore shows up here with no frontend change. Family-structure types are skipped: they only exist through the family workflow.
const optionKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
const mergeRegistryOptions = (registryTypes) => {
  const known = new Set(VISA_TYPE_OPTIONS.flatMap((opt) => [optionKey(opt.value), optionKey(opt.label), optionKey(opt.canonicalLabel)]))
  const extra = (registryTypes || [])
    .filter((entry) => entry.caseStructure !== 'family' && !known.has(optionKey(entry.visaType)))
    .map((entry) => ({
      value: optionKey(entry.visaType),
      label: entry.label && entry.label !== entry.visaType ? `${entry.visaType} - ${entry.label}` : entry.visaType,
      canonicalLabel: entry.visaType,
      caseStructure: entry.caseStructure,
      fromRegistry: true,
    }))
    .sort((a, b) => a.canonicalLabel.localeCompare(b.canonicalLabel, undefined, { numeric: true }))
  return [...VISA_TYPE_OPTIONS, ...extra]
}

const normalizeInitialVisaType = (value, options = VISA_TYPE_OPTIONS) => {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return ''
  const match = options.find((opt) => (
    opt.value.toLowerCase() === normalized ||
    opt.label.toLowerCase() === normalized ||
    (opt.canonicalLabel || '').toLowerCase() === normalized
  ))
  return match?.value || ''
}

const buildInitialForm = (initialData) => ({
  ...initialForm,
  clientName: initialData?.clientName || '',
  clientEmail: initialData?.clientEmail || '',
  clientPhone: initialData?.clientPhone || '',
  visaType: normalizeInitialVisaType(initialData?.visaType),
})

// Available to admins and team leads through POST /cases. A team lead assigning
// here picks from the same case-manager roster as an admin would.
const CreateCaseModal = ({
  onClose,
  onCreated,
  initialData = null,
  leadId = null,
  creationSource = 'admin_direct',
}) => {
  const [form, setForm] = useState(() => buildInitialForm(initialData))
  const [caseManagers, setCaseManagers] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [registryTypes, setRegistryTypes] = useState([])
  const visaOptions = useMemo(() => mergeRegistryOptions(registryTypes), [registryTypes])
  const selectedRegistryOption = visaOptions.find((opt) => opt.value === form.visaType && opt.fromRegistry)
  const showEmployerFields = EMPLOYMENT_VISA_TYPES.has(form.visaType) || selectedRegistryOption?.caseStructure === 'employer_employee'
  const needsH1bType = form.visaType === 'h1b'
  const showFamilyPackageFields = FAMILY_PACKAGE_VISA_TYPES.has(form.visaType)
  const showFilingPathFields = showFamilyPackageFields
  const showFamilyFields = showFamilyPackageFields || FAMILY_SINGLE_CASE_VISA_TYPES.has(form.visaType)

  useEffect(() => {
    casesApi.visaTypes()
      .then((res) => setRegistryTypes(res.data?.data || []))
      .catch((err) => console.error('Error fetching case types:', err)) // the curated list above still works
  }, [])

  // a lead's visa type may be a registry-only type that only resolves once the registry list has loaded
  useEffect(() => {
    if (form.visaType || !initialData?.visaType || !registryTypes.length) return
    const match = normalizeInitialVisaType(initialData.visaType, visaOptions)
    if (match) setForm((prev) => (prev.visaType ? prev : { ...prev, visaType: match }))
  }, [registryTypes]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    usersApi.caseManagers()
      .then((res) => setCaseManagers(res.data?.caseManagers || []))
      .catch((err) => console.error('Error fetching case managers:', err))
  }, [])

  const handleChange = (field) => (e) => {
    const { value } = e.target
    // the H-1B type only applies to H-1B - never carry it over to another visa
    setForm((prev) => ({ ...prev, [field]: value, ...(field === 'visaType' ? { petitionSubType: '' } : {}) }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      // Send the display label ("H-1B"), not the raw code ("h1b") — matches
      // the visaType format Immiglance's self-registration intake sends, so both
      // paths render identically in the cases table and downstream forms.
      // BUG (fixed): for the 12 family package types this used to be the
      // same `.label` shown in the dropdown - since that label now reads
      // "IR-1 (I-130 / Green Card)" (added so case managers aren't confused
      // about which entries carry the I-130/Green-Card logic), that whole
      // string was being sent as Case.visaType. Every downstream lookup
      // (familyChecklists.js's resolveFamilyChecklistKeys, the
      // VisaFormMapping registry, the legacy templateAppliesToCase path)
      // matches on the exact literal "IR-1"/"CR-1"/etc., so a case created
      // through this dropdown got zero checklists, zero forms, and zero
      // documents - confirmed live (an IR-1 case showed nothing on
      // Documents/Forms). `canonicalLabel` is the plain form these lookups
      // actually need; `visaTypeLabel` (the bracketed display label) is
      // fine as-is for the other, non-family visa types below, which never
      // had this suffix.
      const selectedVisaOption = visaOptions.find((opt) => opt.value === form.visaType)
      const visaTypeLabel = selectedVisaOption?.canonicalLabel || selectedVisaOption?.label || form.visaType

      const filingTypeKey = SINGLE_PARTY_FILING_TYPE_KEYS[form.visaType]
      if (filingTypeKey) {
        // Standalone single-party filing (H-4 Extension/EAD/Extension+EAD,
        // COS to F-2, ...) - one request creates the Case AND auto-assigns
        // its single applicant checklist (single-party-filing.controller.js's
        // createFiling). No petitioner/beneficiary or employer fields exist
        // for this path.
        const payload = {
          filingTypeKey,
          clientName: form.clientName.trim(),
          clientEmail: form.clientEmail.trim(),
        }
        if (form.clientPhone.trim()) payload.clientPhone = form.clientPhone.trim()
        const res = await singlePartyFilingsApi.createCase(payload)
        const result = res.data || {}
        onCreated?.({ ...result, case: result.case })
        return
      }

      if (showFamilyFields) {
        // I-130/Green-Card/I-864 family package - a materially different
        // backend path (POST /family-workflow/cases, not the generic
        // POST /cases) since that's the only one that assigns the right
        // I-130/Green-Card/I-864 checklists for the chosen filing path.
        // Here, "Client Name/Email/Phone" above are the PETITIONER's own
        // contact info (the person this case is filed for), not a
        // logged-in account - createFamilyCase finds-or-creates that
        // client User, never the staff member submitting this form.
        const payload = {
          visaType: visaTypeLabel,
          ...(leadId ? { leadId } : {}),
          petitionerName: form.clientName.trim(),
          petitionerEmail: form.clientEmail.trim(),
          petitionerPhone: form.clientPhone.trim(),
          ...(showFilingPathFields ? { relationship: form.relationship, processingPath: form.filingPath } : {}),
          beneficiaryName: form.beneficiaryName.trim(),
          beneficiaryEmail: form.beneficiaryEmail.trim(),
          beneficiaryPhone: form.beneficiaryPhone.trim(),
        }
        const res = await familyWorkflowApi.createCase(payload)
        const result = res.data || {}
        onCreated?.({ ...result, case: result.case })
        return
      }

      const payload = {
        clientName: form.clientName.trim(),
        clientEmail: form.clientEmail.trim(),
        visaType: visaTypeLabel,
        ...(needsH1bType ? { petitionSubType: form.petitionSubType } : {}),
        childCaseCount: showEmployerFields ? Number(initialData?.childCaseCount || 1) : 0,
        creationSource,
      }
      if (leadId) payload.leadId = leadId
      if (form.clientPhone.trim()) payload.clientPhone = form.clientPhone.trim()
      if (initialData?.extension) payload.extension = initialData.extension
      if (initialData?.packageId) payload.packageId = initialData.packageId
      if (form.packageName) payload.packageName = form.packageName
      if (form.assignedCaseManager) payload.assignedCaseManager = form.assignedCaseManager
      if (form.caseDetails.trim()) payload.caseDetails = form.caseDetails.trim()
      if (showEmployerFields) {
        if (form.employerName.trim()) payload.employerName = form.employerName.trim()
        if (form.employerEmail.trim()) payload.employerEmail = form.employerEmail.trim()
      }

      const res = await casesApi.create(payload)
      const result = res.data || {}
      onCreated?.({
        ...result,
        case: result.case || result.principalCase,
      })
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create case. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-2xl p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-foreground">New Case</h3>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-muted-foreground rounded-lg"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              {showFamilyFields ? 'Petitioner Name *' : 'Client Name *'}
            </label>
            <input
              type="text"
              required
              value={form.clientName}
              onChange={handleChange('clientName')}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Jane Doe"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              {showFamilyFields ? 'Petitioner Email *' : 'Client Email *'}
            </label>
            <input
              type="email"
              required
              value={form.clientEmail}
              onChange={handleChange('clientEmail')}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="jane@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              {showFamilyFields ? 'Petitioner Phone' : 'Client Phone'}
            </label>
            <input
              type="tel"
              value={form.clientPhone}
              onChange={handleChange('clientPhone')}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="(555) 555-5555"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Visa Type *</label>
            <select
              required
              value={form.visaType}
              onChange={handleChange('visaType')}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="" disabled>Select visa type</option>
              {visaOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {needsH1bType && (
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">H-1B Type *</label>
              <select
                required
                value={form.petitionSubType}
                onChange={handleChange('petitionSubType')}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="" disabled>Select H-1B type</option>
                {H1B_SUBTYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
          )}

          {showFamilyFields && (
            <div className="space-y-4 rounded-lg border border-border bg-muted p-3">
              {showFilingPathFields && (<>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Petitioner is filing for their *</label>
                <select
                  required
                  value={form.relationship}
                  onChange={handleChange('relationship')}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="" disabled>Select relationship</option>
                  {RELATIONSHIP_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Filing Path *</label>
                <select
                  required
                  value={form.filingPath}
                  onChange={handleChange('filingPath')}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="" disabled>Select filing path</option>
                  {FILING_PATH_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              </>)}

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Beneficiary Name *</label>
                <input
                  type="text"
                  required
                  value={form.beneficiaryName}
                  onChange={handleChange('beneficiaryName')}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Full legal name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Beneficiary Email *</label>
                <input
                  type="email"
                  required
                  value={form.beneficiaryEmail}
                  onChange={handleChange('beneficiaryEmail')}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="beneficiary@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Beneficiary Phone</label>
                <input
                  type="tel"
                  value={form.beneficiaryPhone}
                  onChange={handleChange('beneficiaryPhone')}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Required to send an invitation"
                />
              </div>
            </div>
          )}

          {!showFamilyFields && (
          <>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Package</label>
            <select
              value={form.packageName}
              onChange={handleChange('packageName')}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {PACKAGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Assign Case Manager</label>
            <select
              value={form.assignedCaseManager}
              onChange={handleChange('assignedCaseManager')}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Unassigned (team lead queue)</option>
              {caseManagers.map((cm) => (
                <option key={cm._id} value={cm._id}>{cm.name || cm.displayName || cm.email}</option>
              ))}
            </select>
          </div>
          </>
          )}

          {form.visaType === 'perm' && (
            <div className="rounded-lg border border-border bg-muted p-3 text-sm">
              <p className="font-medium text-muted-foreground mb-1">This PERM case is created with</p>
              <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
                {PERM_STRUCTURE.map((item) => (
                  <li key={item.title}><span className="font-medium">{item.title}</span> - {item.detail}</li>
                ))}
                <li>No USCIS forms - PERM is a Department of Labor process. Add as many employees as the matter needs once the case exists.</li>
              </ul>
            </div>
          )}

          {form.visaType === 'gcnvc' && (
            <div className="rounded-lg border border-border bg-muted p-3 text-sm">
              <p className="font-medium text-muted-foreground mb-1">This GC-NVC case is created with</p>
              <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
                <li><span className="font-medium">GC-NVC Information Checklist</span> - reviewed and approved by the case manager, then completed by the client in the client portal</li>
                <li><span className="font-medium">Required documents</span> - photo, passport page, birth and marriage records, police verification letter</li>
                <li>No USCIS forms are created for this case type.</li>
              </ul>
            </div>
          )}

          {form.visaType === 'premiumprocessing' && (
            <div className="rounded-lg border border-border bg-muted p-3 text-sm">
              <p className="font-medium text-muted-foreground mb-1">This Premium Processing case is created with</p>
              <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
                <li><span className="font-medium">Form I-907 Information Checklist</span> - completed by the client in the client portal</li>
                <li><span className="font-medium">Form I-907</span> - the only form on the case, filled automatically from the checklist</li>
              </ul>
            </div>
          )}

          {showEmployerFields && (
            <div className="space-y-4 rounded-lg border border-border bg-muted p-3">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Employer</label>
                <input
                  type="text"
                  value={form.employerName}
                  onChange={handleChange('employerName')}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Company or organization name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Employer Email</label>
                <input
                  type="email"
                  value={form.employerEmail}
                  onChange={handleChange('employerEmail')}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="hr@example.com"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Case Details</label>
            <textarea
              rows={3}
              value={form.caseDetails}
              onChange={handleChange('caseDetails')}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Internal notes, role details, deadlines, or filing context"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="btn-primary flex-1 disabled:opacity-50">
              {submitting ? 'Creating…' : 'Create Case'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default CreateCaseModal
