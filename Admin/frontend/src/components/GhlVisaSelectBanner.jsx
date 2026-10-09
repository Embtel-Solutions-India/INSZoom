import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { casesApi } from '../services/api'
import { useAuth } from '../contexts/AuthContext'

// Cases that arrive from GoHighLevel have no visa type yet, and nothing visa-driven
// (checklists, forms, questionnaires) is set up until one is chosen. This banner is
// the "select" for that: it only renders for such a case and disappears once a visa is set.
//
// Only single-party visa types are offered. A GHL case is created as a single-party
// case, and the employer/employee and family visas need a different case structure
// that can't be added afterwards. The server enforces this too.
const CAN_SELECT = ['super_admin', 'admin', 'team_lead']

export default function GhlVisaSelectBanner({ caseData, onUpdated }) {
  const { user } = useAuth()
  const pending = caseData?.visaSelectionStatus === 'pending'
  const canSelect = CAN_SELECT.includes(user?.role)
  const [types, setTypes] = useState([])
  const [selected, setSelected] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!pending || !canSelect) return undefined
    let cancelled = false
    casesApi.visaTypes()
      .then((res) => { if (!cancelled) setTypes((res.data?.data || []).filter((entry) => entry.caseStructure === 'single')) })
      .catch(() => { if (!cancelled) setError('Could not load the visa type list.') })
    return () => { cancelled = true }
  }, [pending, canSelect])

  const options = useMemo(
    () => [...types].sort((a, b) => String(a.label || a.visaType).localeCompare(String(b.label || b.visaType))),
    [types]
  )

  if (!pending && !done) return null
  if (done) {
    return <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Visa type saved. Checklists and forms are being prepared and will appear shortly.</div>
  }

  const save = async () => {
    if (!selected) return
    setSaving(true)
    setError('')
    try {
      const res = await casesApi.update(caseData._id, { visaType: selected })
      setDone(true)
      onUpdated?.(res.data?.case)
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not save the visa type.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-amber-900">Visa selection required</p>
          <p className="text-sm text-amber-800">
            This case came from GoHighLevel without a visa type. Checklists, forms and questionnaires are set up once a visa type is chosen.
          </p>
          {canSelect ? (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
                aria-label="Visa type"
                className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-foreground sm:w-80"
              >
                <option value="">Select visa type…</option>
                {options.map((entry) => (
                  <option key={entry.visaType} value={entry.visaType}>{entry.label && entry.label !== entry.visaType ? `${entry.visaType} — ${entry.label}` : entry.visaType}</option>
                ))}
              </select>
              <button type="button" className="btn-primary flex items-center justify-center gap-2" disabled={!selected || saving} onClick={save}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Set visa type
              </button>
            </div>
          ) : (
            <p className="mt-2 text-sm text-amber-800">Your team lead selects the visa type for this case.</p>
          )}
          {canSelect ? <p className="mt-2 text-xs text-amber-700">Employer-based and family visa types (for example H-1B, L-1, K-1) aren’t available for GoHighLevel cases yet.</p> : null}
          {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
        </div>
      </div>
    </div>
  )
}
