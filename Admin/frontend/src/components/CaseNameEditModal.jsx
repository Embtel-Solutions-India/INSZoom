import { useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { casesApi } from '../services/api'

// The internal team edits a case's name. An employer's company, and an RFE / NOIR / NOID / MTR case (we do not know whether the filer is a person or a company), take ONE
// name; a single person, family member or employee takes a first name, an optional middle name and an optional last name (it may not be known), pre-filled with the parts
// the case already holds. Saving replaces the old name everywhere it is used (the server does that), so nothing
// can keep showing the previous name. Nothing is sent until Save, and the name is only saved when it actually changed.
const composeName = (parts) => [parts.firstName, parts.middleName, parts.lastName].map((part) => String(part || '').trim()).filter(Boolean).join(' ')

export default function CaseNameEditModal({ caseId, caseNumber = '', onClose, onSaved }) {
  const [info, setInfo] = useState(null) // { kind, name, parts }
  const [loadError, setLoadError] = useState('')
  const [single, setSingle] = useState('') // the one name of a company / notice case
  const [parts, setParts] = useState({ firstName: '', middleName: '', lastName: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const firstInput = useRef(null)

  useEffect(() => {
    let cancelled = false
    casesApi.getNameInfo(caseId)
      .then((response) => {
        if (cancelled) return
        const data = response.data || {}
        setInfo(data)
        if (data.kind !== 'person') setSingle(data.name || '')
        else setParts({ firstName: data.parts?.firstName || '', middleName: data.parts?.middleName || '', lastName: data.parts?.lastName || '' })
      })
      .catch((err) => { if (!cancelled) setLoadError(err.response?.data?.message || 'Could not load the name. Please try again.') })
    return () => { cancelled = true }
  }, [caseId])

  useEffect(() => { if (info) firstInput.current?.focus() }, [info])

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const isSingle = Boolean(info) && info.kind !== 'person' // company or notice case: one field
  const isCompany = info?.kind === 'company'
  const newName = isSingle ? single.trim().replace(/\s+/g, ' ') : composeName(parts)
  const original = isSingle ? (info?.name || '') : composeName(info?.parts || {})
  const changed = Boolean(info) && newName !== original
  const valid = isSingle ? Boolean(newName) : Boolean(parts.firstName.trim()) // the last name is optional

  const save = async (event) => {
    event?.preventDefault()
    if (busy || !changed || !valid) return
    setBusy(true)
    setError('')
    try {
      const payload = isSingle ? { name: newName } : { firstName: parts.firstName, middleName: parts.middleName, lastName: parts.lastName }
      const response = await casesApi.renameCase(caseId, payload)
      onSaved?.(response.data)
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save the name. Please try again.')
      setBusy(false)
    }
  }

  const setPart = (key) => (event) => { setParts((current) => ({ ...current, [key]: event.target.value })); if (error) setError('') }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/45 px-4 py-6" role="presentation">
      <form onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="case-name-title" className="w-full max-w-md rounded-2xl bg-card p-6 shadow-2xl" data-testid="case-name-modal">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-600">
          <Pencil className="h-7 w-7" aria-hidden="true" />
        </div>
        <h2 id="case-name-title" className="text-center text-xl font-bold text-foreground">{isCompany ? 'Edit the company name' : 'Edit the name'}</h2>
        <p className="mt-2 text-center text-sm leading-6 text-muted-foreground">
          {caseNumber && <span className="font-semibold text-foreground">{caseNumber} · </span>}
          The new name replaces the old one everywhere in the system, including e-mails and forms.
        </p>

        {loadError && <p role="alert" className="mt-4 text-center text-sm font-medium text-rose-600">{loadError}</p>}
        {!info && !loadError && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-primary" aria-hidden="true" />
            Loading…
          </div>
        )}

        {info && isSingle && (
          <div className="mt-5">
            <label htmlFor="case-name-single" className="block text-sm font-medium text-foreground">{isCompany ? 'Company name' : 'Name'}</label>
            <input id="case-name-single" ref={firstInput} type="text" value={single} onChange={(event) => { setSingle(event.target.value); if (error) setError('') }} disabled={busy} maxLength={120} className="input-field mt-1.5" autoComplete="off" />
          </div>
        )}

        {info && !isSingle && (
          <div className="mt-5 space-y-3">
            <div>
              <label htmlFor="case-name-first" className="block text-sm font-medium text-foreground">First name</label>
              <input id="case-name-first" ref={firstInput} type="text" value={parts.firstName} onChange={setPart('firstName')} disabled={busy} maxLength={60} className="input-field mt-1.5" autoComplete="off" />
            </div>
            <div>
              <label htmlFor="case-name-middle" className="block text-sm font-medium text-foreground">Middle name <span className="font-normal text-muted-foreground">(optional)</span></label>
              <input id="case-name-middle" type="text" value={parts.middleName} onChange={setPart('middleName')} disabled={busy} maxLength={60} className="input-field mt-1.5" autoComplete="off" />
            </div>
            <div>
              <label htmlFor="case-name-last" className="block text-sm font-medium text-foreground">Last name <span className="font-normal text-muted-foreground">(optional)</span></label>
              <input id="case-name-last" type="text" value={parts.lastName} onChange={setPart('lastName')} disabled={busy} maxLength={60} className="input-field mt-1.5" autoComplete="off" />
            </div>
          </div>
        )}

        {info && changed && valid && (
          <p className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs leading-5 text-blue-900">
            Will be saved as <span className="font-semibold">{newName}</span>.
          </p>
        )}
        {error && <p role="alert" className="mt-3 text-sm font-medium text-rose-600">{error}</p>}

        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onClose} disabled={busy} className="btn-secondary flex-1 justify-center disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={busy || !info || !changed || !valid} className="btn-primary flex-1 justify-center disabled:opacity-50">{busy ? 'Saving…' : 'Save name'}</button>
        </div>
      </form>
    </div>
  )
}
