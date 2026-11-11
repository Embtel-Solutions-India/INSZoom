import { useState } from 'react'
import { Check, Loader2, Pencil, X } from 'lucide-react'
import { casesApi } from '../services/api'
import { PACKAGES, normalizePackage, NOT_ASSIGNED } from '../utils/packages'

// The "Package" line of the case Overview, editable after the case exists (Self Filing / Attorney Review / Full Attorney Filing - the same three as "New case").
// Saving sends only { package } through the normal case update, which keeps the case's plan record in step; the amount and payment status are not touched.
// Staff roles that can edit the case see the pencil; everyone else sees the plain value, exactly as before.
const CAN_EDIT = ['super_admin', 'admin', 'team_lead', 'case_manager']

export default function CasePackageField({ caseData, label, amountText, userRole, onSaved }) {
  const current = normalizePackage(caseData?.package || caseData?.plan?.tier || caseData?.primaryPackage || label)
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState(current === NOT_ASSIGNED ? '' : current)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const canEdit = CAN_EDIT.includes(userRole) && Boolean(caseData?._id)

  const start = () => { setSelected(current === NOT_ASSIGNED ? '' : current); setError(''); setEditing(true) }
  const save = async () => {
    if (!selected || selected === current) { setEditing(false); return }
    setSaving(true)
    setError('')
    try {
      const response = await casesApi.update(caseData._id, { package: selected })
      setEditing(false)
      onSaved?.(response?.data?.case)
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not change the package.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-testid="case-package-field">
      <p className="text-sm text-muted-foreground">Package</p>
      {editing ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <select value={selected} onChange={(event) => setSelected(event.target.value)} disabled={saving} className="input-field bg-card text-sm" aria-label="Package">
            {!selected ? <option value="">Select a package…</option> : null}
            {PACKAGES.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <button type="button" onClick={save} disabled={saving || !selected} className="btn-primary flex items-center gap-1 !px-2.5 !py-1.5 !text-sm" aria-label="Save package">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />} Save
          </button>
          <button type="button" onClick={() => setEditing(false)} disabled={saving} className="btn-secondary flex items-center gap-1 !px-2.5 !py-1.5 !text-sm" aria-label="Cancel">
            <X className="h-4 w-4" aria-hidden="true" /> Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <p className="font-medium capitalize">{label}</p>
          {canEdit ? (
            <button type="button" onClick={start} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="Change the package" aria-label="Change the package">
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      )}
      {amountText ? <p className="text-xs text-muted-foreground">{amountText}</p> : null}
      {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : null}
    </div>
  )
}
