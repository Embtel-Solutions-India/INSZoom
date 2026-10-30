import { useMemo, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { casesApi } from '../services/api'
import { useVisaOptions, registryEntryFor, groupVisaOptions } from '../utils/visaOptions'
import WrappingSelect from './ui/WrappingSelect'
import { useAuth } from '../contexts/AuthContext'

// Cases that arrive from GoHighLevel have no visa type yet, and nothing visa-driven
// (checklists, forms, questionnaires) is set up until one is chosen. This banner is
// the "select" for that: it only renders for such a case and disappears once a visa is set.
//
// The dropdown is the SAME list "New case" uses (utils/visaOptions.js), so a visa added, removed or relabelled there changes
// here too. Every visa can be chosen: the server reshapes the card to that visa's structure (single, employer/employee or family)
// so it connects to the registry, checklists, forms and case logic like any other case of that visa.
const CAN_SELECT = ['super_admin', 'admin', 'team_lead']

export default function GhlVisaSelectBanner({ caseData, onUpdated }) {
  const { user } = useAuth()
  const pending = caseData?.visaSelectionStatus === 'pending'
  const canSelect = CAN_SELECT.includes(user?.role)
  const [selected, setSelected] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const visa = useVisaOptions({ enabled: pending && canSelect })
  const [done, setDone] = useState(false)

  const options = useMemo(
    () => visa.options.map((opt) => {
      const entry = registryEntryFor(opt, visa.registryTypes)
      return { ...opt, visaType: entry?.visaType || '', selectable: Boolean(entry) }
    }),
    [visa.options, visa.registryTypes]
  )
  // the SAME dropdown as "New case": same list, same grouping (employment / family / single applicant), same component
  const selectOptions = useMemo(
    () => groupVisaOptions(options, visa.registryTypes)
      .filter((opt) => opt.selectable)
      .map((opt) => ({ value: opt.visaType, label: opt.label, group: opt.group })),
    [options, visa.registryTypes]
  )

  if (!pending && !done) return null
  if (done) {
    return <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Visa type saved. Checklists and forms are being prepared and will appear shortly.</div>
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
    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2 md:items-center">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 md:mt-0" />
          <p className="min-w-0 text-amber-800">
            <span className="text-sm font-semibold text-amber-900">Visa selection required</span>
            <span className="block text-xs lg:inline"> <span className="hidden lg:inline">&middot; </span>This case came from GoHighLevel without a visa type. Checklists, forms and questionnaires are set up once a visa type is chosen.</span>
          </p>
        </div>
        {canSelect ? (
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
            <div className="w-full sm:w-72">
              <WrappingSelect
                value={selected}
                onChange={setSelected}
                options={selectOptions}
                placeholder="Select visa type…"
                ariaLabel="Visa type"
                disabled={saving}
              />
            </div>
            <button type="button" className="btn-primary flex items-center justify-center gap-2 !px-3 !py-1.5 !text-sm" disabled={!selected || saving} onClick={save}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Set visa type
            </button>
          </div>
        ) : (
          <p className="text-xs text-amber-800">Your team lead selects the visa type for this case.</p>
        )}
      </div>
      {error || visa.error ? <p className="mt-1.5 text-xs text-red-700">{error || 'Could not load the visa type list.'}</p> : null}
    </div>
  )
}
