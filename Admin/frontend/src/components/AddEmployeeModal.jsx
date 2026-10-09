import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { casesApi } from '../services/api'
import { useVisaOptions, registryEntryFor, PIPELINE_CATEGORY_OPTIONS } from '../utils/visaOptions'

// "Add employee" - the visa (and filing type, e.g. H-1B Extension) is asked FIRST: every employee of one employer can
// be on a different visa, and their forms and checklists are provisioned from it. The visa dropdown is the SAME shared list "New case"
// uses (utils/visaOptions.js), narrowed to the employer-based visas an employee can be on. Then the employee's name and email: they
// are written on the software case and on the GoHighLevel card. Inviting the employee to fill in their own information stays
// available from the employee's row.
export default function AddEmployeeModal({ principalId, defaultVisaType, onClose, onAdded }) {
  const [visaType, setVisaType] = useState(defaultVisaType || '')
  const [petitionSubType, setPetitionSubType] = useState('')
  const [pipelineCategory, setPipelineCategory] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const shared = useVisaOptions()
  useEffect(() => { if (shared.error) setError('Could not load the visa list. Please close and try again.') }, [shared.error])
  const options = useMemo(
    () => shared.options
      .map((opt) => ({ opt, entry: registryEntryFor(opt, shared.registryTypes) }))
      .filter(({ entry }) => entry?.caseStructure === 'employer_employee')
      .map(({ opt, entry }) => ({ visaType: entry.visaType, label: opt.label, subTypes: entry.subTypes || [] })),
    [shared.options, shared.registryTypes]
  )

  const selected = useMemo(() => options.find((option) => option.visaType === visaType), [options, visaType])
  const subTypes = selected?.subTypes || []

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    if (!visaType) { setError('Choose the employee\'s visa first.'); return }
    if (subTypes.length && !petitionSubType) { setError(`Choose the ${visaType} filing type.`); return }
    if (!pipelineCategory) { setError('Choose the GoHighLevel pipeline (Immigrant or Non-Immigrant).'); return }
    if (!name.trim()) { setError('Enter the full name of the employee.'); return }
    if (!email.trim()) { setError('Enter the email of the employee.'); return }
    setBusy(true)
    try {
      await casesApi.addEmployeeSlot(principalId, { visaType, pipelineCategory, employeeName: name.trim(), employeeEmail: email.trim(), ...(subTypes.length ? { petitionSubType } : {}) })
      onAdded(`Employee ${name.trim()} added on ${visaType}`)
    } catch (err) {
      setError(err.response?.data?.message || 'The employee could not be added.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-2xl bg-card p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground">Add employee</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-muted-foreground">Visa *</label>
          <select className="input-field" value={visaType} onChange={(e) => { setVisaType(e.target.value); setPetitionSubType('') }} disabled={busy}>
            <option value="" disabled>Select the employee's visa</option>
            {options.map((option) => <option key={option.visaType} value={option.visaType}>{option.label}</option>)}
          </select>
        </div>

        {subTypes.length > 0 && (
          <div>
            <label className="mb-1 block text-sm font-medium text-muted-foreground">{visaType} type *</label>
            <select className="input-field" value={petitionSubType} onChange={(e) => setPetitionSubType(e.target.value)} disabled={busy}>
              <option value="" disabled>Select type (new, extension, transfer...)</option>
              {subTypes.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-muted-foreground">GoHighLevel pipeline *</label>
          <select className="input-field" value={pipelineCategory} onChange={(e) => setPipelineCategory(e.target.value)} disabled={busy}>
            <option value="" disabled>Select pipeline</option>
            {PIPELINE_CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-muted-foreground">Employee full name *</label>
            <input className="input-field" placeholder="As it should appear on the case and in GoHighLevel" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-muted-foreground">Employee email *</label>
            <input type="email" className="input-field" placeholder="employee@example.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary" disabled={busy}>Cancel</button>
          <button type="submit" className="btn-primary disabled:opacity-60" disabled={busy}>{busy ? 'Adding…' : 'Add employee'}</button>
        </div>
      </form>
    </div>
  )
}
