import { useState } from 'react'
import { casesApi } from '../services/api'
import { AlertTriangle } from 'lucide-react'
import ConfirmModal from './ConfirmModal'

// The case's Notes (Overview tab), for the life of the case. Any internal staff member adds a note at any time; the person who wrote a note can
// edit it; any internal staff member can delete one (after a confirmation). All notes are in ONE box, newest first, each under its writer's
// name, role and time, one blank line apart, about 6 lines tall and scrollable. The notes typed when the case was created are last, labelled.
// The server (POST / PATCH / DELETE /cases/:id/notes) never sends these notes to clients, employers or employees; a deleted note stays on the
// record for the audit trail and is not shown here.
const STAFF_ROLES = ['super_admin', 'admin', 'team_lead', 'case_manager']
const ROLE_LABEL = { super_admin: 'Super Admin', admin: 'Admin', team_lead: 'Team Lead', case_manager: 'Case Manager' }
const MAX_NOTE = 5000

const idOf = (value) => String(value?._id || value || '')
const roleKey = (role) => String(role || '').toLowerCase().replace(/[\s-]+/g, '_')
const formatWhen = (value) => {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
}
const errorText = (err, fallback) => err?.response?.data?.message || err?.response?.data?.errors?.[0]?.msg || fallback

// The notes typed when the case was created: new cases carry them in caseNotes; older cases only have the first internal note, written at the same moment.
function creationNoteOf(caseData) {
  if (!caseData) return { text: '', fromInternalNoteId: '' }
  if (caseData.caseNotes) return { text: String(caseData.caseNotes), fromInternalNoteId: '' }
  const first = (caseData.internalNotes || [])[0]
  if (!first?.note || first.deletedAt || !first.createdAt || !caseData.createdAt) return { text: '', fromInternalNoteId: '' }
  const gap = Math.abs(new Date(first.createdAt).getTime() - new Date(caseData.createdAt).getTime())
  return gap <= 2 * 60 * 1000 && first.category === 'general' ? { text: String(first.note), fromInternalNoteId: idOf(first._id) || 'first' } : { text: '', fromInternalNoteId: '' }
}

export default function CaseNotesPanel({ caseData, user, onChanged, onAdded }) {
  const changed = onChanged || onAdded
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // { id, text }
  const [editError, setEditError] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null) // the note to delete
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const isStaff = STAFF_ROLES.includes(roleKey(user?.role))
  const creation = creationNoteOf(caseData)
  const myId = idOf(user)
  const notes = (caseData?.internalNotes || [])
    .map((note, index) => ({ ...note, _key: idOf(note._id) || `note-${index}`, _index: index }))
    .filter((note) => !note.deletedAt)
    // the creation note is shown once, at the bottom; a private note only to the person who wrote it
    .filter((note) => !(creation.fromInternalNoteId && ((note._index === 0 && creation.fromInternalNoteId === 'first') || note._key === creation.fromInternalNoteId)))
    .filter((note) => note.visibility !== 'private' || idOf(note.author) === myId)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0) || b._index - a._index)

  const text = draft.trim()
  const add = async (event) => {
    event?.preventDefault?.()
    if (!text || saving || !caseData?._id) return
    setSaving(true)
    setError('')
    try {
      await casesApi.addInternalNote(caseData._id, { note: text })
      setDraft('')
      await changed?.()
    } catch (err) {
      setError(errorText(err, 'The note could not be saved. Please try again.')) // the text stays in the box, so nothing typed is lost
    } finally {
      setSaving(false)
    }
  }

  const saveEdit = async () => {
    const next = String(editing?.text || '').trim()
    if (!next || editSaving) return
    setEditSaving(true)
    setEditError('')
    try {
      await casesApi.updateInternalNote(caseData._id, editing.id, { note: next })
      setEditing(null)
      await changed?.()
    } catch (err) {
      setEditError(errorText(err, 'The change could not be saved. Please try again.'))
    } finally {
      setEditSaving(false)
    }
  }

  const doDelete = async () => {
    if (!confirmDelete || deleting) return
    setDeleting(true)
    setDeleteError('')
    try {
      await casesApi.deleteInternalNote(caseData._id, confirmDelete._key)
      setConfirmDelete(null)
      await changed?.()
    } catch (err) {
      setDeleteError(errorText(err, 'The note could not be deleted. Please try again.'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="card" data-testid="case-notes">
      <h3 className="text-lg font-semibold text-foreground mb-4">Notes</h3>
      {isStaff && (
        <form onSubmit={add} className="mb-4">
          <textarea
            className="input-field w-full text-sm"
            rows={3}
            maxLength={MAX_NOTE}
            value={draft}
            onChange={(event) => { setDraft(event.target.value); if (error) setError('') }}
            placeholder="Write a note for the case team..."
            aria-label="New note"
            disabled={saving}
          />
          {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
          <div className="mt-2 flex justify-end">
            <button type="submit" className="btn-primary text-sm" disabled={!text || saving}>{saving ? 'Saving...' : 'Add note'}</button>
          </div>
        </form>
      )}
      {(notes.length > 0 || creation.text) && (
        <ul className="rounded-lg border border-border p-3 overflow-y-auto text-sm leading-6" style={{ maxHeight: '9.5rem' }} data-testid="case-notes-list" tabIndex={0} aria-label="Case notes">
          {notes.map((note, index) => {
            const author = note.author && typeof note.author === 'object' ? note.author : null
            const mine = idOf(note.author) === myId
            const name = author?.name || author?.displayName || (mine ? (user?.name || user?.displayName || 'You') : 'Team member')
            const role = ROLE_LABEL[roleKey(author?.role)] || ''
            const edited = (note.editHistory || []).length > 0
            const isEditing = editing?.id === note._key
            return (
              <li key={note._key} className={index ? 'mt-6' : ''}>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    {[name, role, formatWhen(note.createdAt)].filter(Boolean).join(' · ')}{edited ? ' · (edited)' : ''}
                  </p>
                  {isStaff && !isEditing && (
                    <div className="flex shrink-0 gap-3 text-xs">
                      {mine && <button type="button" className="text-primary hover:underline" onClick={() => { setEditing({ id: note._key, text: note.note }); setEditError('') }}>Edit</button>}
                      <button type="button" className="text-red-600 hover:underline" onClick={() => { setConfirmDelete(note); setDeleteError('') }}>Delete</button>
                    </div>
                  )}
                </div>
                {isEditing ? (
                  <div className="mt-1">
                    <textarea className="input-field w-full text-sm" rows={3} maxLength={MAX_NOTE} value={editing.text} aria-label="Edit note" disabled={editSaving} onChange={(event) => setEditing({ ...editing, text: event.target.value })} />
                    {editError && <p className="mt-1 text-sm text-red-600" role="alert">{editError}</p>}
                    <div className="mt-1 flex justify-end gap-2">
                      <button type="button" className="btn-secondary text-xs" disabled={editSaving} onClick={() => setEditing(null)}>Cancel</button>
                      <button type="button" className="btn-primary text-xs" disabled={editSaving || !String(editing.text || '').trim()} onClick={saveEdit}>{editSaving ? 'Saving...' : 'Save'}</button>
                    </div>
                  </div>
                ) : (
                  <p className="text-foreground whitespace-pre-wrap break-words">{note.note}</p>
                )}
              </li>
            )
          })}
          {creation.text && (
            <li className={notes.length ? 'mt-6' : ''}>
              <p className="text-xs font-medium text-muted-foreground">{['At case creation', formatWhen(caseData?.createdAt)].filter(Boolean).join(' · ')}</p>
              <p className="text-foreground whitespace-pre-wrap break-words">{creation.text}</p>
            </li>
          )}
        </ul>
      )}
      {!notes.length && !creation.text && !isStaff && <p className="text-sm text-muted-foreground">No notes yet.</p>}
      {confirmDelete && (
        <ConfirmModal
          title="Delete this note?"
          message="The note is removed from the case for everyone. This cannot be undone here."
          confirmLabel="Delete"
          icon={AlertTriangle} // blue warning symbol and blue Delete button (owner request) - the default tone, not the red one
          busy={deleting}
          error={deleteError}
          onConfirm={doDelete}
          onCancel={() => { if (!deleting) setConfirmDelete(null) }}
        />
      )}
    </div>
  )
}

export { creationNoteOf }
