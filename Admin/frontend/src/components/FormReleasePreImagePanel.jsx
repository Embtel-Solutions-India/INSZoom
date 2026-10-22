import { useState } from 'react'
import { History, Search } from 'lucide-react'
import { formReleaseApi } from '../services/api'
import ConfirmModal from './ConfirmModal'

// Phase 3 safety net, as a panel of the "Release Safety" section: before an edition change moves a case form, the system keeps a checksummed copy of everything entered on it
// (the "pre-image"). This panel lists those copies for ONE case form and can put the form back - but ONLY after a preview, and never over something a person edited since.
// It is shown to exactly the `admin` role (the API refuses everyone else: the copies hold client answers). It NEVER displays an answer: the preview's old / new values are
// dropped the moment they arrive and only how many fields differ, and which fields, is shown.
export const SNAPSHOT_ROLES = ['admin']

const STATE_TEXT = { active: 'Kept', released: 'Released (migration verified)', purged: 'Deleted' }
const REFUSAL_TEXT = {
  SNAPSHOT_NOT_FOUND: 'That saved copy no longer exists.',
  SNAPSHOT_CHECKSUM_MISMATCH: 'The saved copy no longer matches its checksum, so it was refused for safety.',
  CASE_FORM_NOT_FOUND: 'That case form no longer exists.',
}

const errorMessage = (error, fallback) => {
  const message = error?.response?.data?.message
  return typeof message === 'string' && message.trim() ? message : fallback
}
const when = (value) => (value ? new Date(value).toLocaleString() : '-')

/** What a restore PREVIEW or RESTORE returned, in plain words. Only counts and field paths are kept - the values the server sends are never read. */
export function describeRestore(data) {
  if (!data) return { tone: 'gray', text: '' }
  if (data.refused) return { tone: 'red', text: REFUSAL_TEXT[data.refused] || 'The restore was refused.' }
  if (data.alreadyRestored) return { tone: 'gray', text: 'This case form already equals its saved copy - nothing to restore.' }
  const fields = (data.changes || []).map((change) => String(change.path || '')).filter(Boolean)
  const count = fields.length
  const paths = fields.slice(0, 10)
  if (data.reconciliationRequired) {
    return { tone: 'amber', paths, count, text: `Not restored: someone has edited this case form since the migration, so restoring would overwrite newer work. ${count} field${count === 1 ? '' : 's'} differ. It is flagged for an admin to reconcile and the saved copy is kept.` }
  }
  if (data.dryRun && data.wouldRestore) return { tone: 'green', paths, count, canRestore: true, text: `Preview: nothing has been edited since the migration, so it can be restored. ${count} field${count === 1 ? '' : 's'} would go back to what they were.` }
  if (data.restored) return { tone: 'green', text: 'The case form was restored from its saved copy.' }
  return { tone: 'amber', text: 'The restore did not change anything.' }
}

export default function FormReleasePreImagePanel() {
  const [caseFormId, setCaseFormId] = useState('')
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState({}) // snapshotId -> describeRestore(...) of the last dry run
  const [confirm, setConfirm] = useState(null)
  const [reason, setReason] = useState('')
  const [modalError, setModalError] = useState('')
  const [done, setDone] = useState({})

  const load = async () => {
    const id = caseFormId.trim()
    if (!/^[0-9a-fA-F]{24}$/.test(id)) { setError('Enter the case form id (24 letters and digits).'); return }
    setBusy('load'); setError(''); setPreview({}); setDone({})
    try {
      const response = await formReleaseApi.snapshots(id)
      setRows(response.data.data || [])
    } catch (err) {
      setRows(null)
      setError(errorMessage(err, 'Could not load the saved copies.'))
    } finally {
      setBusy('')
    }
  }

  const runPreview = async (row) => {
    setBusy(String(row._id)); setError('')
    try {
      const response = await formReleaseApi.restore(String(row._id), { dryRun: true })
      setPreview((current) => ({ ...current, [String(row._id)]: describeRestore(response.data.data) }))
    } catch (err) {
      setError(errorMessage(err, 'Could not preview the restore.'))
    } finally {
      setBusy('')
    }
  }

  const restore = async () => {
    if (reason.trim().length < 10) { setModalError('Write why (at least 10 characters) - it is kept in the audit trail.'); return }
    setBusy('restore'); setModalError('')
    try {
      const response = await formReleaseApi.restore(String(confirm._id), { dryRun: false, reason: reason.trim() })
      setDone((current) => ({ ...current, [String(confirm._id)]: describeRestore(response.data.data) }))
      setConfirm(null); setReason('')
    } catch (err) {
      setModalError(errorMessage(err, 'The restore failed.'))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="space-y-3 border-t border-border pt-4" data-testid="pre-image-panel">
      <div>
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2"><History className="w-4 h-4" /> Saved copies before an edition change</h3>
        <p className="text-sm text-muted-foreground mt-1">Before a case form is moved to a new edition, a full copy of what was entered on it is kept. If a move went wrong, you can preview and then restore it here. A restore is refused whenever someone has edited the form since - nothing newer is ever overwritten. Answers are never shown on this screen.</p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="block text-xs font-medium text-muted-foreground mb-1">Case form id</span>
          <input value={caseFormId} onChange={(event) => setCaseFormId(event.target.value)} className="input w-72" placeholder="e.g. 6ad8ee536b1055b5fe8d3f81" />
        </label>
        <button type="button" className="btn-secondary text-sm flex items-center gap-1" onClick={load} disabled={busy === 'load'}><Search className="w-4 h-4" /> {busy === 'load' ? 'Looking...' : 'Show saved copies'}</button>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {rows && rows.length === 0 && <p className="text-sm text-muted-foreground">No saved copies for that case form.</p>}
      {rows && rows.length > 0 && (
        <ul className="space-y-3" data-testid="snapshot-list">
          {rows.map((row) => {
            const id = String(row._id)
            const shown = done[id] || preview[id]
            const counts = (row.dispositions || []).reduce((sum, item) => { sum[item.disposition] = (sum[item.disposition] || 0) + 1; return sum }, {})
            return (
              <li key={id} className="rounded-lg border border-border p-3 text-sm space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <strong>{row.formCode}</strong> · saved {when(row.createdAt)} · {STATE_TEXT[row.state] || row.state}
                    {row.legalHold ? ' · on legal hold' : ''}
                    <div className="text-xs text-muted-foreground">
                      {row.expiresAt ? `Deleted automatically on ${when(row.expiresAt)}.` : 'Kept until someone resolves it (no automatic deletion).'}
                      {Object.keys(counts).length ? ` Records: ${Object.entries(counts).map(([name, n]) => `${n} ${String(name).replace(/_/g, ' ')}`).join(', ')}.` : ''}
                    </div>
                  </div>
                  <div className="space-x-2">
                    <button type="button" className="btn-secondary text-xs" disabled={Boolean(busy)} onClick={() => runPreview(row)}>{busy === id ? 'Checking...' : 'Preview restore'}</button>
                    {preview[id]?.canRestore && !done[id] && <button type="button" className="inline-flex items-center rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700" disabled={Boolean(busy)} onClick={() => { setConfirm(row); setReason(''); setModalError('') }}>Restore</button>}
                  </div>
                </div>
                {shown?.text && (
                  <div role="status" className={`rounded-md px-3 py-2 ${shown.tone === 'green' ? 'bg-green-50 text-green-900' : shown.tone === 'red' ? 'bg-red-50 text-red-900' : shown.tone === 'amber' ? 'bg-amber-50 text-amber-900' : 'bg-muted/40 text-foreground'}`}>
                    <p>{shown.text}</p>
                    {shown.paths?.length > 0 && <p className="mt-1 text-xs break-words">Fields: {shown.paths.join(', ')}{shown.count > shown.paths.length ? ` and ${shown.count - shown.paths.length} more` : ''}</p>}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {confirm && (
        <ConfirmModal
          title="Restore this case form?"
          message={`The ${confirm.formCode} case form will go back to what it was before the edition change, and anything entered on the new edition since then will be replaced. This was checked just now: nothing has been edited since the move.`}
          confirmLabel="Yes, restore it"
          tone="danger"
          busy={busy === 'restore'}
          error={modalError}
          onConfirm={restore}
          onCancel={() => { if (busy !== 'restore') setConfirm(null) }}
        >
          <label className="mt-3 block text-left text-sm">
            <span className="block text-xs font-medium text-muted-foreground mb-1">Why is it being restored? (kept in the audit trail)</span>
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} className="input w-full" rows={3} />
          </label>
        </ConfirmModal>
      )}
    </div>
  )
}
