import { useState } from 'react'
import { CheckCircle, Pencil, Send, FileEdit, Trash2 } from 'lucide-react'
import { questionnairesApi, invalidateCachedGet } from '../services/api'
import ConfirmModal from './ConfirmModal'
import ChecklistEditorModal from './ChecklistEditorModal'

const ROLE_LABEL = { employer: 'Employer', employee: 'Employee', client: 'Client', petitioner: 'Petitioner', beneficiary: 'Beneficiary', joint_sponsor: 'Joint sponsor', business_plan: 'Business plan' }

// "Checklists for this case": every checklist the case got automatically starts as a DRAFT - the client can't see it
// and hasn't been told about it. The case manager can edit it for this case only, then approve it; approval is what
// sends it to the client (and starts the questionnaire notifications/triggers).
export default function ChecklistApprovalCard({ caseId, checklists = [], onChanged }) {
  const [confirm, setConfirm] = useState(null) // { all, checklist }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [removeReason, setRemoveReason] = useState('')

  const items = checklists.filter((item) => !item.staffRequest)
  if (!items.length) return null
  const drafts = items.filter((item) => item.clientApproval === 'draft')

  const refresh = async () => {
    invalidateCachedGet(`/questionnaires/case/${caseId}`)
    await onChanged?.()
  }

  const runApproval = async () => {
    setBusy(true)
    setError('')
    try {
      await questionnairesApi.approveCaseChecklists(caseId, confirm.all ? { all: true } : { checklistIds: [confirm.checklist.checklistId] })
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
      await questionnairesApi.removeCaseChecklist(caseId, { checklistId: removing.checklistId, ...(removeReason.trim() ? { reason: removeReason.trim() } : {}) })
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

      <ul className="mt-4 divide-y divide-border">
        {items.map((item) => (
          <li key={`${item.checklistId}-${item.referenceId || ''}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{item.title}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{ROLE_LABEL[item.targetRole] || item.targetRole}</span>
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
              <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-xs text-rose-700" data-testid={`delete-checklist-${item.checklistId}`} onClick={() => { setError(''); setRemoving(item) }}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> {item.clientApproval === 'draft' ? 'Reject' : 'Delete'}
              </button>
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
          caseId={caseId}
          checklist={editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </div>
  )
}
