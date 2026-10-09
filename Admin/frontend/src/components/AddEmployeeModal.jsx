import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { casesApi } from '../services/api'
import { useVisaOptions, registryEntryFor } from '../utils/visaOptions'

// "Add employee" - the visa (and filing type, e.g. H-1B Extension) is asked FIRST: every employee of one employer can
// be on a different visa, and their forms and checklists are provisioned from it. The visa dropdown is the SAME shared list "New case"
// uses (utils/visaOptions.js), narrowed to the employer-based visas an employee can be on. Then how their information is
// entered: staff/employer fills it in, or the employee is invited (changeable later from the employee's row).
export default function AddEmployeeModal({ principalId, defaultVisaType, onClose, onAdded }) {
  const [visaType, setVisaType] = useState(defaultVisaType || '')
  const [petitionSubType, setPetitionSubType] = useState('')
  const [mode, setMode] = useState('fill_self')
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
    if (mode === 'invite' && (!name.trim() || !email.trim())) { setError('Enter the employee\'s name and email to send the invitation.'); return }
    setBusy(true)
    let childCaseId = null
    try {
      const added = await casesApi.addEmployeeSlot(principalId, { visaType, ...(subTypes.length ? { petitionSubType } : {}) })
      childCaseId = added.data?.childCaseId
      await casesApi.setEmployeeDataEntryMode(principalId, childCaseId, mode === 'invite'
        ? { mode: 'invite', employeeName: name.trim(), employeeEmail: email.trim() }
        : { mode: 'fill_self' })
      onAdded(mode === 'invite' ? `Employee added on ${visaType} and invited` : `Employee added on ${visaType}`)
    } catch (err) {
      const message = err.response?.data?.message || 'The employee could not be added.'
      if (childCaseId) {
        // The slot exists; only the invitation failed - never leave the user guessing.
        onAdded(`Employee added on ${visaType}, but the invitation was not sent: ${message} Use "Invite employee" on their row to retry.`)
      } else {
        setError(message)
      }
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

        <fieldset className="space-y-2" disabled={busy}>
          <legend className="mb-1 text-sm font-medium text-muted-foreground">Who fills in their information?</legend>
          <label className="flex items-center gap-2 text-sm text-foreground"><input type="radio" checked={mode === 'fill_self'} onChange={() => setMode('fill_self')} /> The employer / our team fills it in</label>
          <label className="flex items-center gap-2 text-sm text-foreground"><input type="radio" checked={mode === 'invite'} onChange={() => setMode('invite')} /> Invite the employee to fill it in</label>
        </fieldset>

        {mode === 'invite' && (
          <div className="grid grid-cols-1 gap-2">
            <input className="input-field" placeholder="Employee full name" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
            <input type="email" className="input-field" placeholder="Employee email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary" disabled={busy}>Cancel</button>
          <button type="submit" className="btn-primary disabled:opacity-60" disabled={busy}>{busy ? 'Adding…' : 'Add employee'}</button>
        </div>
      </form>
    </div>
  )
}
