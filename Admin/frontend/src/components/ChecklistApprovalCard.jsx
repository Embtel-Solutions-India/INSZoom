import { useEffect, useMemo, useState } from 'react'
import { CheckCircle, Pencil, Send, FileEdit, Trash2 } from 'lucide-react'
import { questionnairesApi, invalidateCachedGet } from '../services/api'
import ConfirmModal from './ConfirmModal'
import ChecklistEditorModal from './ChecklistEditorModal'

// The Premium Processing (Form I-907) add-on is a staff-requested checklist, but it is listed, edited and approved here like the automatic
// ones (its key can carry the per-case "__case_" suffix once edited). It cannot be rejected/deleted: the upgrade itself is recorded on the case.
export const isPremiumChecklist = (item) => Boolean(item?.staffRequest) && String(item?.key || '').split('__case_')[0] === 'i907_premium_processing_profile'

const ROLE_LABEL = { employer: 'Employer', employee: 'Employee', client: 'Client', petitioner: 'Petitioner', beneficiary: 'Beneficiary', joint_sponsor: 'Joint sponsor', business_plan: 'Business plan' }

// "Checklists for this case": every checklist the case got automatically starts as a DRAFT - the client can't see it
// and hasn't been told about it. The case manager can edit it for this case only, then approve it; approval is what
// sends it to the client (and starts the questionnaire notifications/triggers).
// On an employer matter whose employees are on DIFFERENT visas, each employee case brings its own checklists (an L-1B employee and a P employee do not share
// one). `childCases` (the matter's employee cases) lets this card list those too, so nothing assigned is hidden; a checklist already shown for the matter is
// not repeated. An employee checklist is approved through the matter (that approval already reaches every employee case); anything else is handled on the
// employee case that owns it.
const SCROLL_AFTER = 5

export default function ChecklistApprovalCard({ caseId, checklists = [], childCases = [], onChanged }) {
  const [childLists, setChildLists] = useState([]) // [{ child, checklists }]
  const childKey = (childCases || []).filter((child) => child.status !== 'removed').map((child) => child._id).join(',')
  const loadChildLists = async () => {
    const children = (childCases || []).filter((child) => child.status !== 'removed')
    if (!children.length) { setChildLists([]); return }
    const lists = await Promise.all(children.map(async (child) => {
      try {
        const response = await questionnairesApi.listCaseChecklists(child._id)
        return { child, checklists: response.data?.data?.checklists || [] }
      } catch {
        return { child, checklists: [] }
      }
    }))
    setChildLists(lists)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadChildLists() }, [childKey, checklists])
  const childName = (child) => {
    const name = child.employeeContact?.name || child.clientName || child.caseNumber
    const email = child.employeeContact?.email || child.clientEmail
    return email ? `${name} (${email})` : name
  }
  const [confirm, setConfirm] = useState(null) // { all, checklist }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [removeReason, setRemoveReason] = useState('')

  const ownItems = checklists.filter((item) => !item.staffRequest || isPremiumChecklist(item))
  const extraItems = useMemo(() => {
    const seen = new Set(ownItems.map((item) => item.checklistId))
    const extras = new Map()
    childLists.forEach(({ child, checklists: list }) => {
      list.filter((item) => !item.staffRequest).forEach((item) => {
        if (seen.has(item.checklistId)) return
        const entry = extras.get(item.checklistId) || { ...item, ownerCaseId: child._id, forEmployees: [] }
        entry.forEmployees.push(childName(child))
        extras.set(item.checklistId, entry)
      })
    })
    return [...extras.values()]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childLists, checklists])
  const items = [...ownItems, ...extraItems]
  if (!items.length) return null
  // approval of an employee checklist goes through the matter; everything else through the case that owns the checklist
  const approvalCaseId = (item) => (item.ownerCaseId && item.targetRole !== 'employee' ? item.ownerCaseId : caseId)
  const drafts = items.filter((item) => item.clientApproval === 'draft')

  const refresh = async () => {
    invalidateCachedGet(`/questionnaires/case/${caseId}`)
    ;(childCases || []).forEach((child) => invalidateCachedGet(`/questionnaires/case/${child._id}`))
    await onChanged?.()
    await loadChildLists()
  }

  const runApproval = async () => {
    setBusy(true)
    setError('')
    try {
      await questionnairesApi.approveCaseChecklists(confirm.all ? caseId : approvalCaseId(confirm.checklist), confirm.all ? { all: true } : { checklistIds: [confirm.checklist.checklistId] })
      setConfirm(null)
      await refresh()
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Could not approve. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const runRemove = async () => {
    setBusy(true)
    setError('')
    try {
      await questionnairesApi.removeCaseChecklist(removing.ownerCaseId || caseId, { checklistId: removing.checklistId, ...(removeReason.trim() ? { reason: removeReason.trim() } : {}) })
      setRemoving(null)
      setRemoveReason('')
      await refresh()
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Could not delete this checklist. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" data-testid="checklist-approval-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-foreground">Checklists for this case</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {drafts.length
              ? 'These checklists are drafts. The client cannot see them and has not been notified. Edit them for this case if needed, then approve to send them to the client.'
              : 'All checklists have been approved and sent to the client. You can still edit a checklist for this case.'}
          </p>
        </div>
        {drafts.length > 0 && (
          <button type="button" className="btn-primary inline-flex items-center gap-2 text-sm" data-testid="approve-all-checklists" onClick={() => { setError(''); setConfirm({ all: true }) }}>
            <Send className="h-4 w-4" aria-hidden="true" /> Approve all &amp; send to client
          </button>
        )}
      </div>

      {/* every assigned checklist is listed; past five rows the list scrolls inside the card */}
      <ul className={`mt-4 divide-y divide-border ${items.length > SCROLL_AFTER ? 'max-h-[26rem] overflow-y-auto pr-1' : ''}`} data-testid="checklist-approval-list">
        {items.map((item) => (
          <li key={`${item.ownerCaseId || ''}-${item.checklistId}-${item.referenceId || ''}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{item.title}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{ROLE_LABEL[item.targetRole] || item.targetRole}</span>
                {item.forEmployees?.length > 0 && <span className="truncate" title={item.forEmployees.join(', ')}>· {item.forEmployees.join(', ')}</span>}
                {item.caseSpecific && <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700"><FileEdit className="h-3 w-3" aria-hidden="true" /> Customised for this case</span>}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {item.clientApproval === 'draft'
                ? <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">Draft - not visible to client</span>
                : <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700"><CheckCircle className="h-3.5 w-3.5" aria-hidden="true" /> Sent to client</span>}
              <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-xs" data-testid={`edit-checklist-${item.checklistId}`} onClick={() => setEditing(item)}>
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
              </button>
              {!isPremiumChecklist(item) && (
                <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-xs text-rose-700" data-testid={`delete-checklist-${item.checklistId}`} onClick={() => { setError(''); setRemoving(item) }}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> {item.clientApproval === 'draft' ? 'Reject' : 'Delete'}
                </button>
              )}
              {item.clientApproval === 'draft' && (
                <button type="button" className="btn-primary text-xs" data-testid={`approve-checklist-${item.checklistId}`} onClick={() => { setError(''); setConfirm({ all: false, checklist: item }) }}>
                  Approve
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {confirm && (
        <ConfirmModal
          title={confirm.all ? 'Approve all checklists?' : 'Approve this checklist?'}
          message={confirm.all
            ? 'Every draft checklist on this case (and its employee cases) will be sent to the client. They will be notified and can start answering.'
            : isPremiumChecklist(confirm.checklist)
              ? `"${confirm.checklist.title}" will be sent to the client. They will get the "upgraded to Premium Processing" email and a browser notification, and can start answering.`
              : `"${confirm.checklist.title}" will be sent to the client. They will be notified and can start answering.${confirm.checklist.targetRole === 'employee' ? ' The employee checklist is approved for every employee case under this case too - no need to approve it on each one.' : ''}`}
          confirmLabel="Yes, approve"
          cancelLabel="No"
          busy={busy}
          error={error}
          onConfirm={runApproval}
          onCancel={() => setConfirm(null)}
        />
      )}
      {removing && (
        <ConfirmModal
          title={removing.clientApproval === 'draft' ? 'Reject this checklist?' : 'Delete this checklist?'}
          message={`"${removing.title}" will be removed from this case only${removing.targetRole === 'employee' ? ' (and from every employee case under it)' : ''}. It will not be sent to the client${removing.clientApproval === 'draft' ? '' : ' and the client will no longer see it'}. Answers already given are kept on record. Other cases and the shared template are not affected.`}
          confirmLabel={removing.clientApproval === 'draft' ? 'Yes, reject' : 'Yes, delete'}
          cancelLabel="No"
          busy={busy}
          error={error}
          onConfirm={runRemove}
          onCancel={() => { setRemoving(null); setRemoveReason('') }}
        >
          {removing.targetRole === 'employer' && (
            <label className="mt-3 block text-sm text-foreground">
              Reason (optional)
              <textarea
                className="input mt-1 w-full"
                rows={2}
                maxLength={500}
                value={removeReason}
                onChange={(event) => setRemoveReason(event.target.value)}
                placeholder="Not required for this employer because..."
                data-testid="remove-checklist-reason"
              />
              <span className="mt-1 block text-xs text-muted-foreground">A reason records this as "not required" for this employer. Without one the case is still flagged until a decision is recorded.</span>
            </label>
          )}
        </ConfirmModal>
      )}
      {editing && (
        <ChecklistEditorModal
          caseId={editing.ownerCaseId || caseId}
          checklist={editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </div>
  )
}
