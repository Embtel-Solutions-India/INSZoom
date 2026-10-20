import { useState } from 'react'
import { casesApi } from '../services/api'

// The name and email of the person an employee case is for. Shown wherever an employee case's details are missing, and it keeps asking
// until both are filled in (the same prompt, in the same spirit as "Awaiting assignment"). Saving writes the child case itself, so the
// client portal's employee card shows the same values straight away - and what the employer types there shows here.
export default function EmployeeIdentityForm({ principalId, childCase, onSaved, compact = false }) {
  const contact = childCase?.employeeContact || {}
  const [name, setName] = useState(contact.name || '')
  const [email, setEmail] = useState(contact.email || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const dirty = name.trim() !== (contact.name || '') || email.trim().toLowerCase() !== (contact.email || '')

  const save = async (event) => {
    event?.preventDefault()
    event?.stopPropagation()
    if (!name.trim() && !email.trim()) { setError("Enter the employee's name and email."); return }
    setSaving(true)
    setError('')
    try {
      const payload = {}
      if (name.trim()) payload.name = name.trim()
      if (email.trim()) payload.email = email.trim()
      await casesApi.setEmployeeIdentity(principalId, childCase._id, payload)
      onSaved?.()
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Could not save the employee details')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} onClick={(event) => event.stopPropagation()} className={compact ? 'space-y-1.5' : 'space-y-2'}>
      <div className={compact ? 'space-y-1.5' : 'grid grid-cols-1 gap-2 sm:grid-cols-2'}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Employee full name"
          aria-label="Employee full name"
          className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Employee email"
          aria-label="Employee email"
          className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
        />
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={saving || !dirty}
        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save details'}
      </button>
    </form>
  )
}

// The persistent request shown on an employee case whose name or email is still missing: a small amber box that stays until both are filled in.
// Clicking it opens the form (name and email); saving updates the case, and the box goes away once nothing is missing.
export function EmployeeIdentityNotice({ principalId, childCase, onSaved }) {
  const [open, setOpen] = useState(false)
  const contact = childCase?.employeeContact
  if (!contact || contact.complete || childCase?.status === 'removed') return null
  const missing = [contact.missingName && 'name', contact.missingEmail && 'email'].filter(Boolean).join(' and ')
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Add the employee's ${missing}`}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-50 px-3.5 py-2.5 text-sm font-medium text-amber-800 ring-1 ring-inset ring-amber-200 transition-colors hover:bg-amber-100 sm:py-2 dark:bg-amber-950/30 dark:text-amber-400 dark:ring-amber-900/50"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
        Employee details needed
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-label="Employee details" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <h3 className="text-base font-semibold text-foreground">Employee details</h3>
            <p className="mb-4 mt-0.5 text-xs text-muted-foreground">
              Add the employee's {missing} so this case, its forms and the client portal show who it is for.
            </p>
            <EmployeeIdentityForm
              principalId={principalId}
              childCase={childCase}
              onSaved={() => { setOpen(false); onSaved?.() }}
            />
            <button type="button" onClick={() => setOpen(false)} className="mt-3 text-xs font-medium text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        </div>
      )}
    </>
  )
}
