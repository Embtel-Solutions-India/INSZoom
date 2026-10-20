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

// The persistent request shown on an employee case whose name or email is still missing.
export function EmployeeIdentityNotice({ principalId, childCase, onSaved }) {
  const contact = childCase?.employeeContact
  if (!contact || contact.complete || childCase?.status === 'removed') return null
  const missing = [contact.missingName && 'name', contact.missingEmail && 'email'].filter(Boolean).join(' and ')
  return (
    <div className="max-w-xl rounded-xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
      <p className="text-sm font-semibold text-amber-800 dark:text-amber-400">Employee details needed</p>
      <p className="mb-3 mt-0.5 text-xs text-amber-800/80 dark:text-amber-400/80">
        Add the employee's {missing} so this case, its forms and the client portal show who it is for.
      </p>
      <EmployeeIdentityForm principalId={principalId} childCase={childCase} onSaved={onSaved} />
    </div>
  )
}
