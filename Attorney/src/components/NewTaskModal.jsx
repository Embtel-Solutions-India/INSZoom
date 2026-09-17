import { useEffect, useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { attorneyApi, tasksApi } from '../services/api'

const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'urgent']

// Modeled on Admin's own task-create flow (MyTasks.jsx's "Create Task"
// button -> TaskDetails.jsx's form) but reduced to what an attorney can
// actually use: the backend defaults assignedTo to self and rejects (403)
// any attempt by this role to set it to someone else (task.controller.js's
// resolveAssignment), so there's no assignee/department/documentation-
// workflow section here — just a title, an
// optional case link (scoped to cases this attorney can actually see),
// priority, due date, and a description.
export default function NewTaskModal({ onClose, onCreated }) {
  const [cases, setCases] = useState([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [caseId, setCaseId] = useState('')
  const [priority, setPriority] = useState('medium')
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    attorneyApi.cases().then(({ data }) => setCases(data.cases || [])).catch(() => {})
  }, [])

  const submit = async (event) => {
    event.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    setError('')
    try {
      await tasksApi.create({
        title: title.trim(),
        description: description.trim() || undefined,
        caseId: caseId || undefined,
        priority,
        dueDate: dueDate || undefined,
      })
      onCreated()
    } catch (err) {
      setError(err.response?.data?.message || 'Could not create the task.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="card w-full max-w-md" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-foreground font-serif">New Task</h2>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="task-title" className="block text-sm font-medium text-foreground mb-1.5">Title</label>
            <input
              id="task-title"
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Review I-129 draft"
              className="input-field"
            />
          </div>

          <div>
            <label htmlFor="task-description" className="block text-sm font-medium text-foreground mb-1.5">Description</label>
            <textarea
              id="task-description"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="input-field"
            />
          </div>

          <div>
            <label htmlFor="task-case" className="block text-sm font-medium text-foreground mb-1.5">Case</label>
            <select id="task-case" value={caseId} onChange={(event) => setCaseId(event.target.value)} className="input-field">
              <option value="">No case</option>
              {cases.map((item) => (
                <option key={item._id} value={item._id}>{item.caseNumber || item.caseId} — {item.clientName}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="task-priority" className="block text-sm font-medium text-foreground mb-1.5">Priority</label>
              <select id="task-priority" value={priority} onChange={(event) => setPriority(event.target.value)} className="input-field capitalize">
                {PRIORITY_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="task-due" className="block text-sm font-medium text-foreground mb-1.5">Due date</label>
              <input id="task-due" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="input-field" />
            </div>
          </div>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving || !title.trim()} className="btn-primary flex items-center gap-2 disabled:opacity-50">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Create Task
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
