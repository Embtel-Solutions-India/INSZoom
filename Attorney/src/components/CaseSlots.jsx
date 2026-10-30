import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { attorneyApi } from '../services/api'

// The employee slots of an employer matter (or the beneficiary of a family case), as Admin's Overview lists them - same columns, same wording, same status pills - but
// read-only: the attorney's access is to the matter, so there is nothing to open, invite, withdraw or restore here. Kept live by the Overview (it re-reads on every change
// pushed for the case) and by the case manager's own edits, which land in the same database record.
const PILL = {
  withdrawn: 'bg-secondary text-muted-foreground line-through',
  notIdentified: 'bg-secondary text-foreground',
  accepted: 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300',
  invited: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  plain: 'bg-secondary text-foreground',
}

function pillOf(child) {
  if (child.status === 'removed') return { label: 'Withdrawn', className: PILL.withdrawn }
  if (!child.name && !child.email) return { label: 'Not Identified', className: PILL.notIdentified }
  if (child.invited) return child.inviteStatus === 'accepted' ? { label: 'Accepted', className: PILL.accepted } : { label: 'Invited', className: PILL.invited }
  return { label: String(child.status || '').replace(/_/g, ' '), className: PILL.plain }
}

const visaLabel = (child) => {
  const key = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (!child.petitionSubType || child.petitionSubType === child.visaType) return child.visaType
  return key(child.petitionSubType).includes(key(child.visaType)) ? child.petitionSubType : `${child.visaType} · ${child.petitionSubType}`
}

export default function CaseSlots({ caseId, structure, refreshToken }) {
  const [children, setChildren] = useState(null)
  const [error, setError] = useState('')
  const [showWithdrawn, setShowWithdrawn] = useState(false)
  const navigate = useNavigate()
  const open = (child) => navigate(`/cases/${child._id}/overview`)

  useEffect(() => {
    let cancelled = false
    attorneyApi
      .children(caseId)
      .then(({ data }) => { if (!cancelled) { setChildren(data.children || []); setError('') } })
      .catch((err) => { if (!cancelled) setError(err.response?.data?.message || 'Could not load the employee list.') })
    return () => { cancelled = true }
  }, [caseId, refreshToken])

  const isEmployer = structure === 'employer_employee'
  if (children && children.length === 0 && !isEmployer) return null
  const withdrawn = (children || []).filter((child) => child.status === 'removed').length
  const rows = (children || [])
    .filter((child) => showWithdrawn || child.status !== 'removed')
    .sort((a, b) => (new Date(b.createdAt || 0) - new Date(a.createdAt || 0)) || (String(b.childIndex) > String(a.childIndex) ? 1 : -1))

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-foreground">{isEmployer ? `Employees (${children ? rows.length : '…'})` : 'Beneficiary'}</h3>
          <p className="text-sm text-muted-foreground mt-0.5">The people on this matter and where each one stands. Open a person to see their case (read-only); the list updates live.</p>
        </div>
        {withdrawn > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input type="checkbox" checked={showWithdrawn} onChange={(event) => setShowWithdrawn(event.target.checked)} />
            Show withdrawn ({withdrawn})
          </label>
        )}
      </div>
      {error && !children ? (
        <p className="px-5 py-4 text-sm text-destructive">{error}</p>
      ) : !children ? (
        <div className="px-5 py-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">{isEmployer ? 'No employees on this matter yet.' : 'No beneficiary on this case yet.'}</p>
      ) : (
        <div className="max-h-72 overflow-auto">
          <table className="w-full table-auto divide-y divide-border">
            <thead className="sticky top-0 z-10 bg-muted">
              <tr>
                {['Case', 'Name', 'Login email', 'Visa', 'Status', ...(isEmployer ? ['Workflow'] : []), 'Case Manager', ''].map((heading) => (
                  <th key={heading} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((child) => {
                const pill = pillOf(child)
                return (
                  <tr key={child._id} onClick={child.status === 'removed' ? undefined : () => open(child)} className={child.status === 'removed' ? 'opacity-60' : 'cursor-pointer hover:bg-muted/40 transition-colors'}>
                    <td className="px-3 py-2.5 whitespace-nowrap text-sm font-medium text-foreground">{child.caseNumber}</td>
                    <td className="px-3 py-2.5 text-sm text-muted-foreground break-words">{child.name || 'Employee Slot'}</td>
                    <td className="max-w-[14rem] px-3 py-2.5 text-sm">
                      {child.email ? (
                        <>
                          <span className="block truncate text-foreground" title={child.email}>{child.email}</span>
                          {child.inviteStatus !== 'accepted' && (
                            <span className="mt-0.5 block text-xs text-muted-foreground">{child.invited ? 'Password not set yet - setup link sent' : 'Not invited yet'}</span>
                          )}
                        </>
                      ) : <span className="text-muted-foreground">-</span>}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-foreground">{visaLabel(child)}</td>
                    <td className="px-3 py-2.5"><span className={`inline-block px-2 py-1 text-xs font-medium rounded-full capitalize ${pill.className}`}>{pill.label}</span></td>
                    {isEmployer && (
                      <td className="px-3 py-2.5">
                        <span className={`inline-block px-2 py-1 text-xs font-medium rounded-full ${child.employeeFills ? 'bg-primary/10 text-primary' : 'bg-secondary text-foreground'}`}>
                          {child.employeeFills ? 'Employee fills (invited)' : 'Employer fills'}
                        </span>
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-sm text-muted-foreground">{child.caseManagerName || 'Unassigned'}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {child.status !== 'removed' && (
                        <button type="button" onClick={(event) => { event.stopPropagation(); open(child) }} className="px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap rounded-md border border-primary bg-primary/10 text-primary hover:bg-primary/20">
                          View →
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
