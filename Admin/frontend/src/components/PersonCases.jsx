import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Info, FolderOpen } from 'lucide-react'
import { casesApi } from '../services/api'

// One person, many cases (docs/MULTI_CASE_CLIENTS_PLAN.md, Phase 1). Both pieces are read-only and quiet: if the lookup fails they show nothing,
// so the New case form and the case page work exactly as before.

const dateLabel = (value) => {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : ''
}
const statusLabel = (value) => String(value || '').replace(/_/g, ' ')

// New case: when the e-mail already belongs to someone, say the new case is added to the SAME login (their earlier cases are untouched).
export function ExistingPersonNotice({ email }) {
  const [info, setInfo] = useState(null)
  useEffect(() => {
    const value = String(email || '').trim().toLowerCase()
    setInfo(null)
    if (!/^\S+@\S+\.\S+$/.test(value)) return undefined
    let cancelled = false
    const timer = setTimeout(() => {
      Promise.resolve().then(() => casesApi.lookupPerson(value))
        .then((res) => { if (!cancelled) setInfo(res.data?.data || null) })
        .catch(() => {}) // only a hint
    }, 450)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [email])

  const person = info?.person
  if (!person) return null
  const count = info.cases?.length || 0
  const name = person.name || person.email
  if (count === 0) return null
  return (
    <div className="mt-2 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900" role="status">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>
        <span className="font-semibold">{name}</span> ({person.email}) already has {count} case{count > 1 ? 's' : ''}.{' '}
        {info.multiCase
          ? 'This new case will be added to the same login - their earlier cases stay exactly as they are.'
          : 'Adding another case to the same login is switched off on this server, so this case cannot be created for this email.'}
      </p>
    </div>
  )
}

// Case page: the other cases of the people on this case (client / employer / petitioner / beneficiary), each linking to its own page.
export function OtherCasesStrip({ caseId }) {
  const [groups, setGroups] = useState([])
  useEffect(() => {
    if (!caseId) return undefined
    let cancelled = false
    Promise.resolve().then(() => casesApi.personCases(caseId))
      .then((res) => { if (!cancelled) setGroups(res.data?.data || []) })
      .catch(() => { if (!cancelled) setGroups([]) }) // a quiet add-on
    return () => { cancelled = true }
  }, [caseId])

  if (!groups.length) return null
  return (
    <div className="mt-3 space-y-2" aria-label="Other cases for this person">
      {groups.map((group) => (
        <div key={group.person._id} className="rounded-lg border border-border bg-card px-3 py-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
            Other cases for {group.person.name || group.person.email} ({group.person.email})
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {group.cases.map((row) => (
              <Link
                key={row._id}
                to={`/crm-cases/${row._id}`}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs text-foreground transition hover:border-primary/40 hover:bg-primary/5"
              >
                <span className="font-semibold">{row.visaType || 'Case'}</span>
                <span className="text-muted-foreground">{row.capacity}</span>
                {row.status && <span className="text-muted-foreground capitalize">· {statusLabel(row.status)}</span>}
                {row.createdAt && <span className="text-muted-foreground">· {dateLabel(row.createdAt)}</span>}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
