import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Calendar, CheckCircle2, FileText, Loader2, Pause, Paperclip, Play, Send, User } from 'lucide-react'
import { tasksApi } from '../../services/api'
import { useAuth } from '../../auth/AuthContext'
import { STATUS_DOT, PRIORITY_DOT, formatLabel, formatDate, isOverdue } from '../../components/taskStyle'

// Admin's Task Details, scoped to what an attorney may do: read the task, move its status (own
// tasks only - enforced by the backend), and comment. No editing of other fields, no reassigning.
const CARD = 'rounded-xl border border-border bg-card p-5 sm:p-6'

export default function TaskDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [task, setTask] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const [comment, setComment] = useState('')

  const load = useCallback(
    () =>
      tasksApi
        .get(id)
        .then(({ data }) => {
          setTask(data.task || null)
          setError(data.task ? '' : 'Task not found.')
        })
        .catch((err) => setError(err.response?.status === 403 ? 'You do not have access to this task.' : err.response?.data?.message || 'Could not load this task.')),
    [id]
  )

  useEffect(() => {
    setTask(null)
    load()
  }, [load])

  const run = async (action) => {
    setBusy(true)
    setActionError('')
    try {
      await action()
      await load()
    } catch (err) {
      setActionError(err.response?.data?.message || 'That did not go through. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const changeStatus = (status) => run(() => tasksApi.updateStatus(id, status))
  const addComment = () => {
    const text = comment.trim()
    if (!text) return
    run(async () => {
      await tasksApi.addComment(id, text)
      setComment('')
    })
  }

  const back = (
    <button type="button" onClick={() => navigate('/tasks/my-tasks')} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
      <ArrowLeft className="w-4 h-4" /> Back to my tasks
    </button>
  )

  if (error) {
    return (
      <div className="space-y-4">
        {back}
        <div className="card text-center py-10"><p className="text-sm text-muted-foreground">{error}</p></div>
      </div>
    )
  }
  if (!task) return <Loader2 className="w-6 h-6 animate-spin text-primary" />

  const progress = Math.min(Math.max(Number(task.progress) || 0, 0), 100)
  const overdue = isOverdue(task)
  const comments = task.comments || []
  const caseRef = task.caseId

  return (
    <div className="space-y-5">
      {back}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <div className={CARD}>
            <h1 className="text-xl font-semibold text-foreground font-serif break-words">{task.title}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[task.priority] || 'bg-slate-300'}`} aria-hidden="true" />{formatLabel(task.priority, 'medium')} priority</span>
              <span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[task.status] || 'bg-slate-300'}`} aria-hidden="true" />{formatLabel(task.status, 'pending')}</span>
            </p>

            {task.description && <p className="mt-4 text-sm text-muted-foreground whitespace-pre-wrap break-words">{task.description}</p>}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5 text-sm text-muted-foreground">
              <span className={`flex items-center gap-2 ${overdue ? 'text-destructive' : ''}`}><Calendar className="w-4 h-4" />Due: {formatDate(task.dueDate)}{overdue ? ' (overdue)' : ''}</span>
              <span className="flex items-center gap-2"><FileText className="w-4 h-4" />Category: {formatLabel(task.category, 'general')}</span>
              <span className="flex items-center gap-2"><User className="w-4 h-4" />Assigned to: {task.assignedTo?.name || task.assignedTo?.displayName || '—'}</span>
              <span className="flex items-center gap-2"><User className="w-4 h-4" />Assigned by: {task.assignedBy?.name || task.assignedBy?.displayName || '—'}</span>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="font-medium text-muted-foreground">Progress</span>
                <span className="text-muted-foreground tabular-nums">{progress}%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </div>

          {caseRef && (
            <div className={CARD}>
              <h2 className="text-sm font-semibold text-foreground mb-3">Linked case</h2>
              <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-4">
                <div className="min-w-0">
                  <p className="font-semibold text-foreground truncate">{caseRef.caseNumber || caseRef.caseId}</p>
                  {caseRef.clientName && <p className="text-sm text-muted-foreground truncate">{caseRef.clientName}</p>}
                </div>
                {caseRef._id && <Link to={`/cases/${caseRef._id}/overview`} className="text-sm font-medium text-primary hover:underline shrink-0">View case</Link>}
              </div>
            </div>
          )}

          <div className={CARD}>
            <h2 className="text-sm font-semibold text-foreground mb-4">Comments ({comments.length})</h2>
            <div className="space-y-3 mb-4">
              {comments.length ? comments.map((c, i) => {
                const authorId = c.author?._id || c.author
                const mine = authorId && String(authorId) === String(user?._id || user?.id)
                return (
                  <div key={c._id || i} className="p-3 bg-muted rounded-lg">
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <span className="text-sm font-medium text-foreground">{c.author?.name || (mine ? 'You' : 'Team member')}</span>
                      <span className="text-xs text-muted-foreground shrink-0">{c.createdAt ? new Date(c.createdAt).toLocaleString() : ''}</span>
                    </div>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">{c.text}</p>
                  </div>
                )
              }) : <p className="text-sm text-muted-foreground text-center py-4">No comments yet</p>}
            </div>
            <div className="flex gap-2">
              <input type="text" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment..."
                onKeyDown={(e) => e.key === 'Enter' && addComment()}
                className="flex-1 min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              <button onClick={addComment} disabled={busy || !comment.trim()} className="btn-primary inline-flex items-center gap-2 disabled:opacity-50">
                <Send className="w-4 h-4" /> Send
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className={CARD}>
            <h2 className="text-sm font-semibold text-foreground mb-4">Quick actions</h2>
            <div className="space-y-2">
              {task.status !== 'completed' && (
                <button onClick={() => changeStatus('completed')} disabled={busy} className="w-full flex items-center gap-2 px-4 py-2 text-sm font-medium border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 rounded-lg hover:bg-emerald-500/15 transition-colors disabled:opacity-50">
                  <CheckCircle2 className="w-4 h-4" /> Mark complete
                </button>
              )}
              {task.status !== 'in_progress' && task.status !== 'completed' && (
                <button onClick={() => changeStatus('in_progress')} disabled={busy} className="w-full flex items-center gap-2 px-4 py-2 text-sm font-medium border border-primary/20 bg-primary/10 text-primary rounded-lg hover:bg-primary/15 transition-colors disabled:opacity-50">
                  <Play className="w-4 h-4" /> Start progress
                </button>
              )}
              {task.status === 'in_progress' && (
                <button onClick={() => changeStatus('waiting')} disabled={busy} className="w-full flex items-center gap-2 px-4 py-2 text-sm font-medium border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 rounded-lg hover:bg-amber-500/15 transition-colors disabled:opacity-50">
                  <Pause className="w-4 h-4" /> Pause
                </button>
              )}
              {task.status === 'completed' && (
                <button onClick={() => changeStatus('in_progress')} disabled={busy} className="w-full flex items-center gap-2 px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50">
                  <Play className="w-4 h-4" /> Reopen
                </button>
              )}
            </div>
            {actionError && <p className="mt-3 text-xs text-destructive">{actionError}</p>}
          </div>

          <div className={CARD}>
            <h2 className="text-sm font-semibold text-foreground mb-4">Attachments ({task.attachments?.length || 0})</h2>
            {task.attachments?.length ? (
              <div className="space-y-2">
                {task.attachments.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 bg-muted rounded-lg">
                    <Paperclip className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-sm text-muted-foreground truncate">{a.fileName || a.originalName || 'Attachment'}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground text-center py-4">No attachments</p>}
          </div>

          <div className={CARD}>
            <h2 className="text-sm font-semibold text-foreground mb-4">Task information</h2>
            <dl className="space-y-3 text-sm">
              {[
                ['Created', formatDate(task.createdAt)],
                ['Last updated', formatDate(task.updatedAt)],
                task.completionDate && ['Completed', formatDate(task.completionDate)],
                task.estimatedHours != null && ['Estimated hours', task.estimatedHours],
                task.actualHours != null && ['Actual hours', task.actualHours],
              ].filter(Boolean).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-foreground tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </div>
  )
}
