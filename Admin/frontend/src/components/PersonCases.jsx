import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Info, FolderOpen } from 'lucide-react'
import { casesApi } from '../services/api'
import ConfirmModal from './ConfirmModal'

// One person, many cases (docs/MULTI_CASE_CLIENTS_PLAN.md, Phase 1). Both pieces are read-only and quiet: if the lookup fails they show nothing,
// so the New case form and the case page work exactly as before.

const dateLabel = (value) => {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : ''
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

// A single-person case that is on NO client login, whose client email belongs to an existing client (e.g. a second GHL card for the same person -
// GHL cannot tell a new matter from a duplicate, so the case arrives unlinked and flagged). One click, after a confirmation, adds it to their login;
// they get the usual "case created - log in" e-mail. Shows nothing when there is nobody to attach to or the lookup fails.
export function AttachToLoginBanner({ caseData, onAttached }) {
  const email = caseData?.clientEmail || ''
  const eligible = Boolean(caseData && email && !caseData.user && !caseData.employerUser && !caseData.petitionerUser && !caseData.parentCase
    && ['single', '', undefined, null].includes(caseData.caseStructure))
  const [info, setInfo] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  useEffect(() => {
    setInfo(null)
    if (!eligible) return undefined
    let cancelled = false
    Promise.resolve().then(() => casesApi.lookupPerson(email))
      .then((res) => { if (!cancelled) setInfo(res.data?.data || null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [eligible, email])

  if (done) {
    return <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs font-medium text-green-800" role="status">{done}</div>
  }
  const person = info?.person
  // a client, or (Phase 2B) an invited employee / beneficiary who may now hold cases of their own; never a staff / attorney account
  if (!eligible || !person || !['client', 'employee', 'beneficiary'].includes(person.role)) return null
  const name = person.name || person.email
  const count = info.cases?.length || 0

  const attach = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await casesApi.attachToLogin(caseData._id)
      setConfirming(false)
      setDone(res.data?.data?.invited
        ? `Added to ${name}'s login. They were sent an invitation to set their password.`
        : `Added to ${name}'s login. They were emailed to log in with their existing details.`)
      onAttached?.()
    } catch (e) {
      setError(e.response?.data?.message || 'Could not add this case to the login. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
      <p className="min-w-0 flex-1">
        This case is not on any client login yet. <span className="font-semibold">{name}</span> ({person.email}) already has {count} case{count === 1 ? '' : 's'}.
        If this is a new matter for them (not a duplicate), add it to their login.
      </p>
      <button type="button" onClick={() => { setError(''); setConfirming(true) }} className="btn-primary shrink-0 !py-1.5 !px-3 text-xs">Add to this person's login</button>
      {confirming && (
        <ConfirmModal
          title="Add this case to their login?"
          message={`${name} (${person.email}) will see this case in their portal next to their other cases and will be emailed to log in with their existing details. Do this only if it is a new matter, not a duplicate.`}
          confirmLabel="Add to login"
          busy={busy}
          error={error}
          onConfirm={attach}
          onCancel={() => { if (!busy) setConfirming(false) }}
        />
      )}
    </div>
  )
}
